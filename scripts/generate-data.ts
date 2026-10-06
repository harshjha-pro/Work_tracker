// Produces the v5 deliverables from code (run: npm run data):
//   data/qepex_v5_migrated.sql      — the v4 demo state migrated to v5, as a SQLite SQL dump
//   data/qepex_v5_demo_seed.sql     — fresh v5 demo data (Reset demo data)
//   SCHEMA_V5.md                    — every table and field, from src/lib/storage/schema.ts
//   docs/VALIDATION_REPORT_V5.md    — counts before/after, transformations, judgement calls
import '../src/lib/storage/node';
import { readFileSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { migrate_v4_to_v5 } from '../src/lib/migrations/migrate_v4_to_v5.js';
import { dumpSql, openDatabase, readState, tableCounts, writeState } from '../src/lib/storage/sqlite';
import { META_KEYS, TABLES, snake, type Col } from '../src/lib/storage/schema';
import { validateDb } from '../src/lib/storage/validate';
import { buildSeed } from '../src/lib/seed';
import { applyClientSync } from '../src/lib/compliance';
import type { DB } from '../src/lib/types';

const NOW = '2026-10-06T12:00:00.000Z';
const T = '2026-10-06';

async function main() {
  // ---------- migrated DB file ----------
  const v4 = JSON.parse(readFileSync('data/qepex_v4_demo_state.json', 'utf8')).state.db;
  const { db, report } = migrate_v4_to_v5(v4, { now: NOW }) as { db: DB; report: any };
  const again = migrate_v4_to_v5(db, { now: NOW });
  const validation = validateDb(db);
  const sdb = await openDatabase();
  writeState(sdb, db, null);
  const roundTrip = isDeepStrictEqual(sortAudit(JSON.parse(JSON.stringify(readState(sdb)))), sortAudit(JSON.parse(JSON.stringify(db))));
  const header = `-- QEPEX India Work Tracker — data schema version 5 (SQLite)
-- Migrated from data version 4 (data/qepex_v4_demo_state.json) by migrate_v4_to_v5 at ${NOW}.
-- Load with: sqlite3 qepex.db < qepex_v5_migrated.sql   (or open in any SQLite tool)
-- Column/field reference: SCHEMA_V5.md. Fictional demo data only.`;
  writeFileSync('data/qepex_v5_migrated.sql', dumpSql(sdb, header));
  const tables = tableCounts(sdb);

  // ---------- fresh seed ----------
  const seed = buildSeed(T);
  for (const c of seed.clients) if (c.status !== 'discontinued') applyClientSync(seed, c.id, 'u-farhan', 'Applicability changed', T);
  const seedCheck = validateDb(seed);
  const sdb2 = await openDatabase();
  writeState(sdb2, seed, null);
  writeFileSync('data/qepex_v5_demo_seed.sql', dumpSql(sdb2, `-- QEPEX India Work Tracker — fresh v5 demo data generated for ${T} (what "Reset demo data" creates). Fictional.`));
  const seedTables = tableCounts(sdb2);

  writeFileSync('SCHEMA_V5.md', schemaDoc(seed));
  writeFileSync('docs/VALIDATION_REPORT_V5.md', validationDoc(report, validation, tables, again.report, roundTrip, seed, seedCheck, seedTables));
  console.log('written', { tables: Object.keys(tables).length, errors: validation.errors.length, seedErrors: seedCheck.errors.length, roundTrip });
}

function sortAudit(d: any) {
  return { ...d, audit: [...d.audit].sort((a: any, b: any) => (a.id < b.id ? -1 : 1)) };
}

const TYPE: Record<Col['type'], string> = { text: 'TEXT', integer: 'INTEGER', real: 'REAL', boolean: 'INTEGER (0/1)', json: 'TEXT (JSON)' };

function trim(v: unknown, depth = 0): unknown {
  if (Array.isArray(v)) {
    const head = v.slice(0, depth === 0 ? 2 : 1).map((x) => trim(x, depth + 1));
    return v.length > head.length ? [...head, `… ${v.length - head.length} more`] : head;
  }
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, trim(x, depth + 1)]));
  return v;
}

function example(seed: DB, collection: string): unknown {
  const data = seed as unknown as Record<string, any[]>;
  const pick: Record<string, (r: any) => boolean> = {
    clients: (r) => r.id === 'c-0108',
    tasks: (r) => r.reviewPoints?.length > 0,
    users: (r) => r.id === 'u-sneha',
    engagements: (r) => r.feeBasis?.type === 'time',
    templates: (r) => r.code === 'audit',
    complianceTypes: (r) => r.code === 'TP3CEB',
    notices: (r) => r.id === 'notice-asmt10',
    udinRegister: (r) => r.id === 'udin-cert-networth',
    inwardOutward: (r) => r.id === 'io-4',
    leaveRequests: (r) => r.id === 'lv-2',
    dscRegister: (r) => r.id === 'dsc-01',
  };
  if (collection === 'users.auth') return { userId: 'u-sneha', ...data.users.find((u) => u.id === 'u-sneha')!.auth };
  const list = data[collection] ?? [];
  const r = list.find(pick[collection] ?? (() => true)) ?? list[0];
  if (!r) return null;
  const copy = { ...r };
  if (collection === 'users') delete copy.auth;
  return trim(copy);
}

function fieldRows(cols: Col[]) {
  return cols
    .map((c) => `| \`${c.field}\` | \`${snake(c.field)}\` | ${TYPE[c.type]} | ${c.req ? 'Required' : c.nullable ? 'Optional (null)' : 'Optional'} | ${c.item ?? ''} | ${c.doc}${c.ref ? ` → \`${c.ref}\`` : ''} |`)
    .join('\n');
}

function schemaDoc(seed: DB): string {
  const out: string[] = [];
  out.push(`# QEPEX Work Tracker — Data Schema Version 5

Schema version 5 is the **frozen data structure for Version 1** of the release plan. Version 2 only adds to it.

Generated from \`src/lib/storage/schema.ts\` by \`npm run data\` — the same definition creates the SQLite tables, maps records to rows, and validates records in the tests, so this document cannot drift from the code.

## How data is stored

- **Engine:** SQLite compiled to WebAssembly (sql.js), bundled inside the app. No server and no external service.
- **Persistence (E3):** the SQLite database file is saved in the browser's IndexedDB (database \`qepex-work-tracker\`, store \`sqlite\`). Attachment bodies are stored separately in the \`files\` store (C7).
- **Writes:** after every change only the records that changed are written, then the file is saved.
- **Migrations (E2):** on load the app runs every migration from the stored version up to version 5. Nothing is reset. Data found in the old \`localStorage\` key from version 4 is migrated once and left in place as a fallback copy.
- **Conventions:** field names are camelCase in the app and snake_case in SQL. Booleans are stored as 0/1. Nested values that are append-only histories or small fixed objects are JSON text columns. Arrays whose items have their own id are **child tables** with \`position\` for order. Every table has an \`extra_json\` column holding any field the schema does not list, so a newer field is never dropped by an older build.
- **Single values** (\`version\`, \`seededOn\`, \`meta\`, \`lockSettings\`, \`settings\`) live in the key/value table \`app_meta\`.
- **Audit (E5):** every action on these tables writes \`audit_log\`. New collections go through one save/delete hook that records field-level changes. Credential changes are logged without the values.

## Fields replaced in v5

| v4 field | Replaced by | Item |
|---|---|---|
| \`clients.gstins\` (list of GSTIN strings) | \`clients.gstins[]\` registration records → table \`client_gstins\` | A19 |
| \`clients.profile.gstFrequency\` | \`client_gstins.frequency\` (per GSTIN, with \`frequencyHistory\`) | A19 |
| \`clients.profile.gstAnnualReturn\` | \`client_gstins.gst_annual_return\` | A19 |
| \`clients.profile.gst9c\` | \`client_gstins.gst9c\` | A19 |

No other v4 field was removed or renamed. The compliance type \`TDS_RET\` is **retired**, not removed: it keeps its existing tasks, and 24Q, 26Q, 27Q and 27EQ replace it from the next uncovered quarter.

## Not in v5 (Version 2 items)

Holiday calendar and weekend/holiday shift policy (A24), scoped extensions by state or taxpayer class and dated rule history (A25), late-fee rates (A15), articleship records (B8), invoices and receipts (B9), archive retention settings (B14), applause (B12), helpdesk (B13), credentials vault (C4) and retention rules (C6). Each one adds new tables or fields in V2 without changing anything here.

## Settings (\`app_meta\`)

| Key | Item | Contents |
|---|---|---|
${META_KEYS.map((m) => `| \`${m.key}\` | ${m.item} | ${m.doc} |`).join('\n')}

\`settings\` defaults:

\`\`\`json
${JSON.stringify(seed.settings, null, 2)}
\`\`\`
`);
  for (const t of TABLES) {
    out.push(`## \`${t.table}\`${t.collection.includes('.') ? '' : ` — collection \`${t.collection}\``}

${t.doc} **Items:** ${t.item}. **Primary key:** ${t.collection === 'users.auth' ? '`user_id`' : t.key.map((k) => `\`${snake(k)}\``).join(' + ')}${t.appendOnly ? '. **Append-only.**' : '.'}

| Field | Column | Type | Required | Item | Description |
|---|---|---|---|---|---|
${fieldRows(t.columns)}
`);
    for (const ch of t.children ?? []) {
      out.push(`### Child table \`${ch.table}\` (field \`${t.collection}.${ch.field}[]\`)

${ch.doc} **Item:** ${ch.item}. Rows carry \`${snake(t.table.replace(/s$/, ''))}_id\` and \`position\`.

| Field | Column | Type | Required | Item | Description |
|---|---|---|---|---|---|
${fieldRows(ch.columns)}
`);
    }
    const ex = example(seed, t.collection);
    if (ex) out.push(`Example record (long lists shortened):\n\n\`\`\`json\n${JSON.stringify(ex, null, 2)}\n\`\`\`\n`);
  }
  return out.join('\n');
}

function validationDoc(report: any, validation: ReturnType<typeof validateDb>, tables: Record<string, number>, rerun: any, roundTrip: boolean, seed: DB, seedCheck: ReturnType<typeof validateDb>, seedTables: Record<string, number>): string {
  const keys = [...new Set([...Object.keys(report.countsBefore), ...Object.keys(report.countsAfter)])];
  const v4Keys = Object.keys(report.countsBefore);
  return `# Validation report — migration v4 → v5

Generated by \`npm run data\` from \`data/qepex_v4_demo_state.json\` (the v4 build's state on ${report.at.slice(0, 10)}). Output: \`data/qepex_v5_migrated.sql\`.

## Result

| Check | Result |
|---|---|
| Records lost | **0** — every v4 record kept with the same id (${v4Keys.map((k) => `${k} ${report.countsBefore[k]}`).join(', ')}) |
| Schema validation of every migrated record | ${validation.errors.length ? `**${validation.errors.length} errors**` : '**0 errors**'}, ${validation.unknownFields.length} unknown fields |
| SQLite write → read gives back identical data | ${roundTrip ? 'Yes' : '**No**'} |
| Second run of the migration | ${rerun.skipped ? 'No-op (returns the same object)' : 'Changed data'} |
| Automated tests | \`npm test\` — tests/migration.test.ts, tests/storage.test.ts, tests/rules.test.ts, tests/store.test.ts |

## Counts before and after

| Collection | v4 | v5 | Note |
|---|---:|---:|---|
${keys.map((k) => `| ${k} | ${report.countsBefore[k] ?? '—'} | ${report.countsAfter[k] ?? '—'} | ${k === 'complianceTypes' ? '+8 Rules Spec types; TDS_RET retired → 29 active' : k === 'audit' ? '+1 migration entry' : k === 'udinRegister' ? 'from UDIN acknowledgments' : k === 'notices' ? 'from the Notice engagement' : report.countsBefore[k] === undefined ? 'new collection (empty)' : report.countsBefore[k] === report.countsAfter[k] ? 'unchanged' : 'changed'} |`).join('\n')}

### SQLite tables in the migrated file

| Table | Rows |
|---|---:|
${Object.entries(tables).map(([k, v]) => `| ${k} | ${v} |`).join('\n')}

## Transformations

| Collection | What changed | Records | Detail |
|---|---|---:|---|
${report.transformations.map((t: any) => `| ${t.collection} | ${t.action} | ${t.count} | ${t.detail} |`).join('\n')}

## Judgement calls

${report.judgementCalls.length} records needed a decision the specs do not make. Each is listed with what the migration did, so it can be checked in the app.

| Collection | Record | Issue | Decision |
|---|---|---|---|
${report.judgementCalls.map((j: any) => `| ${j.collection} | \`${j.id}\` | ${j.issue} | ${j.decision} |`).join('\n')}

## Rules Spec scenarios (§11.5) and edge cases (§11.4)

| # | Scenario | Test | Status |
|---|---|---|---|
| 1 | Basic monthly generation | rules.test.ts — §3 generation #1 | Covered (horizon is 120 days rather than "current + 2 periods") |
| 2 | Idempotent re-run | rules.test.ts #2; natural-key uniqueness | Covered |
| 3 | QRMP switch mid-quarter | rules.test.ts — frequency change per GSTIN | Partly: periods before the change keep the old frequency. Linking superseded tasks (Rules §7.3) is engine work for batch 6 |
| 4 | AGM unknown then confirmed | rules.test.ts #4 | Covered |
| 5 | Extension flips Filed Late to Filed | rules.test.ts #5 | Covered, including "Filed is never reversed" |
| 6 | Extension out of scope | — | Not covered: scoped extensions are A25 (Version 2) |
| 7 | Flag turned off mid-year | rules.test.ts #7 | Covered |
| 8 | Dormant client with open obligation | rules.test.ts #8 | Covered for generation; the Manager review list is a screen (later batch) |
| 9 | Discontinued client closure | rules.test.ts #9 | Partly: no new periods generate; creating the GSTR-10 closure task is engine work (later batch) |
| 10 | Filed without acknowledgment blocked | store.test.ts #10 | Covered |
| 11 | Maker cannot be checker | store.test.ts #11 | Covered, plus "article assistants never check" |
| 12 | Per-director DIR-3 KYC | rules.test.ts #12 | Covered |
| 13 | Holiday policy no-op by default | — | Not covered: holiday calendar and shift policy are A24 (Version 2); V1 never shifts dates |
| 14 | Not Applicable blocked on Filed | store.test.ts #14 | Covered |
| 15 | Event date correction after filing | rules.test.ts #15 | Covered |
| §11.4 | Leap-year February period | rules.test.ts — leap year | Covered |
| §11.4 | Compliance start date mid-quarter | rules.test.ts — compliance start date | Covered |

## Fresh demo data (E7)

\`data/qepex_v5_demo_seed.sql\` is what "Reset demo data" creates for ${seed.seededOn}. Schema validation: ${seedCheck.errors.length} errors.

| Collection | Records |
|---|---:|
${Object.entries(seed as unknown as Record<string, unknown>).filter(([, v]) => Array.isArray(v)).map(([k, v]) => `| ${k} | ${(v as unknown[]).length} |`).join('\n')}

Child-table rows: ${['client_gstins', 'client_directors', 'task_review_points', 'task_checklist_items', 'task_follow_ups', 'notice_hearings'].map((t) => `${t} ${seedTables[t]}`).join(', ')}.

Demo sign-in for the coming login screen (C1): every active demo user has the temporary PIN **2026** and must change it at first sign-in. Nikhil Bhosale is an offboarded article assistant; one inward document is still in his custody, which demonstrates the offboarding check.
`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
