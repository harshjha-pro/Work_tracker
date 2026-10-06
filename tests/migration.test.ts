// Migration v4 → v5 (E2): no data loss, same ids, idempotent, pure, and every
// transformation listed in the validation report.
import { describe, expect, it } from 'vitest';
import { migrate_v4_to_v5, periodStart } from '../src/lib/migrations/migrate_v4_to_v5.js';
import { runMigrations } from '../src/lib/migrations';
import { DEFAULT_COMPLIANCE_TYPES, DEFAULT_TEMPLATES } from '../src/lib/master';
import { applyClientSync, planClientSync } from '../src/lib/compliance';
import { validateDb } from '../src/lib/storage/validate';
import type { DB } from '../src/lib/types';
import { NOW, loadV4, norm } from './helpers';

const V4_COLLECTIONS = ['users', 'clients', 'clientTeam', 'complianceTypes', 'templates', 'engagements', 'tasks', 'entries', 'extensions', 'lockExtensions', 'audit'];
const REMOVED: Record<string, string[]> = { 'clients.profile': ['gstFrequency', 'gstAnnualReturn', 'gst9c'] };

function run(v4 = loadV4()) {
  return migrate_v4_to_v5(v4, { now: NOW }) as { db: DB; report: any };
}

describe('no data loss', () => {
  const v4 = loadV4();
  const { db } = run(v4);

  it('keeps every record of every v4 collection with the same id', () => {
    for (const k of V4_COLLECTIONS) {
      const key = k === 'complianceTypes' || k === 'templates' ? 'code' : k === 'clientTeam' ? null : 'id';
      const before = v4[k].map((r: any) => (key ? r[key] : `${r.clientId}|${r.userId}`));
      const after = (db as any)[k].map((r: any) => (key ? r[key] : `${r.clientId}|${r.userId}`));
      for (const id of before) expect(after, `${k} ${id}`).toContain(id);
    }
    expect(db.tasks.length).toBe(v4.tasks.length);
    expect(db.entries.length).toBe(v4.entries.length);
    expect(db.engagements.length).toBe(v4.engagements.length);
  });

  it('leaves every existing field value unchanged, apart from the fields v5 replaces', () => {
    const changed: string[] = [];
    for (const k of V4_COLLECTIONS) {
      const key = k === 'complianceTypes' || k === 'templates' ? 'code' : 'id';
      const after = new Map((db as any)[k].map((r: any) => [r[key] ?? `${r.clientId}|${r.userId}`, r]));
      for (const old of v4[k]) {
        const now: any = after.get(old[key] ?? `${old.clientId}|${old.userId}`);
        for (const [f, v] of Object.entries(old)) {
          if (k === 'clients' && f === 'gstins') continue; // replaced by registration records (checked below)
          if (k === 'clients' && f === 'profile') {
            for (const [pf, pv] of Object.entries(v as object)) {
              if (REMOVED['clients.profile'].includes(pf)) continue;
              if (pf === 'statutoryAudit' && old.constitution.endsWith('_company')) continue; // mandatory for companies (judgement call)
              if (JSON.stringify(now.profile[pf]) !== JSON.stringify(pv)) changed.push(`${k}.${old.id}.profile.${pf}`);
            }
            continue;
          }
          if (k === 'complianceTypes' && old.code === 'TDS_RET' && f === 'isActive') continue; // retired
          if (JSON.stringify(now[f]) !== JSON.stringify(v)) changed.push(`${k}.${old[key] ?? old.id}.${f}`);
        }
      }
    }
    expect(changed).toEqual([]);
  });

  it('maps the single GST frequency to one registration per GSTIN', () => {
    for (const old of v4.clients) {
      const c = db.clients.find((x) => x.id === old.id)!;
      expect(c.gstins.map((g) => g.gstin)).toEqual(old.gstins);
      for (const g of c.gstins) {
        expect(g.frequency).toBe(old.profile.gstFrequency);
        expect(g.gstAnnualReturn).toBe(old.profile.gstAnnualReturn);
        expect(g.gst9c).toBe(old.profile.gst9c);
        expect(g.stateCode).toBe(g.gstin.slice(0, 2));
        expect(g.frequencyHistory).toHaveLength(1);
      }
      expect('gstFrequency' in c.profile).toBe(false);
    }
    const ka = db.clients.find((c) => c.id === 'c-0108')!.gstins[0];
    expect(ka.state).toBe('Karnataka');
  });

  it('links every GST task to its GSTIN', () => {
    const gstTasks = db.tasks.filter((t) => ['GSTR1_M', 'GSTR3B_M', 'GSTR1_Q', 'GSTR3B_Q', 'CMP08', 'GSTR9', 'GSTR9C'].includes(t.complianceTypeCode ?? ''));
    expect(gstTasks.length).toBeGreaterThan(40);
    for (const t of gstTasks) expect(db.clients.find((c) => c.id === t.clientId)!.gstins.some((g) => g.id === t.gstinId)).toBe(true);
  });
});

describe('idempotent and pure', () => {
  it('returns a v5 database unchanged (same reference)', () => {
    const { db } = run();
    const again = migrate_v4_to_v5(db, { now: '2027-01-01T00:00:00.000Z' });
    expect(again.db).toBe(db);
    expect(again.report.skipped).toBe(true);
  });

  it('re-applying every step to already-migrated records changes nothing', () => {
    const { db } = run();
    const replay = norm(db);
    replay.version = 4; // pretend the version bump was lost after the steps ran
    const second = migrate_v4_to_v5(replay, { now: NOW }).db as DB;
    const strip = (x: any) => ({ ...norm(x), meta: undefined });
    expect(strip(second)).toEqual(strip(db));
    expect(second.meta.migrationsApplied).toHaveLength(2); // the replay is recorded, nothing else changes
  });

  it('does not mutate its input and is deterministic', () => {
    const v4 = loadV4();
    const snapshot = JSON.stringify(v4);
    const a = run(v4);
    const b = run(loadV4());
    expect(JSON.stringify(v4)).toBe(snapshot);
    expect(JSON.stringify(a.db)).toBe(JSON.stringify(b.db));
  });

  it('refuses versions it cannot migrate and requires a timestamp', () => {
    expect(() => migrate_v4_to_v5({ ...loadV4(), version: 3 }, { now: NOW })).toThrow(/expected data version 4/);
    expect(() => migrate_v4_to_v5(loadV4(), {} as any)).toThrow(/opts.now/);
  });

  it('runs through the migration chain from the persisted envelope version', () => {
    const { db, reports } = runMigrations(loadV4(), NOW);
    expect(db.version).toBe(5);
    expect(db.meta.schemaVersion).toBe(5);
    expect(reports).toHaveLength(1);
  });
});

describe('v5 structure', () => {
  const { db, report } = run();

  it('every record satisfies the v5 schema', () => {
    const { errors, unknownFields } = validateDb(db);
    expect(errors).toEqual([]);
    expect(unknownFields).toEqual([]);
  });

  it('users get an empty credential record and stay active', () => {
    for (const u of db.users) {
      expect(u.active).toBe(true);
      expect(u.auth.passwordHash).toBeNull();
      expect(u.auth.mustChangePassword).toBe(true);
      expect(u.auth.totpSecret).toBeNull();
      expect(typeof u.locationOverrideAllowed).toBe('boolean');
    }
  });

  it('TDS clients get 24Q + 26Q; the single TDS return type is retired without losing its tasks', () => {
    for (const c of db.clients) {
      expect(c.profile.tdsSalary).toBe(c.profile.tds);
      expect(c.profile.tdsNonSalary).toBe(c.profile.tds);
      expect(c.profile.tdsNonResident).toBe(false);
      expect(c.profile.tcs).toBe(false);
    }
    const ret = db.complianceTypes.find((t) => t.code === 'TDS_RET')!;
    expect(ret.retired).toBe(true);
    expect(ret.isActive).toBe(false);
    expect(db.tasks.filter((t) => t.complianceTypeCode === 'TDS_RET').length).toBe(loadV4().tasks.filter((t: any) => t.complianceTypeCode === 'TDS_RET').length);
  });

  it('new return types start after the last quarter already covered, so syncing creates no duplicate obligation', () => {
    const synced = norm(db) as DB;
    for (const c of synced.clients) applyClientSync(synced, c.id, 'u-farhan', 'sync', '2026-10-06');
    for (const c of synced.clients.filter((x) => x.profile.tds)) {
      const covered = new Set(synced.tasks.filter((t) => t.clientId === c.id && t.complianceTypeCode === 'TDS_RET').map((t) => t.periodKey));
      const split = synced.tasks.filter((t) => t.clientId === c.id && (t.complianceTypeCode === 'TDS_24Q' || t.complianceTypeCode === 'TDS_26Q'));
      for (const t of split) expect(covered.has(t.periodKey), `${c.code} ${t.title}`).toBe(false);
      expect(c.complianceStartDates.TDS_24Q).toBe(periodStart('FY2026-27-Q4'));
    }
    // a second sync generates nothing new
    for (const c of synced.clients) expect(planClientSync(synced, c, '2026-10-06').create).toEqual([]);
  });

  it('29 active compliance types, all marked illustrative, matching the app defaults', () => {
    const active = db.complianceTypes.filter((t) => t.isActive && !t.retired);
    expect(active).toHaveLength(29);
    for (const t of db.complianceTypes) {
      expect(t.illustrative).toBe(true);
      expect(t.verifiedBy).toBeNull();
    }
    const byCode = (xs: any[]) => [...xs].sort((a, b) => a.code.localeCompare(b.code));
    expect(norm(byCode(db.complianceTypes))).toEqual(norm(byCode(DEFAULT_COMPLIANCE_TYPES)));
    expect(db.complianceTypes.find((t) => t.code === 'TP3CEB')!.applicability).toEqual([{ flag: 'transferPricing', value: 'true' }]);
  });

  it('templates get version 1 with a history entry; the same as the app defaults apart from timestamps', () => {
    for (const t of db.templates) {
      expect(t.version).toBe(1);
      expect(t.versions).toHaveLength(1);
      expect(t.versions[0].stages).toEqual(t.stages);
    }
    const strip = (xs: any[]) => norm(xs).map((t: any) => ({ ...t, versions: t.versions.map((v: any) => ({ ...v, effectiveFrom: '', createdBy: '' })) }));
    expect(strip(db.templates)).toEqual(strip(DEFAULT_TEMPLATES));
  });

  it('fee basis: recurring for compliance engagements, not set for one-time work', () => {
    for (const e of db.engagements) expect(e.feeBasis).toEqual(e.type === 'recurring' ? { type: 'recurring', amount: null, rate: null, retainerPeriod: null } : null);
  });

  it('UDIN acknowledgments become UDIN register entries and Partner sign-offs', () => {
    const udinTasks = db.tasks.filter((t) => t.ack?.type === 'udin');
    expect(udinTasks.length).toBeGreaterThan(0);
    expect(db.udinRegister).toHaveLength(udinTasks.length);
    for (const t of udinTasks) {
      const u = db.udinRegister.find((x) => x.taskId === t.id)!;
      expect(u.udin).toBe(t.ack!.number);
      expect(t.signoff?.udinId).toBe(u.id);
    }
  });

  it('review state is derived from the status history', () => {
    const underReview = db.tasks.filter((t) => t.status === 'under_review');
    expect(underReview.length).toBeGreaterThan(0);
    for (const t of underReview) expect(t.review?.decision).toBeNull();
    for (const t of db.tasks) expect(Array.isArray(t.reviewPoints)).toBe(true);
  });

  it('the notice engagement gets a notice record', () => {
    expect(db.notices).toHaveLength(1);
    expect(db.notices[0].section).toBe('143(1)(a)');
    expect(db.notices[0].period).toBe('AY 2026-27');
  });

  it('report lists counts before/after, transformations and judgement calls', () => {
    expect(report.countsBefore.tasks).toBe(report.countsAfter.tasks);
    expect(report.transformations.length).toBeGreaterThan(10);
    expect(report.judgementCalls.some((j: any) => j.id === 'c-0109')).toBe(true);
  });
});

describe('edge cases in v4 data', () => {
  it('a client with two GSTINs and one frequency: both registrations kept, GST tasks left unlinked and reported', () => {
    const v4 = loadV4();
    const c = v4.clients.find((x: any) => x.id === 'c-0101');
    c.gstins.push('24AAKCS4821F1Z9');
    const { db, report } = run(v4);
    const m = db.clients.find((x) => x.id === 'c-0101')!;
    expect(m.gstins.map((g) => g.state)).toEqual(['Maharashtra', 'Gujarat']);
    expect(db.tasks.filter((t) => t.clientId === 'c-0101' && t.complianceTypeCode === 'GSTR3B_M').every((t) => t.gstinId === null)).toBe(true);
    expect(report.judgementCalls.filter((j: any) => j.id === 'c-0101').length).toBeGreaterThan(0);
  });

  it('a GSTIN on a client marked "not applicable" keeps the GSTIN with frequency "not set"', () => {
    const v4 = loadV4();
    const c = v4.clients.find((x: any) => x.id === 'c-0103');
    c.gstins = ['27BXQPD5512M1ZB'];
    const { db } = run(v4);
    expect(db.clients.find((x) => x.id === 'c-0103')!.gstins[0].frequency).toBe('not_set');
  });

  it('review points written as notes in v4 become review-point records', () => {
    const v4 = loadV4();
    const t = v4.tasks.find((x: any) => x.status === 'in_progress');
    t.statusHistory.push(
      { at: '2026-10-01T10:00:00.000Z', by: 'u-karan', from: 'in_progress', to: 'under_review', note: 'Submitted' },
      { at: '2026-10-02T10:00:00.000Z', by: 'u-arjun', from: 'under_review', to: 'in_progress', note: 'Returned with review points: Reconcile ITC for August' },
    );
    const { db } = run(v4);
    const m = db.tasks.find((x) => x.id === t.id)!;
    expect(m.reviewPoints).toEqual([{ id: `${t.id}:rp:1`, text: 'Reconcile ITC for August', raisedBy: 'u-arjun', raisedAt: '2026-10-02T10:00:00.000Z', clearedBy: null, clearedAt: null }]);
    expect(m.review).toMatchObject({ submittedBy: 'u-karan', decision: 'returned', checkerId: 'u-arjun' });
  });
});
