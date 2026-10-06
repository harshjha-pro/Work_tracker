// SQLite (sql.js, WebAssembly) holds the app data in the browser. No server:
// the database file is kept in IndexedDB by persist.ts.

import type { Database, SqlJsStatic, SqlValue } from 'sql.js';
import type { DB } from '../types';
import { META_KEYS, TABLES, childFk, ddl, q, snake, type Col, type TableSpec } from './schema';

let loader: (() => Promise<SqlJsStatic>) | null = null;
let SQL: SqlJsStatic | null = null;

/** The browser and Node load the WebAssembly differently; each registers its loader. */
export function setSqlJsLoader(fn: () => Promise<SqlJsStatic>) {
  loader = fn;
}

export async function sqlJs(): Promise<SqlJsStatic> {
  if (SQL) return SQL;
  if (!loader) throw new Error('SQLite loader not registered');
  SQL = await loader();
  return SQL;
}

export async function openDatabase(bytes?: Uint8Array | null): Promise<Database> {
  const S = await sqlJs();
  const db = bytes ? new S.Database(bytes) : new S.Database();
  db.exec(ddl());
  return db;
}

// ---------- record ⇄ row ----------

function encode(c: Col, v: unknown): SqlValue {
  if (v === undefined || v === null) return null;
  switch (c.type) {
    case 'boolean':
      return v ? 1 : 0;
    case 'json':
      return JSON.stringify(v);
    case 'integer':
    case 'real':
      return Number(v);
    default:
      return String(v);
  }
}

function decode(c: Col, v: SqlValue): unknown {
  if (v === null || v === undefined) return c.nullable ? null : undefined;
  switch (c.type) {
    case 'boolean':
      return v === 1 || v === '1';
    case 'json':
      return JSON.parse(String(v));
    case 'integer':
    case 'real':
      return Number(v);
    default:
      return String(v);
  }
}

type Rec = Record<string, unknown>;

function extraOf(rec: Rec, cols: Col[], skip: string[]): string | null {
  const known = new Set([...cols.map((c) => c.field), ...skip]);
  const extra: Rec = {};
  for (const [k, v] of Object.entries(rec)) if (!known.has(k) && v !== undefined) extra[k] = v;
  return Object.keys(extra).length ? JSON.stringify(extra) : null;
}

function rowValues(spec: { columns: Col[] }, rec: Rec, skip: string[]): SqlValue[] {
  return [...spec.columns.map((c) => encode(c, rec[c.field])), extraOf(rec, spec.columns, skip)];
}

function fromRow(cols: Col[], row: Rec): Rec {
  const out: Rec = {};
  for (const c of cols) {
    const v = decode(c, row[snake(c.field)] as SqlValue);
    if (v !== undefined) out[c.field] = v;
  }
  if (row.extra_json) Object.assign(out, JSON.parse(String(row.extra_json)));
  return out;
}

const keyOf = (spec: TableSpec, rec: Rec) => spec.key.map((k) => String(rec[k])).join('|');
const AUTH = TABLES.find((t) => t.collection === 'users.auth')!;
const MAIN = TABLES.filter((t) => t.collection !== 'users.auth');

function insertSql(table: string, cols: string[]) {
  return `INSERT OR REPLACE INTO ${table} (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
}

/** Upsert that keeps the row's rowid, so records keep their order after an update. */
function upsertSql(table: string, cols: string[], pk: string[]) {
  const set = cols.filter((c) => !pk.includes(c)).map((c) => `${q(c)} = excluded.${q(c)}`);
  return `INSERT INTO ${table} (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ON CONFLICT(${pk.map(q).join(', ')}) DO UPDATE SET ${set.join(', ')}`;
}

function writeRecord(sdb: Database, spec: TableSpec, rec: Rec) {
  const skip = (spec.children ?? []).map((c) => c.field).concat(spec.collection === 'users' ? ['auth'] : []);
  sdb.run(upsertSql(spec.table, [...spec.columns.map((c) => snake(c.field)), 'extra_json'], spec.key.map(snake)), rowValues(spec, rec, skip));
  const id = String(rec[spec.key[0]]);
  for (const ch of spec.children ?? []) {
    const fk = childFk(spec);
    sdb.run(`DELETE FROM ${ch.table} WHERE ${fk} = ?`, [id]);
    const list = (rec[ch.field] as Rec[] | undefined) ?? [];
    list.forEach((child, pos) => {
      sdb.run(insertSql(ch.table, [fk, 'position', ...ch.columns.map((c) => snake(c.field)), 'extra_json']), [id, pos, ...rowValues(ch, child, [])]);
    });
  }
  if (spec.collection === 'users' && rec.auth) {
    sdb.run(insertSql(AUTH.table, [...AUTH.columns.map((c) => snake(c.field)), 'extra_json']), rowValues(AUTH, { ...(rec.auth as Rec), userId: id }, []));
  }
}

function deleteRecord(sdb: Database, spec: TableSpec, rec: Rec) {
  const where = spec.key.map((k) => `${q(snake(k))} = ?`).join(' AND ');
  const vals = spec.key.map((k) => String(rec[k]));
  sdb.run(`DELETE FROM ${spec.table} WHERE ${where}`, vals);
  for (const ch of spec.children ?? []) sdb.run(`DELETE FROM ${ch.table} WHERE ${childFk(spec)} = ?`, [vals[0]]);
  if (spec.collection === 'users') sdb.run(`DELETE FROM ${AUTH.table} WHERE user_id = ?`, [vals[0]]);
}

/**
 * Write the app state. With `prev` (the last state written) only changed
 * records are touched — immer keeps unchanged records as the same objects.
 */
export function writeState(sdb: Database, next: DB, prev?: DB | null) {
  sdb.exec('BEGIN');
  try {
    for (const spec of MAIN) {
      const list = (next as unknown as Record<string, Rec[]>)[spec.collection] ?? [];
      const before = prev ? ((prev as unknown as Record<string, Rec[]>)[spec.collection] ?? []) : null;
      if (before === list) continue;
      if (!before) {
        sdb.run(`DELETE FROM ${spec.table}`);
        for (const ch of spec.children ?? []) sdb.run(`DELETE FROM ${ch.table}`);
        if (spec.collection === 'users') sdb.run(`DELETE FROM ${AUTH.table}`);
        for (const rec of list) writeRecord(sdb, spec, rec);
        continue;
      }
      const old = new Map(before.map((r) => [keyOf(spec, r), r]));
      const seen = new Set<string>();
      for (const rec of list) {
        const k = keyOf(spec, rec);
        seen.add(k);
        if (old.get(k) !== rec) writeRecord(sdb, spec, rec);
      }
      for (const [k, r] of old) if (!seen.has(k)) deleteRecord(sdb, spec, r);
    }
    for (const m of META_KEYS) {
      const v = (next as unknown as Rec)[m.key];
      if (prev && (prev as unknown as Rec)[m.key] === v) continue;
      sdb.run('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [m.key, JSON.stringify(v ?? null)]);
    }
    sdb.exec('COMMIT');
  } catch (e) {
    sdb.exec('ROLLBACK');
    throw e;
  }
}

function selectAll(sdb: Database, sql: string, params: SqlValue[] = []): Rec[] {
  const st = sdb.prepare(sql);
  st.bind(params);
  const rows: Rec[] = [];
  while (st.step()) rows.push(st.getAsObject() as Rec);
  st.free();
  return rows;
}

export function hasData(sdb: Database): boolean {
  return selectAll(sdb, "SELECT value FROM app_meta WHERE key = 'version'").length > 0;
}

export function readState(sdb: Database): DB {
  const out: Rec = {};
  for (const m of META_KEYS) {
    const r = selectAll(sdb, 'SELECT value FROM app_meta WHERE key = ?', [m.key])[0];
    if (r) out[m.key] = JSON.parse(String(r.value));
  }
  const auth = new Map(selectAll(sdb, `SELECT * FROM ${AUTH.table}`).map((r) => {
    const a = fromRow(AUTH.columns, r);
    const userId = a.userId as string;
    delete a.userId;
    return [userId, a];
  }));
  for (const spec of MAIN) {
    const kids = new Map<string, Map<string, Rec[]>>();
    for (const ch of spec.children ?? []) {
      const byParent = new Map<string, Rec[]>();
      for (const r of selectAll(sdb, `SELECT * FROM ${ch.table} ORDER BY ${childFk(spec)}, position`)) {
        const pid = String(r[childFk(spec)]);
        if (!byParent.has(pid)) byParent.set(pid, []);
        byParent.get(pid)!.push(fromRow(ch.columns, r));
      }
      kids.set(ch.field, byParent);
    }
    const order = spec.collection === 'audit' ? 'at DESC, rowid DESC' : 'rowid';
    out[spec.collection] = selectAll(sdb, `SELECT * FROM ${spec.table} ORDER BY ${order}`).map((r) => {
      const rec = fromRow(spec.columns, r);
      for (const ch of spec.children ?? []) rec[ch.field] = kids.get(ch.field)!.get(String(rec[spec.key[0]])) ?? [];
      if (spec.collection === 'users') rec.auth = auth.get(String(rec.id));
      return rec;
    });
  }
  return out as unknown as DB;
}

const lit = (v: unknown): string => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (v instanceof Uint8Array) return `X'${[...v].map((x) => x.toString(16).padStart(2, '0')).join('')}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
};

/** Plain-text SQL dump (schema + data) — the "DB file" format. */
export function dumpSql(sdb: Database, header = ''): string {
  const lines: string[] = [];
  if (header) lines.push(header.trim(), '');
  lines.push(ddl(), '', 'BEGIN TRANSACTION;');
  const tables = selectAll(sdb, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").map((r) => String(r.name));
  for (const t of tables) {
    const rows = selectAll(sdb, `SELECT * FROM ${t} ORDER BY rowid`);
    if (!rows.length) continue;
    lines.push('', `-- ${t}: ${rows.length} row${rows.length === 1 ? '' : 's'}`);
    for (const r of rows) {
      const cols = Object.keys(r);
      lines.push(`INSERT INTO ${t} (${cols.map(q).join(', ')}) VALUES (${cols.map((c) => lit(r[c])).join(', ')});`);
    }
  }
  lines.push('', 'COMMIT;', '');
  return lines.join('\n');
}

export function tableCounts(sdb: Database): Record<string, number> {
  const out: Record<string, number> = {};
  const tables = selectAll(sdb, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((r) => String(r.name));
  for (const t of tables) out[t] = Number(selectAll(sdb, `SELECT COUNT(*) AS n FROM ${t}`)[0].n);
  return out;
}
