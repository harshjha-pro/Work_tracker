// Boot and autosave. Order on load:
//   1. SQLite database file in IndexedDB → read it (and migrate if older)
//   2. v4 data left in localStorage by the previous build → migrate to v5 (E2)
//   3. nothing → fresh demo data (E7)
// The v4 localStorage copy is left untouched as a fallback; it is never read again
// once the SQLite file exists.

import type { Database } from 'sql.js';
import type { DB } from '../types';
import { CURRENT_VERSION, runMigrations, type MigrationReport } from '../migrations';
import { hasData, openDatabase, readState, writeState } from './sqlite';
import { STORE_DB, STORE_FILES, idbAvailable, idbDelete, idbGet, idbPut } from './idb';

export const LEGACY_KEY = 'qepex-work-tracker'; // zustand persist key used up to data version 4
const DB_KEY = 'main';

export interface BootResult {
  engine: 'sqlite' | 'json'; // json = fallback when WebAssembly is blocked (some sandboxed pages)
  db: DB;
  source: 'sqlite' | 'migrated-v4' | 'seed';
  reports: MigrationReport[];
  persistent: boolean; // false when IndexedDB is unavailable (private window) — data lasts for the tab only
}

let sdb: Database | null = null;
let jsonMode = false;
const JSON_KEY = 'json';
let lastWritten: DB | null = null;
let persistent = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function readLegacy(): { state?: { db?: Record<string, unknown> } } | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function boot(seed: () => DB, now = new Date().toISOString()): Promise<BootResult> {
  persistent = idbAvailable();
  let bytes: Uint8Array | undefined;
  if (persistent) {
    try {
      bytes = await idbGet<Uint8Array>(STORE_DB, DB_KEY);
    } catch {
      persistent = false;
    }
  }
  try {
    sdb = await openDatabase(bytes ?? null);
  } catch {
    return bootJson(seed, now);
  }

  let db: DB;
  let source: BootResult['source'];
  let reports: MigrationReport[] = [];
  if (bytes && hasData(sdb)) {
    db = readState(sdb);
    source = 'sqlite';
    if ((db.version ?? 0) < CURRENT_VERSION) ({ db, reports } = runMigrations(db as never, now));
  } else {
    const legacy = readLegacy()?.state?.db as ({ version?: number } & Record<string, unknown>) | undefined;
    if (legacy && typeof legacy.version === 'number' && legacy.version >= 4) {
      ({ db, reports } = runMigrations(legacy, now));
      source = 'migrated-v4';
    } else {
      db = seed();
      source = 'seed';
    }
  }
  writeState(sdb, db, null);
  lastWritten = db;
  await flush();
  return { engine: 'sqlite', db, source, reports, persistent };
}

/** Fallback: the same data, migrations and IndexedDB, stored as one JSON value instead of SQLite. */
async function bootJson(seed: () => DB, now: string): Promise<BootResult> {
  jsonMode = true;
  sdb = null;
  let stored: string | undefined;
  if (persistent) stored = await idbGet<string>(STORE_DB, JSON_KEY).catch(() => undefined);
  let db: DB;
  let source: BootResult['source'];
  let reports: MigrationReport[] = [];
  if (stored) {
    db = JSON.parse(stored);
    source = 'sqlite';
    if ((db.version ?? 0) < CURRENT_VERSION) ({ db, reports } = runMigrations(db as never, now));
  } else {
    const legacy = readLegacy()?.state?.db as ({ version?: number } & Record<string, unknown>) | undefined;
    if (legacy && typeof legacy.version === 'number' && legacy.version >= 4) {
      ({ db, reports } = runMigrations(legacy, now));
      source = 'migrated-v4';
    } else {
      db = seed();
      source = 'seed';
    }
  }
  lastWritten = db;
  await flush();
  return { engine: 'json', db, source, reports, persistent };
}

/** Persist a new state: only changed records are written to SQLite, then the file is saved (debounced). */
export function save(next: DB) {
  if (next === lastWritten) return;
  if (jsonMode) {
    lastWritten = next;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void flush(), 300);
    return;
  }
  if (!sdb) return;
  writeState(sdb, next, lastWritten);
  lastWritten = next;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flush(), 300);
}

export async function flush() {
  if (!persistent) return;
  try {
    if (jsonMode) {
      if (lastWritten) await idbPut(STORE_DB, JSON_KEY, JSON.stringify(lastWritten));
      return;
    }
    if (!sdb) return;
    await idbPut(STORE_DB, DB_KEY, sdb.export());
  } catch {
    persistent = false;
  }
}

/** Replace all data (demo reset, backup restore). */
export function replaceAll(next: DB) {
  if (jsonMode) {
    lastWritten = next;
    void flush();
    return;
  }
  if (!sdb) return;
  writeState(sdb, next, null);
  lastWritten = next;
  void flush();
}

export function currentDatabase() {
  return sdb;
}

// ---------- attachment bodies (C7) ----------
export const putFile = (blobKey: string, body: Blob | Uint8Array) => idbPut(STORE_FILES, blobKey, body);
export const getFile = (blobKey: string) => idbGet<Blob | Uint8Array>(STORE_FILES, blobKey);
export const deleteFile = (blobKey: string) => idbDelete(STORE_FILES, blobKey);
