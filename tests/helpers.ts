import { readFileSync } from 'node:fs';
import { buildSeed } from '../src/lib/seed';
import { applyClientSync } from '../src/lib/compliance';
import type { DB } from '../src/lib/types';

export const NOW = '2026-10-06T12:00:00.000Z';
export const T = '2026-10-06';

/** The frozen v4 state captured from the v4 build (data/qepex_v4_demo_state.json). */
export function loadV4(): any {
  return JSON.parse(readFileSync(new URL('../data/qepex_v4_demo_state.json', import.meta.url), 'utf8')).state.db;
}

export function seedV5(): DB {
  const db = buildSeed(T);
  for (const c of db.clients) if (c.status !== 'discontinued') applyClientSync(db, c.id, 'u-farhan', 'Applicability changed', T);
  return db;
}

/** JSON round-trip, so undefined fields and key order don't affect comparisons. */
export const norm = (x: unknown) => JSON.parse(JSON.stringify(x));
