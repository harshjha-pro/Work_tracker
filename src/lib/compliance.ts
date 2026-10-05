// Compliance calendar engine (spec §6): applicability flags + the editable
// Due-Date Master generate recurring compliance tasks; extensions and master
// edits move every affected open task and record the change.

import type {
  Client,
  ComplianceType,
  DB,
  DueRule,
  Engagement,
  FlagKey,
  ISODate,
  Task,
  TaskStatus,
} from './types';
import {
  addDays,
  ayLabel,
  firstOnOrAfter,
  fyKey,
  fyLabel,
  fyStartYear,
  iso,
  monthLabel,
  monthName,
  nowIso,
  pad,
  quarterStart,
  safeIso,
  today,
} from './dates';
import { isOpen } from './master';
import { uid } from './util';

export const HORIZON_DAYS = 120;

export function derivedFlags(c: Pick<Client, 'constitution' | 'profile'>): Record<FlagKey, string> {
  const p = c.profile;
  const isCompany = c.constitution === 'private_company' || c.constitution === 'public_company';
  const isLLP = c.constitution === 'llp';
  return {
    gstFrequency: p.gstFrequency,
    gstRegistered: String(p.gstFrequency !== 'not_applicable'),
    gstAnnualReturn: String(p.gstAnnualReturn && p.gstFrequency !== 'not_applicable'),
    gst9c: String(p.gst9c && p.gstFrequency !== 'not_applicable'),
    tds: String(p.tds),
    advanceTax: String(p.advanceTax),
    taxAudit: String(p.taxAudit),
    statutoryAudit: String(p.statutoryAudit),
    transferPricing: String(p.transferPricing),
    pf: String(p.pf),
    esi: String(p.esi),
    isCompany: String(isCompany),
    isLLP: String(isLLP),
    // ITR due date for companies and anyone whose accounts must be audited
    auditCase: String(isCompany || p.taxAudit || p.statutoryAudit),
  };
}

export function typeApplies(t: ComplianceType, c: Pick<Client, 'constitution' | 'profile' | 'status'>): boolean {
  if (!t.isActive || c.status !== 'active') return false;
  const f = derivedFlags(c);
  return t.applicability.every((r) => f[r.flag] === r.value);
}

export function ruleText(rule: DueRule): string {
  switch (rule.kind) {
    case 'monthly':
      return `${ordinal(rule.day)} of following month${
        rule.marchOverride ? ` (March: ${rule.marchOverride.day} ${monthName(rule.marchOverride.month)})` : ''
      }`;
    case 'quarterly':
      return rule.dates.map((d) => `${d.day} ${monthName(d.month)}`).join(', ');
    case 'annual':
      return `${rule.day} ${monthName(rule.month)} after FY end`;
    case 'event':
      return `AGM date + ${rule.offsetDays} days`;
  }
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export interface PeriodDue {
  periodKey: string;
  periodLabel: string;
  due: ISODate;
  provisional: boolean;
  fyStart: number;
}

const QUARTER_MONTHS = ['Apr–Jun', 'Jul–Sep', 'Oct–Dec', 'Jan–Mar'];

function monthlyDue(rule: Extract<DueRule, { kind: 'monthly' }>, y: number, m: number): ISODate {
  if (m === 3 && rule.marchOverride) return safeIso(y, rule.marchOverride.month, rule.marchOverride.day);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return safeIso(ny, nm, rule.day);
}

function agmFor(client: Pick<Client, 'agmDate'>, fyStart: number): { date: ISODate; provisional: boolean } {
  if (client.agmDate && fyStartYear(client.agmDate) === fyStart + 1) return { date: client.agmDate, provisional: false };
  // Default: AGM by 30 September after FY end; marked provisional until the real date is recorded
  return { date: iso(fyStart + 1, 9, 30), provisional: true };
}

/** Due date for one period of a compliance type for a client. */
export function dueForPeriod(t: ComplianceType, client: Pick<Client, 'agmDate'>, periodKey: string): PeriodDue | null {
  const rule = t.rule;
  if (rule.kind === 'monthly') {
    const m = /^(\d{4})-(\d{2})$/.exec(periodKey);
    if (!m) return null;
    const y = +m[1];
    const mo = +m[2];
    return {
      periodKey,
      periodLabel: monthLabel(y, mo),
      due: monthlyDue(rule, y, mo),
      provisional: false,
      fyStart: mo >= 4 ? y : y - 1,
    };
  }
  if (rule.kind === 'quarterly') {
    const m = /^FY(\d{4})-\d{2}-Q(\d)$/.exec(periodKey);
    if (!m) return null;
    const fy = +m[1];
    const qn = +m[2];
    const qs = quarterStart(fy, qn);
    const d = rule.dates[qn - 1];
    const label =
      t.periodLabelStyle === 'instalment'
        ? `Instalment ${qn} · ${fyLabel(fy)}`
        : `Q${qn} ${fyLabel(fy)} (${QUARTER_MONTHS[qn - 1]})`;
    return { periodKey, periodLabel: label, due: firstOnOrAfter(iso(qs.y, qs.m, 1), d.month, d.day), provisional: false, fyStart: fy };
  }
  const m = /^FY(\d{4})-\d{2}$/.exec(periodKey);
  if (!m) return null;
  const fy = +m[1];
  const label = t.periodLabelStyle === 'ay' ? `${ayLabel(fy)} (${fyLabel(fy)})` : fyLabel(fy);
  if (rule.kind === 'annual') {
    return { periodKey, periodLabel: label, due: firstOnOrAfter(iso(fy + 1, 4, 1), rule.month, rule.day), provisional: false, fyStart: fy };
  }
  const agm = agmFor(client, fy);
  return { periodKey, periodLabel: label, due: addDays(agm.date, rule.offsetDays), provisional: agm.provisional, fyStart: fy };
}

/** All periods of a type whose due date falls within [from, to]. */
export function periodsInWindow(t: ComplianceType, client: Pick<Client, 'agmDate'>, from: ISODate, to: ISODate): PeriodDue[] {
  const keys: string[] = [];
  const fyFrom = fyStartYear(from) - 2;
  const fyTo = fyStartYear(to);
  if (t.rule.kind === 'monthly') {
    const [fy, fm] = from.split('-').map(Number);
    let y = fy;
    let mo = fm - 3;
    while (mo < 1) {
      mo += 12;
      y -= 1;
    }
    const end = to.slice(0, 7);
    while (`${y}-${pad(mo)}` <= end) {
      keys.push(`${y}-${pad(mo)}`);
      mo += 1;
      if (mo > 12) {
        mo = 1;
        y += 1;
      }
    }
  } else if (t.rule.kind === 'quarterly') {
    for (let fy = fyFrom; fy <= fyTo; fy++) for (let qn = 1; qn <= 4; qn++) keys.push(`${fyKey(fy)}-Q${qn}`);
  } else {
    for (let fy = fyFrom; fy <= fyTo; fy++) keys.push(fyKey(fy));
  }
  return keys
    .map((k) => dueForPeriod(t, client, k))
    .filter((p): p is PeriodDue => !!p && p.due >= from && p.due <= to);
}

export const taskKey = (clientId: string, code: string, periodKey: string) => `${clientId}|${code}|${periodKey}`;

/** The latest published extension for (type, period), if any. */
export function extensionFor(db: DB, code: string, periodKey: string) {
  let found: DB['extensions'][number] | undefined;
  for (const e of db.extensions) if (e.complianceTypeCode === code && e.periodKeys.includes(periodKey)) found = e;
  return found;
}

function pickAssignee(db: DB, clientId: string, t: ComplianceType | undefined): string | undefined {
  const members = db.clientTeam
    .filter((a) => a.clientId === clientId && a.role === 'staff')
    .map((a) => db.users.find((u) => u.id === a.userId)!)
    .filter(Boolean);
  if (!members.length) return db.clients.find((c) => c.id === clientId)?.managerId;
  if (t?.serviceLine === 'company_law') {
    const cs = members.find((u) => /CS/.test(u.designation));
    if (cs) return cs.id;
  }
  // Seniors take audits and annual returns; everyone else rotates by type code
  if (t && (t.serviceLine === 'audit' || t.frequency === 'annual')) {
    const senior = members.find((u) => u.isSenior);
    if (senior) return senior.id;
  }
  const idx = t ? [...t.code].reduce((a, ch) => a + ch.charCodeAt(0), 0) % members.length : 0;
  return members[idx].id;
}

function ensureEngagement(db: DB, client: Client, t: ComplianceType, fyStart: number, actor: string): Engagement {
  const fy = fyLabel(fyStart);
  const title = `${t.engagementGroup} ${fy}`;
  let e = db.engagements.find((x) => x.clientId === client.id && x.type === 'recurring' && x.title === title);
  if (e) return e;
  const team = db.clientTeam
    .filter((a) => a.clientId === client.id)
    .map((a) => ({ userId: a.userId, role: a.role === 'reviewer' ? ('checker' as const) : ('maker' as const) }));
  if (client.managerId && !team.some((m) => m.userId === client.managerId)) team.push({ userId: client.managerId, role: 'checker' });
  e = {
    id: uid(),
    clientId: client.id,
    serviceLine: t.serviceLine,
    type: 'recurring',
    title,
    financialYear: fy,
    templateCode: t.templateCode,
    status: 'active',
    partnerId: client.partnerId,
    managerId: client.managerId,
    team,
    budgetHours: t.defaultBudgetHours,
    billable: true,
    startDate: iso(fyStart, 4, 1),
    endDate: iso(fyStart + 1, 3, 31),
    createdAt: nowIso(),
    createdBy: actor,
  };
  db.engagements.push(e);
  return e;
}

export function newTask(db: DB, client: Client, t: ComplianceType, p: PeriodDue, actor: string): Task {
  const eng = ensureEngagement(db, client, t, p.fyStart, actor);
  const tpl = db.templates.find((x) => x.code === t.templateCode);
  const ext = extensionFor(db, t.code, p.periodKey);
  const now = nowIso();
  return {
    id: uid(),
    clientId: client.id,
    engagementId: eng.id,
    kind: 'compliance',
    complianceTypeCode: t.code,
    periodKey: p.periodKey,
    periodLabel: p.periodLabel,
    title: `${t.shortName} · ${p.periodLabel}`,
    templateCode: t.templateCode,
    originalDue: p.due,
    effectiveDue: ext ? ext.newDueDate : p.due,
    provisional: p.provisional,
    status: 'upcoming',
    stageIndex: 0,
    pendingPeriods: [],
    assignedTo: pickAssignee(db, client.id, t),
    checkerId: client.managerId,
    budgetHours: t.defaultBudgetHours,
    checklist: (tpl?.checklist ?? []).map((name) => ({ id: uid(), name, status: 'not_requested' })),
    followUps: [],
    statusHistory: [{ at: now, by: actor, from: null, to: 'upcoming', note: 'Generated by compliance calendar' }],
    dueHistory: ext
      ? [{ at: ext.publishedAt, by: ext.publishedBy, from: p.due, to: ext.newDueDate, source: 'extension', reference: ext.reference }]
      : [],
    createdAt: now,
    updatedAt: now,
    updatedBy: actor,
  };
}

export interface SyncPlan {
  create: { type: ComplianceType; period: PeriodDue }[];
  remove: Task[]; // upcoming, untouched → deleted
  markNA: Task[]; // had activity → kept as Not Applicable
}

/**
 * What a client's (possibly edited) profile means for its compliance tasks from
 * `from` forward. Pure — used for the live preview in the client form and for
 * the real sync.
 */
export function planClientSync(
  db: DB,
  client: Pick<Client, 'id' | 'constitution' | 'profile' | 'status' | 'agmDate'>,
  from: ISODate = today(),
  to: ISODate = addDays(today(), HORIZON_DAYS),
): SyncPlan {
  const existing = new Map<string, Task>();
  for (const t of db.tasks) if (t.clientId === client.id && t.kind === 'compliance') existing.set(taskKey(t.clientId, t.complianceTypeCode!, t.periodKey!), t);

  const create: SyncPlan['create'] = [];
  for (const t of db.complianceTypes) {
    if (!typeApplies(t, client)) continue;
    for (const p of periodsInWindow(t, client, from, to)) {
      if (!existing.has(taskKey(client.id, t.code, p.periodKey))) create.push({ type: t, period: p });
    }
  }

  const remove: Task[] = [];
  const markNA: Task[] = [];
  for (const task of existing.values()) {
    if (!isOpen(task.status) || task.effectiveDue < from) continue;
    const t = db.complianceTypes.find((x) => x.code === task.complianceTypeCode);
    if (t && typeApplies(t, client)) continue;
    const touched =
      task.status !== 'upcoming' ||
      task.stageIndex > 0 ||
      task.followUps.length > 0 ||
      db.entries.some((e) => e.taskId === task.id);
    (touched ? markNA : remove).push(task);
  }
  create.sort((a, b) => a.period.due.localeCompare(b.period.due));
  return { create, remove, markNA };
}

export function applyClientSync(db: DB, clientId: string, actor: string, reason: string, from?: ISODate) {
  const client = db.clients.find((c) => c.id === clientId)!;
  const plan = planClientSync(db, client, from);
  for (const { type, period } of plan.create) db.tasks.push(newTask(db, client, type, period, actor));
  const removeIds = new Set(plan.remove.map((t) => t.id));
  db.tasks = db.tasks.filter((t) => !removeIds.has(t.id));
  const now = nowIso();
  for (const t of plan.markNA) {
    const task = db.tasks.find((x) => x.id === t.id)!;
    task.statusHistory.push({ at: now, by: actor, from: task.status, to: 'not_applicable', note: reason });
    task.status = 'not_applicable';
    task.naReason = reason;
    task.updatedAt = now;
    task.updatedBy = actor;
  }
  return { created: plan.create.length, removed: plan.remove.length, markedNA: plan.markNA.length };
}

/** Re-derive due dates of a type's tasks after the master rule (or a client's AGM date) changes. */
export function recomputeDues(db: DB, actor: string, filter: (t: Task) => boolean, source: 'master_change' | 'event_correction') {
  let moved = 0;
  const now = nowIso();
  for (const task of db.tasks) {
    if (task.kind !== 'compliance' || !filter(task) || task.status === 'not_applicable') continue;
    const type = db.complianceTypes.find((x) => x.code === task.complianceTypeCode);
    const client = db.clients.find((c) => c.id === task.clientId);
    if (!type || !client) continue;
    const p = dueForPeriod(type, client, task.periodKey!);
    if (!p) continue;
    task.provisional = p.provisional;
    if (p.due === task.originalDue) continue;
    task.originalDue = p.due;
    if (extensionFor(db, type.code, task.periodKey!)) continue; // a published extension still governs
    if (task.effectiveDue !== p.due) {
      task.dueHistory.push({ at: now, by: actor, from: task.effectiveDue, to: p.due, source });
      task.effectiveDue = p.due;
      reclassifyFiled(task, actor, now);
      task.updatedAt = now;
      task.updatedBy = actor;
      if (isOpen(task.status)) moved++;
    }
  }
  return moved;
}

function reclassifyFiled(task: Task, actor: string, now: string) {
  if (!task.ack || (task.status !== 'filed' && task.status !== 'filed_late')) return;
  const next: TaskStatus = task.ack.date <= task.effectiveDue ? 'filed' : 'filed_late';
  if (next !== task.status) {
    task.statusHistory.push({ at: now, by: actor, from: task.status, to: next, note: 'Reclassified after due-date change' });
    task.status = next;
  }
}

/** Publish an extension: every matching task moves; Filed Late may become Filed. */
export function applyExtension(db: DB, ext: DB['extensions'][number]): { moved: number; clients: number; reclassified: number } {
  let moved = 0;
  let reclassified = 0;
  const clients = new Set<string>();
  for (const task of db.tasks) {
    if (task.complianceTypeCode !== ext.complianceTypeCode || !ext.periodKeys.includes(task.periodKey!)) continue;
    if (task.status === 'not_applicable' || task.effectiveDue === ext.newDueDate) continue;
    task.dueHistory.push({
      at: ext.publishedAt,
      by: ext.publishedBy,
      from: task.effectiveDue,
      to: ext.newDueDate,
      source: 'extension',
      reference: ext.reference,
    });
    task.effectiveDue = ext.newDueDate;
    const before = task.status;
    reclassifyFiled(task, ext.publishedBy, ext.publishedAt);
    if (before !== task.status) reclassified++;
    task.updatedAt = ext.publishedAt;
    task.updatedBy = ext.publishedBy;
    if (isOpen(task.status)) {
      moved++;
      clients.add(task.clientId);
    }
  }
  return { moved, clients: clients.size, reclassified };
}

export function isOverdue(task: Pick<Task, 'status' | 'effectiveDue'>, ref: ISODate = today()) {
  return isOpen(task.status) && task.effectiveDue < ref;
}
