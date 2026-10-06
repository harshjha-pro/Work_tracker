// Checks every record against the schema-v5 table specs (required fields, types)
// and lists fields the specs don't know (those would go to extra_json).

import type { DB } from '../types';
import { TABLES, type Col } from './schema';

export interface ValidationIssue {
  collection: string;
  id: string;
  field: string;
  problem: string;
}

function checkValue(c: Col, v: unknown): string | null {
  if (v === undefined || v === null) {
    if (c.req) return 'required but missing';
    if (v === null && !c.nullable) return 'null where the field is optional (should be absent)';
    return null;
  }
  switch (c.type) {
    case 'text':
      return typeof v === 'string' ? null : `expected text, got ${typeof v}`;
    case 'integer':
      return Number.isInteger(v) ? null : `expected integer, got ${JSON.stringify(v)}`;
    case 'real':
      return typeof v === 'number' && Number.isFinite(v) ? null : `expected number, got ${JSON.stringify(v)}`;
    case 'boolean':
      return typeof v === 'boolean' ? null : `expected boolean, got ${typeof v}`;
    case 'json':
      return typeof v === 'object' ? null : `expected object/array, got ${typeof v}`;
  }
}

function checkRecord(cols: Col[], rec: Record<string, unknown>, skip: string[], collection: string, id: string, out: ValidationIssue[], unknown: ValidationIssue[]) {
  for (const c of cols) {
    const p = checkValue(c, rec[c.field]);
    if (p) out.push({ collection, id, field: c.field, problem: p });
  }
  const known = new Set([...cols.map((c) => c.field), ...skip]);
  for (const k of Object.keys(rec)) if (!known.has(k) && rec[k] !== undefined) unknown.push({ collection, id, field: k, problem: 'not in schema (kept in extra_json)' });
}

export function validateDb(db: DB): { errors: ValidationIssue[]; unknownFields: ValidationIssue[] } {
  const errors: ValidationIssue[] = [];
  const unknownFields: ValidationIssue[] = [];
  const data = db as unknown as Record<string, Record<string, unknown>[]>;
  for (const spec of TABLES) {
    const records: Record<string, unknown>[] | null =
      spec.collection === 'users.auth'
        ? data.users.map((u) => ({ ...(u.auth as Record<string, unknown>), userId: u.id }))
        : (data[spec.collection] ?? null);
    if (!records) {
      errors.push({ collection: spec.collection, id: '*', field: '*', problem: 'collection missing' });
      continue;
    }
    const skip = (spec.children ?? []).map((c) => c.field).concat(spec.collection === 'users' ? ['auth'] : []);
    const seen = new Set<string>();
    for (const rec of records) {
      const id = spec.key.map((k) => String(rec[k])).join('|');
      if (seen.has(id)) errors.push({ collection: spec.collection, id, field: spec.key.join('+'), problem: 'duplicate primary key' });
      seen.add(id);
      checkRecord(spec.columns, rec, skip, spec.collection, id, errors, unknownFields);
      for (const ch of spec.children ?? []) {
        const list = rec[ch.field];
        if (!Array.isArray(list)) {
          errors.push({ collection: spec.collection, id, field: ch.field, problem: 'expected an array' });
          continue;
        }
        const kids = new Set<string>();
        for (const child of list as Record<string, unknown>[]) {
          const cid = String(child.id);
          if (kids.has(cid)) errors.push({ collection: ch.table, id: `${id}/${cid}`, field: 'id', problem: 'duplicate child id' });
          kids.add(cid);
          checkRecord(ch.columns, child, [], ch.table, `${id}/${cid}`, errors, unknownFields);
        }
      }
    }
  }
  return { errors, unknownFields };
}
