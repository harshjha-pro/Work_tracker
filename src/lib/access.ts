// Role permissions (spec §2 matrix) and client-team scoping, plus the weekly lock (§21).

import type { DB, ISODate, Role, Task, User, WorkEntry } from './types';
import { addDays, toDate, weekStart } from './dates';

export const can = {
  editClientMaster: (r: Role) => r === 'admin' || r === 'partner',
  manageEngagements: (r: Role) => r === 'partner' || r === 'manager' || r === 'admin',
  editDueDateMaster: (r: Role) => r === 'partner' || r === 'admin',
  editTemplates: (r: Role) => r === 'admin' || r === 'partner',
  extendLock: (r: Role) => r === 'partner',
  setLockTime: (r: Role) => r === 'admin' || r === 'partner',
  viewTeam: (r: Role) => r === 'partner' || r === 'manager' || r === 'admin',
  viewAudit: (r: Role) => r === 'partner' || r === 'manager' || r === 'admin',
  seeBilling: (r: Role) => r === 'partner' || r === 'admin',
  firmWide: (r: Role) => r === 'partner' || r === 'admin',
  review: (u: User) => u.role === 'partner' || u.role === 'manager' || (u.role === 'staff' && !!u.isSenior),
};

/** Clients a person may see. Partners and Admin: firm-wide. Managers: clients they manage or are on. Staff/Article: assigned only. */
export function visibleClientIds(db: DB, user: User): Set<string> {
  if (can.firmWide(user.role)) return new Set(db.clients.map((c) => c.id));
  const ids = new Set(db.clientTeam.filter((a) => a.userId === user.id).map((a) => a.clientId));
  if (user.role === 'manager') for (const c of db.clients) if (c.managerId === user.id) ids.add(c.id);
  return ids;
}

/** Clients a person can log work against (always their own team list, plus firm-wide roles see all). */
export function loggableClientIds(db: DB, user: User): Set<string> {
  return visibleClientIds(db, user);
}

export function visibleTasks(db: DB, user: User): Task[] {
  const ids = visibleClientIds(db, user);
  return db.tasks.filter((t) => ids.has(t.clientId));
}

/** People whose entries a user can view: Partner/Admin all; Manager the people on their clients; others only self. */
export function visiblePeople(db: DB, user: User): User[] {
  if (can.firmWide(user.role)) return db.users;
  if (user.role === 'manager') {
    const clients = visibleClientIds(db, user);
    const ids = new Set<string>([user.id]);
    for (const a of db.clientTeam) if (clients.has(a.clientId)) ids.add(a.userId);
    return db.users.filter((u) => ids.has(u.id) && u.role !== 'partner' && u.role !== 'admin');
  }
  return [user];
}

// ---- Weekly lock ----

export function baseLockAt(db: DB, ws: ISODate): Date {
  const [hh, mm] = db.lockSettings.time.split(':').map(Number);
  const d = toDate(addDays(ws, db.lockSettings.dayOffset));
  d.setHours(hh, mm, 0, 0);
  return d;
}

/** When the week containing `date` locks for this person, after any Partner extension. */
export function lockAt(db: DB, userId: string, date: ISODate): Date {
  const ws = weekStart(date);
  let at = baseLockAt(db, ws);
  for (const x of db.lockExtensions) {
    if (x.weekStart === ws && (x.userId === null || x.userId === userId)) {
      const u = new Date(x.until);
      if (u > at) at = u;
    }
  }
  return at;
}

export function isLocked(db: DB, userId: string, date: ISODate, now: Date = new Date()): boolean {
  return now >= lockAt(db, userId, date);
}

export function entryLocked(db: DB, e: WorkEntry): boolean {
  return isLocked(db, e.userId, e.date);
}

export function lockLabel(db: DB): string {
  const names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const off = db.lockSettings.dayOffset;
  const day = names[off % 7];
  const [hh, mm] = db.lockSettings.time.split(':').map(Number);
  const t = `${hh % 12 || 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
  return `${day} ${t}${off >= 7 ? ' (following week)' : ''}`;
}

export function isoAt(date: ISODate, time: string): string {
  const [hh, mm] = time.split(':').map(Number);
  const d = toDate(date);
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
}

