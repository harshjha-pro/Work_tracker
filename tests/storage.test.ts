// SQLite storage (E3) and boot with migration on load (E2).
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { dumpSql, hasData, openDatabase, readState, tableCounts, writeState } from '../src/lib/storage/sqlite';
import { boot, flush, getFile, putFile, save } from '../src/lib/storage/persist';
import { idbReset } from '../src/lib/storage/idb';
import { validateDb } from '../src/lib/storage/validate';
import { migrate_v4_to_v5 } from '../src/lib/migrations/migrate_v4_to_v5.js';
import type { DB } from '../src/lib/types';
import { NOW, loadV4, norm, seedV5 } from './helpers';

const sortAudit = (db: any) => ({ ...norm(db), audit: [...db.audit].sort((a: any, b: any) => (a.id < b.id ? -1 : 1)) });

describe('SQLite round trip', () => {
  it('the v5 seed reads back exactly as written', async () => {
    const db = seedV5();
    expect(validateDb(db).errors).toEqual([]);
    const s = await openDatabase();
    writeState(s, db, null);
    expect(sortAudit(readState(s))).toEqual(sortAudit(db));
  });

  it('the migrated v4 data reads back exactly as written', async () => {
    const db = migrate_v4_to_v5(loadV4(), { now: NOW }).db as DB;
    const s = await openDatabase();
    writeState(s, db, null);
    expect(sortAudit(readState(s))).toEqual(sortAudit(db));
  });

  it('writes only changed records and keeps record order', async () => {
    const db = seedV5();
    const s = await openDatabase();
    writeState(s, db, null);
    const tasks = [...db.tasks];
    const i = 5;
    tasks[i] = { ...tasks[i], status: 'pending_from_client', checklist: [{ id: 'x1', name: 'Bank statement', status: 'requested', dateRequested: '2026-10-06' }] };
    const removed = tasks.pop()!;
    const next = { ...db, tasks, leaveRequests: db.leaveRequests.slice(1) };
    writeState(s, next, db);
    const back = readState(s);
    expect(back.tasks.map((t) => t.id)).toEqual(tasks.map((t) => t.id));
    expect(back.tasks[i].checklist).toEqual(tasks[i].checklist);
    expect(back.tasks.some((t) => t.id === removed.id)).toBe(false);
    expect(back.leaveRequests).toHaveLength(db.leaveRequests.length - 1);
    const n = tableCounts(s);
    expect(n.task_checklist_items).toBe(back.tasks.reduce((a, t) => a + t.checklist.length, 0));
  });

  it('fields the schema does not know are kept, not dropped', async () => {
    const db = seedV5();
    (db.clients[0] as any).futureField = { note: 'added by a later version' };
    const s = await openDatabase();
    writeState(s, db, null);
    expect((readState(s).clients[0] as any).futureField).toEqual({ note: 'added by a later version' });
  });

  it('the SQL dump recreates the same database', async () => {
    const db = migrate_v4_to_v5(loadV4(), { now: NOW }).db as DB;
    const a = await openDatabase();
    writeState(a, db, null);
    const sql = dumpSql(a, '-- test');
    const b = await openDatabase();
    b.exec(sql);
    expect(tableCounts(b)).toEqual(tableCounts(a));
    expect(sortAudit(readState(b))).toEqual(sortAudit(db));
  });
});

// Minimal localStorage for Node
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

async function wipeIdb() {
  idbReset();
  await new Promise<void>((resolve) => {
    const r = indexedDB.deleteDatabase('qepex-work-tracker');
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });
}

describe('boot: migrate on load instead of resetting', () => {
  beforeEach(async () => {
    store.clear();
    await wipeIdb();
  });

  it('migrates v4 data found in localStorage, then reopens it from SQLite', async () => {
    const v4 = loadV4();
    store.set('qepex-work-tracker', JSON.stringify({ state: { db: v4, currentUserId: 'u-sneha' }, version: 4 }));
    const first = await boot(() => seedV5(), NOW);
    expect(first.source).toBe('migrated-v4');
    expect(first.reports).toHaveLength(1);
    expect(first.db.tasks.map((t) => t.id)).toEqual(v4.tasks.map((t: any) => t.id));
    expect(store.has('qepex-work-tracker')).toBe(true); // the v4 copy is left in place as a fallback

    idbReset();
    const second = await boot(() => seedV5(), NOW);
    expect(second.source).toBe('sqlite');
    expect(second.reports).toHaveLength(0);
    expect(sortAudit(second.db)).toEqual(sortAudit(first.db));
  });

  it('changes saved after boot survive a reload', async () => {
    const first = await boot(() => seedV5(), NOW);
    expect(first.source).toBe('seed');
    const next = { ...first.db, notificationState: [...first.db.notificationState, { id: 'u-karan|x', userId: 'u-karan', notificationKey: 'x', readAt: NOW, dismissedAt: null }] };
    save(next);
    await flush();
    idbReset();
    const second = await boot(() => seedV5(), NOW);
    expect(second.db.notificationState.some((n) => n.id === 'u-karan|x')).toBe(true);
  });

  it('stores attachment bodies in IndexedDB', async () => {
    await putFile('blob-test', new Uint8Array([1, 2, 3]));
    expect(Array.from((await getFile('blob-test')) as Uint8Array)).toEqual([1, 2, 3]);
  });

  it('starts from demo data when nothing is stored', async () => {
    const r = await boot(() => seedV5(), NOW);
    expect(r.source).toBe('seed');
    expect(r.db.version).toBe(5);
    const s = await openDatabase();
    writeState(s, r.db, null);
    expect(hasData(s)).toBe(true);
  });
});
