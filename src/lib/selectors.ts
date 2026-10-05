import type { DB, ISODate, Task, User, WorkEntry } from './types';
import { addDays, diffDays, today, weekday } from './dates';
import { sum } from './util';

export const userById = (db: DB, id?: string) => db.users.find((u) => u.id === id);
export const clientById = (db: DB, id?: string) => db.clients.find((c) => c.id === id);
export const taskById = (db: DB, id?: string) => db.tasks.find((t) => t.id === id);
export const engagementById = (db: DB, id?: string) => db.engagements.find((e) => e.id === id);
export const templateByCode = (db: DB, code?: string) => db.templates.find((t) => t.code === code);
export const typeByCode = (db: DB, code?: string) => db.complianceTypes.find((t) => t.code === code);

export const firstName = (u?: User) => (u ? u.name.replace(/^CA /, '').split(' ')[0] : '—');

export function entriesOn(db: DB, userId: string, date: ISODate): WorkEntry[] {
  return db.entries.filter((e) => e.userId === userId && e.date === date).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function entriesBetween(db: DB, userId: string | null, from: ISODate, to: ISODate): WorkEntry[] {
  return db.entries.filter((e) => (userId === null || e.userId === userId) && e.date >= from && e.date <= to);
}

export const hoursOf = (xs: WorkEntry[]) => sum(xs.map((e) => e.hours));

export function taskHours(db: DB, taskId: string) {
  return hoursOf(db.entries.filter((e) => e.taskId === taskId));
}

export function engagementHours(db: DB, engagementId: string) {
  return hoursOf(db.entries.filter((e) => e.engagementId === engagementId));
}

export interface BudgetSignal {
  budget: number;
  used: number;
  remaining: number;
  overrun: number;
  pct: number;
  label: 'Normal' | 'Approaching Budget' | 'Budget Reached' | 'Significant Overrun';
  health: 'On Track' | 'At Risk' | 'Over Budget';
  tone: 'ok' | 'warn' | 'bad';
}

/** Spec §12 thresholds: <85% Normal, 85–99% Approaching, 100–109% Reached, 110%+ Significant Overrun. */
export function budgetSignal(used: number, budget?: number): BudgetSignal | null {
  if (!budget) return null;
  const pct = (used / budget) * 100;
  const base = { budget, used, remaining: Math.max(budget - used, 0), overrun: Math.max(used - budget, 0), pct };
  if (pct < 85) return { ...base, label: 'Normal', health: 'On Track', tone: 'ok' };
  if (pct < 100) return { ...base, label: 'Approaching Budget', health: 'At Risk', tone: 'warn' };
  if (pct < 110) return { ...base, label: 'Budget Reached', health: 'Over Budget', tone: 'bad' };
  return { ...base, label: 'Significant Overrun', health: 'Over Budget', tone: 'bad' };
}

/** Budget that applies to a task: recurring tasks carry a per-period budget, one-time work the engagement budget. */
export function taskBudget(db: DB, task: Task): { used: number; budget?: number; scope: 'period' | 'engagement' } {
  const eng = engagementById(db, task.engagementId);
  if (task.kind === 'engagement') return { used: engagementHours(db, task.engagementId), budget: eng?.budgetHours, scope: 'engagement' };
  return { used: taskHours(db, task.id), budget: task.budgetHours, scope: 'period' };
}

/** Days spent waiting on the client (tracked separately so staff aren't blamed for client delays). */
export function pendingDays(task: Task, now = new Date()): number {
  let ms = 0;
  for (const p of task.pendingPeriods) ms += (p.to ? new Date(p.to) : now).getTime() - new Date(p.from).getTime();
  return Math.max(0, Math.round(ms / 86400000));
}

export function currentPending(task: Task) {
  return task.pendingPeriods.find((p) => !p.to);
}

/** Working days (Mon–Sat) before today with nothing logged — surfaced, never enforced. */
export function missingDays(db: DB, user: User, from: ISODate, to: ISODate = addDays(today(), -1)): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (weekday(d) === 0 || d < user.joiningDate) continue;
    if (!db.entries.some((e) => e.userId === user.id && e.date === d)) out.push(d);
  }
  return out;
}

export function isLeaveDay(db: DB, userId: string, date: ISODate) {
  return db.entries.some((e) => e.userId === userId && e.date === date && e.internalCategory === 'leave');
}

export function daysUntil(due: ISODate) {
  return diffDays(due, today());
}

export function recentPairs(db: DB, userId: string, limit = 4): { clientId: string; taskId?: string; engagementId?: string }[] {
  const seen = new Set<string>();
  const out: { clientId: string; taskId?: string; engagementId?: string }[] = [];
  const mine = db.entries.filter((e) => e.userId === userId && e.clientId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const e of mine) {
    const key = `${e.clientId}|${e.taskId ?? e.engagementId}`;
    if (seen.has(key)) continue;
    const task = e.taskId ? db.tasks.find((t) => t.id === e.taskId) : undefined;
    if (task && (task.status === 'filed' || task.status === 'filed_late' || task.status === 'not_applicable')) {
      const tpl = db.templates.find((x) => x.code === task.templateCode);
      if (!tpl || task.stageIndex >= tpl.stages.length - 1) continue;
    }
    seen.add(key);
    out.push({ clientId: e.clientId!, taskId: e.taskId, engagementId: e.engagementId });
    if (out.length >= limit) break;
  }
  return out;
}
