import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type {
  AckType,
  ChecklistStatus,
  Client,
  ComplianceType,
  DB,
  Engagement,
  ExtensionInput,
  FollowUp,
  ISODate,
  Task,
  TaskStatus,
  TeamAssignment,
  User,
  WorkEntry,
} from './lib/types';
import { buildSeed } from './lib/seed';
import { DEMO_FILES } from './lib/seedV5';
import { boot as bootStorage, putFile, replaceAll, save as saveToStorage, type BootResult } from './lib/storage/persist';
import type { MigrationReport } from './lib/migrations';
import { applyClientSync, applyExtension, derivedFlags, recomputeDues } from './lib/compliance';
import { CONSTITUTION_LABEL, FLAG_LABEL, GST_FREQ_LABEL, isOpen, ROLE_LABEL, STATUS_LABEL } from './lib/master';
import { addDays, fmtDate, nowIso, today } from './lib/dates';
import { isLocked } from './lib/access';
import { uid } from './lib/util';

export type Route =
  | { name: 'home' }
  | { name: 'work'; date?: ISODate; view?: 'day' | 'week' }
  | { name: 'tasks'; filter?: string }
  | { name: 'task'; id: string }
  | { name: 'calendar' }
  | { name: 'clients' }
  | { name: 'client'; id: string; tab?: string }
  | { name: 'client-edit'; id?: string }
  | { name: 'engagements' }
  | { name: 'engagement'; id: string }
  | { name: 'engagement-edit'; id?: string; clientId?: string }
  | { name: 'master' }
  | { name: 'team' }
  | { name: 'settings' }
  | { name: 'templates' }
  | { name: 'audit' }
  | { name: 'more' };

export interface EntrySheetState {
  entryId?: string;
  date?: ISODate;
  clientId?: string;
  taskId?: string;
  prefill?: Partial<WorkEntry>;
}

export interface EntryInput {
  dates: ISODate[];
  clientId?: string;
  engagementId?: string;
  taskId?: string;
  stage?: string;
  internalCategory?: WorkEntry['internalCategory'];
  hours: number;
  description?: string;
  outcome?: string;
  location: WorkEntry['location'];
  clientSiteClientId?: string;
  ack?: { type: AckType; number: string };
}

export interface ClientInput extends Omit<Client, 'id' | 'code' | 'flagHistory' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'> {
  id?: string;
  team: TeamAssignment[];
}

type Result = { ok: true; message?: string } | { ok: false; error: string };

interface AppState {
  db: DB;
  currentUserId: string | null;
  route: Route;
  history: Route[];
  sheet: EntrySheetState | null;
  toast: { id: number; text: string } | null;

  hydrated: boolean;
  storageInfo: { source: BootResult['source']; persistent: boolean; reports: MigrationReport[] } | null;
  boot: () => Promise<void>;
  init: () => void;
  login: (userId: string) => void;
  logout: () => void;
  navigate: (r: Route) => void;
  back: () => void;
  notify: (text: string) => void;
  openSheet: (s: EntrySheetState) => void;
  closeSheet: () => void;
  resetDemo: () => void;

  saveEntry: (input: EntryInput, entryId?: string) => Result;
  deleteEntry: (id: string) => Result;
  copyDay: (from: ISODate, to: ISODate) => Result;

  setTaskStage: (taskId: string, idx: number) => void;
  markPending: (taskId: string, what: string, items: string[]) => void;
  resumeFromPending: (taskId: string) => void;
  submitForReview: (taskId: string, checkerId: string) => Result;
  reviewDecision: (taskId: string, approve: boolean, note: string) => Result;
  raiseReviewPoint: (taskId: string, text: string) => void;
  clearReviewPoint: (taskId: string, pointId: string) => void;
  setChecklistNote: (taskId: string, itemId: string, note: string) => void;
  requestAllChecklist: (taskId: string) => void;
  recordFiling: (taskId: string, ackType: AckType, number: string, date: ISODate) => Result;
  markNotApplicable: (taskId: string, reason: string) => Result;
  reopenTask: (taskId: string) => void;
  assignTask: (taskId: string, userId: string) => void;
  addChecklistItem: (taskId: string, name: string) => void;
  setChecklistStatus: (taskId: string, itemId: string, status: ChecklistStatus) => void;
  removeChecklistItem: (taskId: string, itemId: string) => void;
  addFollowUp: (taskId: string, f: Omit<FollowUp, 'id' | 'by'>) => void;

  saveClient: (input: ClientInput) => { clientId: string; created: number; removed: number; markedNA: number; moved: number };
  saveEngagement: (input: Omit<Engagement, 'id' | 'createdAt' | 'createdBy'> & { id?: string }) => string;
  setEngagementStatus: (id: string, status: Engagement['status']) => void;

  updateComplianceType: (code: string, patch: Partial<ComplianceType>) => { moved: number; created: number; removed: number };
  addComplianceType: (t: ComplianceType) => { created: number };
  publishExtension: (x: ExtensionInput) => { moved: number; clients: number; reclassified: number };
  updateTemplate: (code: string, patch: { stages?: string[]; checklist?: string[]; name?: string }, opts?: { moveOpenTasks?: boolean; stageMap?: number[]; note?: string }) => void;

  setLockSettings: (dayOffset: number, time: string) => void;
  extendLock: (weekStart: ISODate, userId: string | null, until: string, reason: string) => void;

  // E5 — every new collection goes through these, so every change is audited
  saveRecord: <K extends RecordCollection>(collection: K, record: DB[K][number]) => Result;
  deleteRecord: (collection: RecordCollection, id: string, reason?: string) => Result;
  logAccess: (entity: DB['accessLog'][number]['entity'], entityId: string | null, action: DB['accessLog'][number]['action'], detail: string) => void;
}

export type RecordCollection =
  | 'users'
  | 'leaveRequests'
  | 'udinRegister'
  | 'dscRegister'
  | 'dscMovements'
  | 'notices'
  | 'inwardOutward'
  | 'notificationState'
  | 'attachments'
  | 'importBatches';

const COLLECTION_ENTITY: Record<RecordCollection, DB['audit'][number]['entity']> = {
  users: 'user',
  leaveRequests: 'leave',
  udinRegister: 'udin',
  dscRegister: 'dsc',
  dscMovements: 'dsc',
  notices: 'notice',
  inwardOutward: 'inward_outward',
  notificationState: 'notification',
  attachments: 'attachment',
  importBatches: 'import',
};
const APPEND_ONLY: RecordCollection[] = ['dscMovements'];

/** Field-level differences for the audit trail (E5). Credentials are never written to the log. */
export function diffFields(before: object | undefined, after: object): { field: string; from: string; to: string }[] {
  const out: { field: string; from: string; to: string }[] = [];
  const b = (before ?? {}) as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (k === 'auth') {
      if (JSON.stringify(b[k]) !== JSON.stringify(a[k])) out.push({ field: 'auth', from: '(credentials)', to: '(credentials changed)' });
      continue;
    }
    const x = JSON.stringify(b[k] ?? null);
    const y = JSON.stringify(a[k] ?? null);
    if (x !== y) out.push({ field: k, from: x.length > 120 ? `${x.slice(0, 117)}…` : x, to: y.length > 120 ? `${y.slice(0, 117)}…` : y });
  }
  return out;
}

let bootOnce: Promise<BootResult> | null = null;

const SESSION_KEY = 'qepex-session';
function readSession(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}
function writeSession(id: string | null) {
  try {
    if (id) localStorage.setItem(SESSION_KEY, id);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* session only */
  }
}

async function writeDemoFiles(db: DB) {
  for (const a of db.attachments) {
    const make = DEMO_FILES[a.blobKey];
    if (make) await putFile(a.blobKey, make()).catch(() => undefined);
  }
}

function audit(db: DB, by: string, entity: DB['audit'][number]['entity'], entityId: string, action: string, detail?: string, changes?: DB['audit'][number]['changes']) {
  db.audit.unshift({ id: uid(), at: nowIso(), by, entity, entityId, action, detail, ...(changes?.length ? { changes } : {}) });
  if (db.audit.length > 800) db.audit.length = 800;
}

function actorLabel(db: DB, userId: string) {
  const u = db.users.find((x) => x.id === userId);
  return u ? `${ROLE_LABEL[u.role]} — ${u.name.replace(/^CA /, '')}` : userId;
}

function changeStatus(task: Task, to: TaskStatus, by: string, note?: string) {
  if (task.status === to) return;
  const now = nowIso();
  // leaving Pending from Client closes the waiting period
  if (task.status === 'pending_from_client' && to !== 'pending_from_client') {
    const open = task.pendingPeriods.find((p) => !p.to);
    if (open) open.to = now;
  }
  task.statusHistory.push({ at: now, by, from: task.status, to, note });
  task.status = to;
  task.updatedAt = now;
  task.updatedBy = by;
}

function taskLabel(db: DB, task: Task) {
  const c = db.clients.find((x) => x.id === task.clientId);
  return `${c?.code ?? ''} ${task.title}`;
}

function nextClientCode(db: DB) {
  const max = Math.max(100, ...db.clients.map((c) => Number(c.code.replace(/\D/g, '')) || 0));
  return `CL-${String(max + 1).padStart(4, '0')}`;
}

function profileDiff(before: Client | undefined, after: Pick<Client, 'constitution' | 'profile'>) {
  const changes: { flag: string; oldValue: string; newValue: string }[] = [];
  const a = before ? derivedFlags(before) : null;
  const b = derivedFlags(after);
  for (const k of Object.keys(b) as (keyof typeof b)[]) {
    if (k === 'gstRegistered' || k === 'auditCase') continue;
    const oldV = a ? a[k] : 'false';
    if (oldV !== b[k]) {
      const fmt = (v: string) => (k === 'gstFrequency' ? GST_FREQ_LABEL[v as keyof typeof GST_FREQ_LABEL] : v === 'true' ? 'On' : 'Off');
      if (!a && (b[k] === 'false' || b[k] === 'not_applicable')) continue;
      changes.push({ flag: FLAG_LABEL[k], oldValue: a ? fmt(oldV) : '—', newValue: fmt(b[k]) });
    }
  }
  return changes;
}

export const useApp = create<AppState>()(
    immer((set, get) => {
      const me = () => get().currentUserId ?? 'system';
      return {
        // replaced by boot() before anything renders
        db: null as unknown as DB,
        hydrated: false,
        storageInfo: null,
        currentUserId: null,
        route: { name: 'home' },
        history: [],
        sheet: null,
        toast: null,

        boot: async () => {
          // React StrictMode runs effects twice in development; boot only once
          bootOnce ??= bootStorage(() => buildSeed());
          const r = await bootOnce;
          if (get().hydrated) return;
          if (r.source === 'seed') await writeDemoFiles(r.db);
          const session = readSession();
          set((s) => {
            s.db = r.db;
            s.hydrated = true;
            s.storageInfo = { source: r.source, persistent: r.persistent, reports: r.reports };
            s.currentUserId = session && r.db.users.some((u) => u.id === session && u.active) ? session : null;
          });
        },

        init: () =>
          set((s) => {
            // Nightly-job equivalent: extend every active client's calendar to the horizon
            for (const c of s.db.clients) if (c.status === 'active') applyClientSync(s.db, c.id, 'u-farhan', 'Applicability changed', today());
          }),

        login: (userId) =>
          set((s) => {
            writeSession(userId);
            s.currentUserId = userId;
            s.route = { name: 'home' };
            s.history = [];
            s.sheet = null;
          }),
        logout: () =>
          set((s) => {
            writeSession(null);
            s.currentUserId = null;
            s.sheet = null;
          }),
        navigate: (r) =>
          set((s) => {
            s.history.push(s.route);
            if (s.history.length > 30) s.history.shift();
            s.route = r;
          }),
        back: () =>
          set((s) => {
            s.route = s.history.pop() ?? { name: 'home' };
          }),
        notify: (text) =>
          set((s) => {
            s.toast = { id: Date.now(), text };
          }),
        openSheet: (sheet) =>
          set((s) => {
            s.sheet = sheet;
          }),
        closeSheet: () =>
          set((s) => {
            s.sheet = null;
          }),
        resetDemo: () => {
          const fresh = buildSeed();
          replaceAll(fresh);
          void writeDemoFiles(fresh);
          set((s) => {
            s.db = fresh;
            s.route = { name: 'home' };
            s.history = [];
            s.sheet = null;
            s.toast = { id: Date.now(), text: 'Demo data reset' };
          });
        },

        saveEntry: (input, entryId) => {
          const st = get();
          const db = st.db;
          const userId = me();
          if (!input.dates.length) return { ok: false, error: 'Pick at least one date.' };
          if (input.hours < 0 || input.hours > 12 || Math.round(input.hours * 4) !== input.hours * 4)
            return { ok: false, error: 'Hours must be between 0 and 12, in 15-minute steps.' };
          if (!input.clientId && !input.internalCategory) return { ok: false, error: 'Choose a client or an internal category.' };
          if (input.clientId && !input.taskId && !input.engagementId) return { ok: false, error: 'Choose the engagement or compliance task.' };
          const t = today();
          for (const d of input.dates) {
            if (d > t) return { ok: false, error: 'Work can only be logged for today or earlier.' };
            if (isLocked(db, userId, d)) return { ok: false, error: `The week of ${fmtDate(d)} is locked. A Partner can extend the lock.` };
          }
          const existing = entryId ? db.entries.find((e) => e.id === entryId) : undefined;
          if (existing && isLocked(db, existing.userId, existing.date)) return { ok: false, error: 'This entry is in a locked week.' };
          let message = entryId ? 'Entry updated' : input.dates.length > 1 ? `${input.dates.length} entries saved` : 'Work saved';
          set((s) => {
            const now = nowIso();
            const base = {
              clientId: input.clientId,
              engagementId: input.engagementId,
              taskId: input.taskId,
              stage: input.stage,
              internalCategory: input.clientId ? undefined : input.internalCategory,
              hours: input.hours,
              description: input.description?.trim() || undefined,
              outcome: input.outcome?.trim() || undefined,
              location: input.location,
              clientSiteClientId: input.location === 'client_site' ? input.clientSiteClientId ?? input.clientId : undefined,
            };
            if (entryId) {
              const e = s.db.entries.find((x) => x.id === entryId)!;
              Object.assign(e, base, { date: input.dates[0], updatedAt: now, modifiedBy: userId });
              audit(s.db, userId, 'entry', e.id, e.userId === userId ? 'Entry edited' : `Entry edited · Modified by ${actorLabel(s.db, userId)}`, `${input.hours} h on ${fmtDate(e.date)}`);
            } else {
              for (const d of input.dates) {
                const e: WorkEntry = { id: uid(), userId, date: d, ...base, createdAt: now, updatedAt: now, modifiedBy: userId };
                s.db.entries.push(e);
              }
              audit(s.db, userId, 'entry', '', 'Work logged', `${input.hours} h × ${input.dates.length} day(s)`);
            }
            // Progress: logging work at a later stage moves the task forward
            const task = input.taskId ? s.db.tasks.find((x) => x.id === input.taskId) : undefined;
            if (task && input.stage) {
              const tpl = s.db.templates.find((x) => x.code === task.templateCode)!;
              const idx = tpl.stages.indexOf(input.stage);
              const fi = tpl.filingStageIndex;
              if (input.ack?.number && fi !== null && idx >= fi && isOpen(task.status)) {
                const date = input.dates[input.dates.length - 1];
                fileInto(s.db, task, input.ack.type, input.ack.number.trim(), date, userId);
                message = `${task.title.split(' · ')[0]} filed — ${input.ack.number.trim()} recorded`;
              } else if (idx > task.stageIndex) {
                const cap = isOpen(task.status) && fi !== null ? fi - 1 : idx;
                if (Math.min(idx, cap) > task.stageIndex) task.stageIndex = Math.min(idx, cap);
              }
              if (task.status === 'upcoming') changeStatus(task, 'in_progress', userId, 'Work logged');
            }
          });
          return { ok: true, message };
        },

        deleteEntry: (id) => {
          const db = get().db;
          const e = db.entries.find((x) => x.id === id);
          if (!e) return { ok: false, error: 'Entry not found.' };
          if (isLocked(db, e.userId, e.date)) return { ok: false, error: 'This entry is in a locked week.' };
          set((s) => {
            s.db.entries = s.db.entries.filter((x) => x.id !== id);
            audit(s.db, me(), 'entry', id, 'Entry deleted', `${e.hours} h on ${fmtDate(e.date)}`);
          });
          return { ok: true, message: 'Entry deleted' };
        },

        copyDay: (from, to) => {
          const db = get().db;
          const userId = me();
          if (isLocked(db, userId, to)) return { ok: false, error: 'That day is in a locked week.' };
          if (to > today()) return { ok: false, error: 'Work can only be logged for today or earlier.' };
          const src = db.entries.filter((e) => e.userId === userId && e.date === from && e.internalCategory !== 'leave');
          if (!src.length) return { ok: false, error: `Nothing logged on ${fmtDate(from)} to copy.` };
          set((s) => {
            const now = nowIso();
            for (const e of src) s.db.entries.push({ ...e, id: uid(), date: to, outcome: undefined, createdAt: now, updatedAt: now, modifiedBy: userId });
            audit(s.db, userId, 'entry', '', 'Day copied', `${src.length} entries from ${fmtDate(from)} to ${fmtDate(to)}`);
          });
          return { ok: true, message: `${src.length} entries copied — adjust hours as needed` };
        },

        setTaskStage: (taskId, idx) =>
          set((s) => {
            const task = s.db.tasks.find((t) => t.id === taskId)!;
            const tpl = s.db.templates.find((x) => x.code === task.templateCode)!;
            task.stageIndex = idx;
            task.updatedAt = nowIso();
            task.updatedBy = me();
            if (task.status === 'upcoming') changeStatus(task, 'in_progress', me(), 'Stage updated');
            audit(s.db, me(), 'task', taskId, 'Stage changed', `${taskLabel(s.db, task)} → ${tpl.stages[idx]}`);
          }),

        markPending: (taskId, what, items) =>
          set((s) => {
            const task = s.db.tasks.find((t) => t.id === taskId)!;
            const t = today();
            for (const name of items) {
              let item = task.checklist.find((c) => c.name.toLowerCase() === name.toLowerCase());
              if (!item) {
                item = { id: uid(), name, status: 'requested' };
                task.checklist.push(item);
              }
              if (item.status !== 'received') {
                item.status = 'requested';
                item.dateRequested ??= t;
              }
            }
            changeStatus(task, 'pending_from_client', me(), what);
            task.pendingPeriods.push({ from: nowIso(), what });
            audit(s.db, me(), 'task', taskId, 'Marked Pending from Client', `${taskLabel(s.db, task)} · ${what}`);
            s.toast = { id: Date.now(), text: 'Marked Pending from Client' };
          }),

        resumeFromPending: (taskId) =>
          set((s) => {
            const task = s.db.tasks.find((t) => t.id === taskId)!;
            changeStatus(task, 'in_progress', me(), 'Client data received');
            audit(s.db, me(), 'task', taskId, 'Resumed — data received', taskLabel(s.db, task));
            s.toast = { id: Date.now(), text: 'Back in progress' };
          }),

        submitForReview: (taskId, checkerId) => {
          if (checkerId === me()) return { ok: false, error: 'You cannot be both maker and checker on the same task.' };
          set((s) => {
            const task = s.db.tasks.find((t) => t.id === taskId)!;
            task.checkerId = checkerId;
            task.review = { submittedBy: me(), submittedAt: nowIso(), checkerId, decision: null, decidedAt: null };
            changeStatus(task, 'under_review', me(), `Submitted to ${actorLabel(s.db, checkerId)}`);
            audit(s.db, me(), 'task', taskId, 'Submitted for review', taskLabel(s.db, task));
            s.toast = { id: Date.now(), text: 'Submitted for review' };
          });
          return { ok: true };
        },

        reviewDecision: (taskId, approve, note) => {
          const task0 = get().db.tasks.find((t) => t.id === taskId);
          if (!task0) return { ok: false, error: 'Task not found.' };
          const maker = task0.review?.submittedBy ?? task0.assignedTo;
          if (maker === me()) return { ok: false, error: 'You cannot be both maker and checker on the same task.' };
          if (get().db.users.find((u) => u.id === me())?.role === 'article') return { ok: false, error: 'Article assistants are always makers, never checkers.' };
          if (approve && task0.reviewPoints.some((p) => !p.clearedAt)) return { ok: false, error: 'Clear the open review points before approving.' };
          if (!approve && !note.trim()) return { ok: false, error: 'Add at least one review point.' };
          set((s) => {
            const task = s.db.tasks.find((t) => t.id === taskId)!;
            const tpl = s.db.templates.find((x) => x.code === task.templateCode)!;
            const now = nowIso();
            if (approve && task.stageIndex < (tpl.filingStageIndex ?? tpl.stages.length) - 1) task.stageIndex += 1;
            if (!approve)
              for (const line of note.split('\n').map((x) => x.trim()).filter(Boolean))
                task.reviewPoints.push({ id: uid(), text: line, raisedBy: me(), raisedAt: now, clearedBy: null, clearedAt: null });
            task.review = { ...(task.review ?? { submittedBy: maker ?? me(), submittedAt: now, checkerId: me() }), checkerId: me(), decision: approve ? 'approved' : 'returned', decidedAt: now };
            changeStatus(task, 'in_progress', me(), approve ? `Review approved${note ? ` — ${note}` : ''}` : `Returned with review points: ${note}`);
            audit(s.db, me(), 'task', taskId, approve ? 'Review approved' : 'Returned to maker', `${taskLabel(s.db, task)}${note ? ` · ${note}` : ''}`);
            s.toast = { id: Date.now(), text: approve ? 'Approved' : 'Returned to maker' };
          });
          return { ok: true };
        },

        raiseReviewPoint: (taskId, text) =>
          set((s) => {
            const task = s.db.tasks.find((t) => t.id === taskId)!;
            task.reviewPoints.push({ id: uid(), text, raisedBy: me(), raisedAt: nowIso(), clearedBy: null, clearedAt: null });
            audit(s.db, me(), 'task', taskId, 'Review point raised', `${taskLabel(s.db, task)} · ${text}`);
          }),

        clearReviewPoint: (taskId, pointId) =>
          set((s) => {
            const task = s.db.tasks.find((t) => t.id === taskId)!;
            const p = task.reviewPoints.find((x) => x.id === pointId)!;
            p.clearedBy = me();
            p.clearedAt = nowIso();
            audit(s.db, me(), 'task', taskId, 'Review point cleared', `${taskLabel(s.db, task)} · ${p.text}`);
          }),

        setChecklistNote: (taskId, itemId, note) =>
          set((s) => {
            const task = s.db.tasks.find((t) => t.id === taskId)!;
            const item = task.checklist.find((c) => c.id === itemId)!;
            item.note = note || undefined;
            audit(s.db, me(), 'task', taskId, 'Checklist note', `${item.name}: ${note}`);
          }),

        requestAllChecklist: (taskId) =>
          set((s) => {
            const task = s.db.tasks.find((t) => t.id === taskId)!;
            let n = 0;
            for (const c of task.checklist)
              if (c.status === 'not_requested') {
                c.status = 'requested';
                c.dateRequested = today();
                n++;
              }
            audit(s.db, me(), 'task', taskId, 'Checklist: all requested', `${taskLabel(s.db, task)} · ${n} item(s)`);
          }),

        recordFiling: (taskId, ackType, number, date) => {
          if (!number.trim()) return { ok: false, error: 'Enter the acknowledgment number — a task closes only once it is recorded.' };
          if (date > today()) return { ok: false, error: 'Filing date cannot be in the future.' };
          const blocked = filingBlock(get().db, taskId);
          if (blocked) return { ok: false, error: blocked };
          let status: TaskStatus = 'filed';
          set((s) => {
            const task = s.db.tasks.find((t) => t.id === taskId)!;
            status = fileInto(s.db, task, ackType, number.trim(), date, me());
          });
          return { ok: true, message: status === 'filed' ? 'Filed on time' : 'Recorded as Filed Late' };
        },

        markNotApplicable: (taskId, reason) => {
          const t0 = get().db.tasks.find((t) => t.id === taskId);
          if (!t0) return { ok: false, error: 'Task not found.' };
          if (t0.status === 'filed' || t0.status === 'filed_late') return { ok: false, error: 'A filed task cannot be marked Not Applicable.' };
          if (!reason.trim()) return { ok: false, error: 'Give a reason.' };
          set((s) => {
            const task = s.db.tasks.find((t) => t.id === taskId)!;
            task.naReason = reason;
            changeStatus(task, 'not_applicable', me(), reason);
            audit(s.db, me(), 'task', taskId, 'Marked Not Applicable', `${taskLabel(s.db, task)} · ${reason}`);
          });
          return { ok: true };
        },

        reopenTask: (taskId) =>
          set((s) => {
            const task = s.db.tasks.find((t) => t.id === taskId)!;
            task.naReason = undefined;
            changeStatus(task, task.stageIndex > 0 ? 'in_progress' : 'upcoming', me(), 'Reopened');
            audit(s.db, me(), 'task', taskId, 'Reopened', taskLabel(s.db, task));
          }),

        assignTask: (taskId, userId) =>
          set((s) => {
            const task = s.db.tasks.find((t) => t.id === taskId)!;
            task.assignedTo = userId;
            audit(s.db, me(), 'task', taskId, 'Reassigned', `${taskLabel(s.db, task)} → ${actorLabel(s.db, userId)}`);
          }),

        addChecklistItem: (taskId, name) =>
          set((s) => {
            const task = s.db.tasks.find((t) => t.id === taskId)!;
            task.checklist.push({ id: uid(), name, status: 'not_requested' });
          }),

        setChecklistStatus: (taskId, itemId, status) =>
          set((s) => {
            const task = s.db.tasks.find((t) => t.id === taskId)!;
            const item = task.checklist.find((c) => c.id === itemId)!;
            item.status = status;
            if (status === 'requested') item.dateRequested ??= today();
            if (status === 'received') {
              item.dateRequested ??= today();
              item.dateReceived = today();
            } else item.dateReceived = undefined;
            if (status === 'not_requested') item.dateRequested = undefined;
            audit(s.db, me(), 'task', taskId, 'Checklist updated', `${item.name} → ${status.replace('_', ' ')}`);
          }),

        removeChecklistItem: (taskId, itemId) =>
          set((s) => {
            const task = s.db.tasks.find((t) => t.id === taskId)!;
            task.checklist = task.checklist.filter((c) => c.id !== itemId);
          }),

        addFollowUp: (taskId, f) =>
          set((s) => {
            const task = s.db.tasks.find((t) => t.id === taskId)!;
            task.followUps.push({ ...f, id: uid(), by: me() });
            audit(s.db, me(), 'task', taskId, 'Client follow-up logged', `${f.channel} · ${f.notes}`);
            s.toast = { id: Date.now(), text: 'Follow-up recorded' };
          }),

        saveClient: (input) => {
          let out = { clientId: '', created: 0, removed: 0, markedNA: 0, moved: 0 };
          set((s) => {
            const db = s.db;
            const now = nowIso();
            const by = me();
            const { team, id, ...fields } = input;
            let client = id ? db.clients.find((c) => c.id === id) : undefined;
            const before = client ? (JSON.parse(JSON.stringify(client)) as Client) : undefined;
            const changes = profileDiff(before, fields);
            if (!client) {
              client = { ...fields, id: uid(), code: nextClientCode(db), flagHistory: [], createdAt: now, createdBy: by, updatedAt: now, updatedBy: by };
              db.clients.push(client);
              audit(db, by, 'client', client.id, 'Client created', `${client.code} ${client.name} · ${CONSTITUTION_LABEL[client.constitution]}`);
            } else {
              Object.assign(client, fields, { updatedAt: now, updatedBy: by });
              audit(db, by, 'client', client.id, 'Client updated', `${client.code} ${client.name}`);
            }
            for (const c of changes) {
              client.flagHistory.push({ at: now, by, flag: c.flag, oldValue: c.oldValue, newValue: c.newValue });
              if (before) audit(db, by, 'client', client.id, 'Applicability flag changed', `${client.code} · ${c.flag}: ${c.oldValue} → ${c.newValue}`);
            }
            // client team (drives scoping)
            const cid = client.id;
            db.clientTeam = db.clientTeam.filter((a) => a.clientId !== cid).concat(team.map((a) => ({ ...a, clientId: cid })));
            for (const e of db.engagements.filter((x) => x.clientId === cid && x.type === 'recurring')) {
              e.partnerId = client.partnerId;
              e.managerId = client.managerId;
              for (const a of team) if (!e.team.some((m) => m.userId === a.userId)) e.team.push({ userId: a.userId, role: a.role === 'reviewer' ? 'checker' : 'maker' });
            }
            // AGM date change moves event-linked tasks
            let moved = 0;
            if (before && before.agmDate !== client.agmDate)
              moved = recomputeDues(db, by, (t) => t.clientId === cid && isOpen(t.status), 'event_correction');
            const r = applyClientSync(db, cid, by, `Applicability changed on ${fmtDate(today())}`);
            if (r.created || r.removed || r.markedNA)
              audit(db, by, 'client', cid, 'Compliance calendar regenerated', `${r.created} created · ${r.removed} removed · ${r.markedNA} marked N/A`);
            out = { clientId: cid, ...r, moved };
          });
          return out;
        },

        saveEngagement: (input) => {
          let id = input.id ?? '';
          set((s) => {
            const db = s.db;
            const by = me();
            const now = nowIso();
            const { id: _ignored, ...fields } = input;
            void _ignored;
            let eng = input.id ? db.engagements.find((e) => e.id === input.id) : undefined;
            if (eng) {
              Object.assign(eng, fields);
              audit(db, by, 'engagement', eng.id, 'Engagement updated', eng.title);
            } else {
              eng = { ...fields, id: uid(), createdAt: now, createdBy: by };
              db.engagements.push(eng);
              audit(db, by, 'engagement', eng.id, 'Engagement created', eng.title);
            }
            id = eng.id;
            // anyone assigned to the engagement joins the client team, so scoping lets them log against it
            for (const m of eng.team) {
              const u = db.users.find((x) => x.id === m.userId);
              if (!u || u.role === 'partner' || u.role === 'admin') continue;
              if (u.role === 'manager' && db.clients.find((c) => c.id === eng!.clientId)?.managerId === u.id) continue;
              if (!db.clientTeam.some((a) => a.clientId === eng!.clientId && a.userId === m.userId))
                db.clientTeam.push({ clientId: eng.clientId, userId: m.userId, role: m.role === 'checker' ? 'reviewer' : 'staff' });
            }
            if (eng.type === 'one_time') {
              let task = db.tasks.find((t) => t.engagementId === eng!.id && t.kind === 'engagement');
              const tpl = db.templates.find((t) => t.code === eng!.templateCode)!;
              const due = eng.endDate ?? addDays(today(), 30);
              if (!task) {
                task = {
                  id: uid(),
                  clientId: eng.clientId,
                  engagementId: eng.id,
                  kind: 'engagement',
                  periodLabel: eng.financialYear ?? '',
                  title: eng.title,
                  templateCode: eng.templateCode,
                  templateVersion: tpl.version,
                  gstinId: null,
                  directorId: null,
                  signoff: null,
                  review: null,
                  reviewPoints: [],
                  supersededByTaskId: null,
                  originalDue: due,
                  effectiveDue: due,
                  status: 'upcoming',
                  stageIndex: 0,
                  pendingPeriods: [],
                  checklist: tpl.checklist.map((name) => ({ id: uid(), name, status: 'not_requested' })),
                  followUps: [],
                  statusHistory: [{ at: now, by, from: null, to: 'upcoming', note: 'Engagement created' }],
                  dueHistory: [],
                  createdAt: now,
                  updatedAt: now,
                  updatedBy: by,
                };
                db.tasks.push(task);
              } else {
                if (task.effectiveDue !== due) {
                  task.dueHistory.push({ at: now, by, from: task.effectiveDue, to: due, source: 'manual_correction' });
                  task.effectiveDue = due;
                  task.originalDue = due;
                }
                if (task.templateCode !== eng.templateCode) {
                  task.templateCode = eng.templateCode;
                  task.stageIndex = Math.min(task.stageIndex, tpl.stages.length - 1);
                }
                task.title = eng.title;
              }
              task.assignedTo = eng.team.find((m) => m.role === 'maker')?.userId;
              task.checkerId = eng.team.find((m) => m.role === 'checker')?.userId ?? eng.managerId;
              task.budgetHours = eng.budgetHours;
            } else {
              for (const t of db.tasks.filter((x) => x.engagementId === eng!.id)) t.budgetHours = eng.budgetHours;
            }
          });
          return id;
        },

        setEngagementStatus: (id, status) =>
          set((s) => {
            const e = s.db.engagements.find((x) => x.id === id)!;
            e.status = status;
            audit(s.db, me(), 'engagement', id, `Engagement ${status.replace('_', ' ')}`, e.title);
          }),

        updateComplianceType: (code, patch) => {
          let out = { moved: 0, created: 0, removed: 0 };
          set((s) => {
            const db = s.db;
            const t = db.complianceTypes.find((x) => x.code === code)!;
            const before = JSON.stringify(t);
            Object.assign(t, patch);
            if (JSON.stringify(t) === before) return;
            const moved = recomputeDues(db, me(), (x) => x.complianceTypeCode === code, 'master_change');
            let created = 0;
            let removed = 0;
            for (const c of db.clients) {
              if (c.status !== 'active') continue;
              const r = applyClientSync(db, c.id, me(), `${t.name} deactivated in Due-Date Master`);
              created += r.created;
              removed += r.removed + r.markedNA;
            }
            audit(db, me(), 'due_date', code, 'Due-date master updated', `${t.name}: ${moved} open task(s) moved`);
            out = { moved, created, removed };
          });
          return out;
        },

        addComplianceType: (t) => {
          let created = 0;
          set((s) => {
            s.db.complianceTypes.push(t);
            for (const c of s.db.clients) if (c.status === 'active') created += applyClientSync(s.db, c.id, me(), '').created;
            audit(s.db, me(), 'due_date', t.code, 'Compliance type added', `${t.name} · ${created} task(s) generated`);
          });
          return { created };
        },

        publishExtension: (x) => {
          let out = { moved: 0, clients: 0, reclassified: 0 };
          set((s) => {
            const ext = { ...x, supersedesId: x.supersedesId ?? null, status: 'published' as const, id: uid(), publishedAt: nowIso(), publishedBy: me(), tasksMoved: 0 };
            if (ext.supersedesId) {
              const old = s.db.extensions.find((e) => e.id === ext.supersedesId);
              if (old) old.status = 'superseded';
            }
            out = applyExtension(s.db, ext);
            ext.tasksMoved = out.moved;
            s.db.extensions.push(ext);
            const t = s.db.complianceTypes.find((c) => c.code === x.complianceTypeCode);
            audit(s.db, me(), 'due_date', x.complianceTypeCode, 'Extension published', `${t?.name}: → ${fmtDate(x.newDueDate)} · ${out.moved} open task(s) moved across ${out.clients} client(s)${x.reference ? ` · ${x.reference}` : ''}`);
          });
          return out;
        },

        // A27 — a new version applies to new tasks; open tasks move only when asked, with a stage mapping
        updateTemplate: (code, patch, opts) =>
          set((s) => {
            const t = s.db.templates.find((x) => x.code === code)!;
            Object.assign(t, patch);
            if (t.filingStageIndex !== null && t.filingStageIndex >= t.stages.length) t.filingStageIndex = t.stages.length - 1;
            t.version += 1;
            t.versions.push({
              version: t.version, name: t.name, stages: [...t.stages], checklist: [...t.checklist], filingStageIndex: t.filingStageIndex,
              ackType: t.ackType, reviewLevel: t.reviewLevel, effectiveFrom: nowIso(), createdBy: me(), note: opts?.note ?? '',
            });
            let moved = 0;
            if (opts?.moveOpenTasks)
              for (const task of s.db.tasks) {
                if (task.templateCode !== code || !isOpen(task.status)) continue;
                const mapped = opts.stageMap?.[task.stageIndex];
                task.stageIndex = Math.min(mapped ?? task.stageIndex, t.stages.length - 1);
                task.templateVersion = t.version;
                moved++;
              }
            audit(s.db, me(), 'template', code, `Stage template updated to version ${t.version}`, `${t.name}${moved ? ` · ${moved} open task(s) moved` : ' · open tasks stay on their version'}`);
          }),

        setLockSettings: (dayOffset, time) =>
          set((s) => {
            s.db.lockSettings = { dayOffset, time };
            audit(s.db, me(), 'lock', 'settings', 'Weekly lock time changed', `${dayOffset} days after Monday, ${time}`);
          }),

        extendLock: (weekStart, userId, until, reason) =>
          set((s) => {
            s.db.lockExtensions.push({ id: uid(), weekStart, userId, until, reason, by: me(), at: nowIso() });
            audit(s.db, me(), 'lock', weekStart, 'Weekly lock extended', `Week of ${fmtDate(weekStart)} for ${userId ? actorLabel(s.db, userId) : 'everyone'} until ${new Date(until).toLocaleString('en-IN')} · ${reason}`);
          }),

        saveRecord: (collection, record) => {
          const list = get().db[collection] as { id: string }[];
          const id = (record as { id: string }).id;
          if (!id) return { ok: false, error: 'Record needs an id.' };
          const before = list.find((r) => r.id === id);
          if (before && APPEND_ONLY.includes(collection)) return { ok: false, error: 'This register is append-only.' };
          const changes = diffFields(before, record);
          if (before && !changes.length) return { ok: true };
          set((s) => {
            const arr = s.db[collection] as { id: string }[];
            const i = arr.findIndex((r) => r.id === id);
            if (i >= 0) arr[i] = record as never;
            else arr.push(record as never);
            audit(s.db, me(), COLLECTION_ENTITY[collection], id, before ? `${collection} record updated` : `${collection} record added`, undefined, changes);
          });
          return { ok: true };
        },

        deleteRecord: (collection, id, reason) => {
          if (APPEND_ONLY.includes(collection)) return { ok: false, error: 'This register is append-only.' };
          if (collection === 'users') return { ok: false, error: 'Users are deactivated, never deleted.' };
          const before = (get().db[collection] as { id: string }[]).find((r) => r.id === id);
          if (!before) return { ok: false, error: 'Record not found.' };
          set((s) => {
            (s.db as unknown as Record<string, { id: string }[]>)[collection] = (s.db[collection] as { id: string }[]).filter((r) => r.id !== id);
            audit(s.db, me(), COLLECTION_ENTITY[collection], id, `${collection} record deleted`, reason, diffFields(before, {}));
          });
          return { ok: true };
        },

        logAccess: (entity, entityId, action, detail) =>
          set((s) => {
            s.db.accessLog.push({ id: uid(), at: nowIso(), userId: me(), entity, entityId, action, detail });
          }),
      };
    }),
);

// Every change to the data is written to SQLite (changed records only).
useApp.subscribe((s, prev) => {
  if (s.hydrated && prev.hydrated && s.db !== prev.db) saveToStorage(s.db);
});

/** A14 — filing is blocked while review points are open, the task is with the checker, or a required sign-off is missing. */
export function filingBlock(db: DB, taskId: string): string | null {
  const task = db.tasks.find((t) => t.id === taskId);
  if (!task) return 'Task not found.';
  const open = task.reviewPoints.filter((p) => !p.clearedAt).length;
  if (open) return `${open} review point${open === 1 ? ' is' : 's are'} still open.`;
  if (task.status === 'under_review') return 'The task is with the checker — filing opens once the review is approved.';
  const tpl = db.templates.find((t) => t.code === task.templateCode);
  if (tpl?.requiresSignoff && task.review?.decision !== 'approved') return `${tpl.reviewLevel} approval is needed before filing.`;
  return null;
}

function fileInto(db: DB, task: Task, ackType: AckType, number: string, date: ISODate, by: string): TaskStatus {
  const tpl = db.templates.find((x) => x.code === task.templateCode)!;
  task.ack = { type: ackType, number, date };
  if (tpl.filingStageIndex !== null) task.stageIndex = Math.max(task.stageIndex, tpl.filingStageIndex);
  else task.stageIndex = tpl.stages.length - 1;
  const status: TaskStatus = date <= task.effectiveDue ? 'filed' : 'filed_late';
  if (tpl.requiresSignoff) {
    let udinId: string | null = null;
    if (ackType === 'udin') {
      const client = db.clients.find((c) => c.id === task.clientId)!;
      udinId = uid();
      db.udinRegister.push({
        id: udinId, clientId: task.clientId, taskId: task.id, engagementId: task.engagementId, institute: 'icai', documentType: task.title.split(' · ')[0],
        dateOfSigning: date, signingPartnerId: task.review?.checkerId ?? client.partnerId, udin: number, dateGenerated: date, signedCopyRef: null,
        status: 'generated', reconciledAt: null, reconciledBy: null, notes: '', createdAt: nowIso(), createdBy: by,
      });
    }
    task.signoff = { by: task.review?.checkerId ?? by, at: nowIso(), udinId };
  }
  changeStatus(task, status, by, `${ackType.toUpperCase()} ${number}`);
  audit(db, by, 'task', task.id, STATUS_LABEL[status], `${taskLabel(db, task)} · ${ackType.toUpperCase()} ${number}`);
  return status;
}

export function useMe(): User | undefined {
  return useApp((s) => s.db.users.find((u) => u.id === s.currentUserId));
}

