// Migration chain (E2). On load the app runs every step from the stored version
// up to CURRENT_VERSION instead of resetting data. Each step is pure and idempotent.
import type { DB } from '../types';
import { migrate_v4_to_v5 } from './migrate_v4_to_v5.js';

export const CURRENT_VERSION = 5;

export interface MigrationReport {
  from: number;
  to: number;
  at: string;
  countsBefore: Record<string, number>;
  countsAfter: Record<string, number>;
  transformations: { collection: string; action: string; count: number; detail: string }[];
  judgementCalls: { collection: string; id: string; issue: string; decision: string }[];
}

type Step = (db: unknown, opts: { now: string }) => { db: unknown; report: MigrationReport | { skipped: true } };
const STEPS: Record<number, Step> = { 4: migrate_v4_to_v5 as Step };

/** Oldest stored version that can still be migrated; anything older is reset to demo data. */
export const OLDEST_MIGRATABLE = 4;

export function runMigrations(data: { version?: number } & Record<string, unknown>, now: string): { db: DB; reports: MigrationReport[] } {
  let db: unknown = data;
  const reports: MigrationReport[] = [];
  let v = (data.version as number) ?? 0;
  if (v < OLDEST_MIGRATABLE) throw new Error(`Stored data version ${v} is older than ${OLDEST_MIGRATABLE} and cannot be migrated`);
  while (v < CURRENT_VERSION) {
    const step = STEPS[v];
    if (!step) throw new Error(`No migration from version ${v}`);
    const r = step(db, { now });
    db = r.db;
    if (!('skipped' in r.report)) reports.push(r.report);
    v = (db as { version: number }).version;
  }
  return { db: db as DB, reports };
}
