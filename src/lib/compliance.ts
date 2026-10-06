// Compliance calendar engine (spec §6, Rules Spec V1): applicability flags + the
// editable Due-Date Master generate recurring compliance tasks; extensions and
// master edits move every affected open task and record the change.
//
// Schema v5: GST types generate once per GSTIN (A19), DIR-3 KYC once per director
// when directors are recorded (A20), and each (client, type) pair can carry a
// compliance start date so periods before it are never generated (Rules §3.3).

import type {
  Client,
  ComplianceType,
  DB,
  DueRule,
  Engagement,
  FlagKey,
  GstFrequency,
  GstRegistration,
  ISODate,
  Task,
  TaskStatus,
  Director,
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

type ClientLike = Pick<Client, 'constitution' | 'profile' | 'status' | 'gstins' | 'directors' | 'agmDate' | 'auditorAppointmentDate'> &
  Partial<Pick<Client, 'id' | 'complianceStartDates'>>;

/** GST frequency of a registration for a period starting on `start`. */
export function gstFrequencyAt(g: GstRegistration, start: ISODate): GstFrequency {
  let f: GstFrequency = g.frequency;
  const hist = [...(g.frequencyHistory ?? [])].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  if (hist.length) {
    f = hist[0].frequency;
    for (const h of hist) if (h.effectiveFrom <= start) f = h.frequency;
  }
  return f;
}

export function derivedFlags(c: Pick<Client, 'constitution' | 'profile'> & { gstins?: GstRegistration[] }, gst?: GstRegistration, periodStartDate?: ISODate): Record<FlagKey, string> {
  const p = c.profile;
  const isCompany = c.constitution === 'private_company' || c.constitution === 'public_company';
  const isLLP = c.constitution === 'llp';
  const activeGst = (c.gstins ?? []).filter((g) => g.status === 'active');
  const freq = gst ? (periodStartDate ? gstFrequencyAt(gst, periodStartDate) : gst.frequency) : 'not_set';
  return {
    gstRegistered: String(activeGst.length > 0),
    gstFrequency: gst && gst.status === 'active' ? freq : 'not_set',
    gstAnnualReturn: String(!!gst?.gstAnnualReturn),
    gst9c: String(!!gst?.gst9c),
    iffOpted: String(!!gst?.iffOpted),
    tds: String(p.tds),
    tdsSalary: String(p.tdsSalary),
    tdsNonSalary: String(p.tdsNonSalary),
    tdsNonResident: String(p.tdsNonResident),
    tcs: String(p.tcs),
    advanceTax: String(p.advanceTax),
    taxAudit: String(p.taxAudit),
    // statutory audit is mandatory for companies (Rules §1.2)
    statutoryAudit: String(p.statutoryAudit || isCompany),
    transferPricing: String(p.transferPricing),
    pf: String(p.pf),
    esi: String(p.esi),
    isCompany: String(isCompany),
    isLLP: String(isLLP),
    // ITR due date for companies and anyone whose accounts must be audited
    auditCase: String(isCompany || p.taxAudit || p.statutoryAudit),
  };
}

/** A generation unit: the client itself, one GSTIN, or one director. */
export interface Unit {
  key: string; // '' for client-level
  gst?: GstRegistration;
  director?: Director;
}

export function unitsFor(t: ComplianceType, c: ClientLike): Unit[] {
  if (t.scope === 'gstin') return (c.gstins ?? []).filter((g) => g.status === 'active').map((g) => ({ key: g.id, gst: g }));
  if (t.scope === 'director') {
    const ds = (c.directors ?? []).filter((d) => d.active);
    // no directors recorded yet → one client-level obligation (kept from v4)
    return ds.length ? ds.map((d) => ({ key: d.id, director: d })) : [{ key: '' }];
  }
  return [{ key: '' }];
}

/** Rules §7.4–7.5: dormant clients keep generating; discontinued clients stop. */
export function clientGenerates(c: Pick<Client, 'status'>) {
  return c.status !== 'discontinued';
}

export function typeApplies(t: ComplianceType, c: ClientLike, unit?: Unit, periodStartDate?: ISODate): boolean {
  if (!t.isActive || t.retired || !clientGenerates(c)) return false;
  const f = derivedFlags(c, unit?.gst, periodStartDate);
  return t.applicability.every((r) => f[r.flag] === r.value);
}

/** Does the type apply to the client through at least one unit (used for summaries and the client form). */
export function typeAppliesToClient(t: ComplianceType, c: ClientLike): boolean {
  return unitsFor(t, c).some((u) => typeApplies(t, c, u));
}

export function ruleText(rule: DueRule): string {
  switch (rule.kind) {
    case 'monthly':
      return `${ordinal(rule.day)} of following month${rule.quarterMonths ? ` (months ${rule.quarterMonths.join(' & ')} of the quarter)` : ''}${
        rule.marchOverride ? ` (March: ${rule.marchOverride.day} ${monthName(rule.marchOverride.month)})` : ''
      }`;
    case 'quarterly':
      return rule.dates.map((d) => `${d.day} ${monthName(d.month)}`).join(', ');
    case 'annual':
      return `${rule.day} ${monthName(rule.month)} after FY end`;
    case 'event':
      return `${rule.event === 'agm' ? 'AGM date' : 'Auditor appointment date'} + ${rule.offsetDays} days`;
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
  periodStart: ISODate;
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
  // Default: AGM by 30 September after FY end (6-month ceiling); provisional until the real date is recorded
  return { date: iso(fyStart + 1, 9, 30), provisional: true };
}

function eventDate(rule: Extract<DueRule, { kind: 'event' }>, client: Partial<Pick<Client, 'agmDate' | 'auditorAppointmentDate'>>, fyStart: number) {
  if (rule.event === 'auditor_appointment') {
    const d = client.auditorAppointmentDate;
    if (d && fyStartYear(d) === fyStart + 1) return { date: d, provisional: false };
  }
  return agmFor(client, fyStart); // auditor appointed at the AGM by default (Rules §4.1)
}

/** Calendar start of a period key. */
export function periodStartOf(periodKey: string): ISODate | null {
  let m = /^(\d{4})-(\d{2})$/.exec(periodKey);
  if (m) return `${m[1]}-${m[2]}-01`;
  m = /^FY(\d{4})-\d{2}-Q(\d)$/.exec(periodKey);
  if (m) {
    const qs = quarterStart(+m[1], +m[2]);
    return iso(qs.y, qs.m, 1);
  }
  m = /^FY(\d{4})-\d{2}$/.exec(periodKey);
  if (m) return `${m[1]}-04-01`;
  return null;
}

/** Due date for one period of a compliance type for a client. */
export function dueForPeriod(t: ComplianceType, client: Partial<ClientLike>, periodKey: string): PeriodDue | null {
  const rule = t.rule;
  if (rule.kind === 'monthly') {
    const m = /^(\d{4})-(\d{2})$/.exec(periodKey);
    if (!m) return null;
    const y = +m[1];
    const mo = +m[2];
    return { periodKey, periodLabel: monthLabel(y, mo), periodStart: `${m[1]}-${m[2]}-01`, due: monthlyDue(rule, y, mo), provisional: false, fyStart: mo >= 4 ? y : y - 1 };
  }
  if (rule.kind === 'quarterly') {
    const m = /^FY(\d{4})-\d{2}-Q(\d)$/.exec(periodKey);
    if (!m) return null;
    const fy = +m[1];
    const qn = +m[2];
    const qs = quarterStart(fy, qn);
    const d = rule.dates[qn - 1];
    const label = t.periodLabelStyle === 'instalment' ? `Instalment ${qn} · ${fyLabel(fy)}` : `Q${qn} ${fyLabel(fy)} (${QUARTER_MONTHS[qn - 1]})`;
    const start = iso(qs.y, qs.m, 1);
    return { periodKey, periodLabel: label, periodStart: start, due: firstOnOrAfter(start, d.month, d.day), provisional: false, fyStart: fy };
  }
  const m = /^FY(\d{4})-\d{2}$/.exec(periodKey);
  if (!m) return null;
  const fy = +m[1];
  const label = t.periodLabelStyle === 'ay' ? `${ayLabel(fy)} (${fyLabel(fy)})` : fyLabel(fy);
  const start = iso(fy, 4, 1);
  if (rule.kind === 'annual') {
    let { month, day } = rule;
    if (t.dueVariants && client.profile && client.constitution) {
      const f = derivedFlags(client as ClientLike);
      for (const v of t.dueVariants) if (f[v.when.flag] === v.when.value) ({ month, day } = v);
    }
    return { periodKey, periodLabel: label, periodStart: start, due: firstOnOrAfter(iso(fy + 1, 4, 1), month, day), provisional: false, fyStart: fy };
  }
  const ev = eventDate(rule, client, fy);
  return { periodKey, periodLabel: label, periodStart: start, due: addDays(ev.date, rule.offsetDays), provisional: ev.provisional, fyStart: fy };
}

/** All periods of a type whose due date falls within [from, to]. */
export function periodsInWindow(t: ComplianceType, client: Partial<ClientLike>, from: ISODate, to: ISODate): PeriodDue[] {
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
    const qm = t.rule.quarterMonths;
    while (`${y}-${pad(mo)}` <= end) {
      // position of the month inside its fiscal quarter (Apr = 1, May = 2, Jun = 3, …)
      const pos = ((mo - 4 + 12) % 3) + 1;
      if (!qm || qm.includes(pos)) keys.push(`${y}-${pad(mo)}`);
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

/** Natural key (Rules §3.3), extended with the GSTIN / director unit in v5. */
export const taskKey = (clientId: string, code: string, periodKey: string, unitKey = '') => `${clientId}|${code}|${periodKey}|${unitKey}`;

export const unitKeyOf = (t: Pick<Task, 'gstinId' | 'directorId'>) => t.gstinId ?? t.directorId ?? '';

/** The latest published extension for (type, period), if any. */
export function extensionFor(db: DB, code: string, periodKey: string) {
  let found: DB['extensions'][number] | undefined;
  for (const e of db.extensions) if (e.status !== 'superseded' && e.complianceTypeCode === code && e.periodKeys.includes(periodKey)) found = e;
  return found;
}

function pickAssignee(db: DB, clientId: string, t: ComplianceType | undefined): string | undefined {
  const members = db.clientTeam
    .filter((a) => a.clientId === clientId && a.role === 'staff')
    .map((a) => db.users.find((u) => u.id === a.userId)!)
    .filter((u) => u && u.active !== false);
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
    feeBasis: { type: 'recurring', amount: null, rate: null, retainerPeriod: null },
    startDate: iso(fyStart, 4, 1),
    endDate: iso(fyStart + 1, 3, 31),
    createdAt: nowIso(),
    createdBy: actor,
  };
  db.engagements.push(e);
  return e;
}

function unitSuffix(client: Client, unit: Unit): string {
  if (unit.gst && client.gstins.filter((g) => g.status === 'active').length > 1) return ` · ${unit.gst.state}`;
  if (unit.director) return ` · ${unit.director.name}`;
  return '';
}

export function newTask(db: DB, client: Client, t: ComplianceType, p: PeriodDue, actor: string, unit: Unit = { key: '' }): Task {
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
    title: `${t.shortName} · ${p.periodLabel}${unitSuffix(client, unit)}`,
    templateCode: t.templateCode,
    templateVersion: tpl?.version ?? 1,
    gstinId: unit.gst?.id ?? null,
    directorId: unit.director?.id ?? null,
    originalDue: p.due,
    effectiveDue: ext ? ext.newDueDate : p.due,
    provisional: p.provisional,
    status: 'upcoming',
    stageIndex: 0,
    pendingPeriods: [],
    signoff: null,
    review: null,
    reviewPoints: [],
    supersededByTaskId: null,
    assignedTo: pickAssignee(db, client.id, t),
    checkerId: client.managerId,
    budgetHours: t.defaultBudgetHours,
    checklist: (tpl?.checklist ?? []).map((name) => ({ id: uid(), name, status: 'not_requested' })),
    followUps: [],
    statusHistory: [{ at: now, by: actor, from: null, to: 'upcoming', note: 'Generated by compliance calendar' }],
    dueHistory: ext ? [{ at: ext.publishedAt, by: ext.publishedBy, from: p.due, to: ext.newDueDate, source: 'extension', reference: ext.reference }] : [],
    createdAt: now,
    updatedAt: now,
    updatedBy: actor,
  };
}

export interface SyncPlan {
  create: { type: ComplianceType; period: PeriodDue; unit: Unit }[];
  remove: Task[]; // upcoming, untouched → deleted
  markNA: Task[]; // had activity → kept as Not Applicable
}

/**
 * What a client's (possibly edited) profile means for its compliance tasks from
 * `from` forward. Pure — used for the live preview in the client form and for
 * the real sync.
 */
export function planClientSync(db: DB, client: ClientLike & { id: string }, from: ISODate = today(), to: ISODate = addDays(today(), HORIZON_DAYS)): SyncPlan {
  const existing = new Map<string, Task>();
  for (const t of db.tasks) if (t.clientId === client.id && t.kind === 'compliance') existing.set(taskKey(t.clientId, t.complianceTypeCode!, t.periodKey!, unitKeyOf(t)), t);

  const create: SyncPlan['create'] = [];
  const expected = new Set<string>();
  for (const t of db.complianceTypes) {
    if (!t.isActive || t.retired) continue;
    const start = client.complianceStartDates?.[t.code];
    for (const unit of unitsFor(t, client)) {
      for (const p of periodsInWindow(t, client, from, to)) {
        if (start && p.periodStart < start) continue; // never before the compliance start date (Rules §3.3)
        if (!typeApplies(t, client, unit, p.periodStart)) continue;
        const key = taskKey(client.id, t.code, p.periodKey, unit.key);
        expected.add(key);
        // a legacy task without a GSTIN/director link covers the whole period (v4 data)
        const legacy = unit.key !== '' && existing.has(taskKey(client.id, t.code, p.periodKey, ''));
        if (!existing.has(key) && !legacy) create.push({ type: t, period: p, unit });
      }
    }
  }

  const remove: Task[] = [];
  const markNA: Task[] = [];
  for (const [key, task] of existing) {
    if (!isOpen(task.status) || task.effectiveDue < from || task.effectiveDue > to) continue;
    const t = db.complianceTypes.find((x) => x.code === task.complianceTypeCode);
    if (t?.retired) continue; // retired types keep their remaining tasks
    if (t && t.scope !== 'client' && unitKeyOf(task) === '' && t.isActive && typeAppliesToClient(t, client)) continue; // legacy unlinked task
    if (expected.has(key)) continue;
    // a task outside the generation window logic but for an applicable unit/type is kept
    const start = periodStartOf(task.periodKey!) ?? task.originalDue;
    const unit = t ? unitsFor(t, client).find((u) => u.key === unitKeyOf(task)) : undefined;
    if (t && unit && typeApplies(t, client, unit, start)) continue;
    const touched =
      task.status !== 'upcoming' || task.stageIndex > 0 || task.followUps.length > 0 || db.entries.some((e) => e.taskId === task.id);
    (touched ? markNA : remove).push(task);
  }
  create.sort((a, b) => a.period.due.localeCompare(b.period.due));
  return { create, remove, markNA };
}

export function applyClientSync(db: DB, clientId: string, actor: string, reason: string, from?: ISODate) {
  const client = db.clients.find((c) => c.id === clientId)!;
  const plan = planClientSync(db, client, from);
  for (const { type, period, unit } of plan.create) {
    db.tasks.push(newTask(db, client, type, period, actor, unit));
    // the first generated period sets the compliance start date for the pair (Rules §3.3)
    client.complianceStartDates ??= {};
    if (!client.complianceStartDates[type.code] || period.periodStart < client.complianceStartDates[type.code])
      client.complianceStartDates[type.code] = period.periodStart;
  }
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

/** Re-derive due dates of a type's tasks after the master rule (or a client's event date) changes. */
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

/** Publish an extension: every matching task moves; Filed Late may become Filed (never the reverse). */
export function applyExtension(db: DB, ext: DB['extensions'][number]): { moved: number; clients: number; reclassified: number } {
  let moved = 0;
  let reclassified = 0;
  const clients = new Set<string>();
  for (const task of db.tasks) {
    if (task.complianceTypeCode !== ext.complianceTypeCode || !ext.periodKeys.includes(task.periodKey!)) continue;
    if (task.status === 'not_applicable' || task.effectiveDue === ext.newDueDate) continue;
    task.dueHistory.push({ at: ext.publishedAt, by: ext.publishedBy, from: task.effectiveDue, to: ext.newDueDate, source: 'extension', reference: ext.reference });
    task.effectiveDue = ext.newDueDate;
    const before = task.status;
    if (before === 'filed_late') reclassifyFiled(task, ext.publishedBy, ext.publishedAt); // Filed is never reversed
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
