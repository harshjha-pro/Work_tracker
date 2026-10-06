// Rules Spec V1 §11.4 edge cases and §11.5 test scenarios that touch the data (E6).
// Scenario numbers refer to Rules Spec §11.5.
import { describe, expect, it } from 'vitest';
import { applyClientSync, applyExtension, dueForPeriod, planClientSync, recomputeDues, taskKey, unitKeyOf } from '../src/lib/compliance';
import { emptyProfile } from '../src/lib/seed';
import type { Client, DB, GstRegistration } from '../src/lib/types';
import { seedV5, T } from './helpers';

const gst = (gstin: string, frequency: GstRegistration['frequency'], o: Partial<GstRegistration> = {}): GstRegistration => ({
  id: `g-${gstin}`, gstin, stateCode: gstin.slice(0, 2), state: 'Maharashtra', frequency, effectiveFrom: '2024-04-01',
  frequencyHistory: [{ frequency, effectiveFrom: '2024-04-01', changedBy: 'u-farhan', changedAt: '2024-04-01T00:00:00Z' }],
  gstAnnualReturn: false, gst9c: false, iffOpted: false, status: 'active', cancelledOn: null, ...o,
});

function addClient(db: DB, o: Partial<Client>): Client {
  const c: Client = {
    id: `c-test-${db.clients.length}`, code: `CL-T${db.clients.length}`, name: 'Test Client', constitution: 'partnership_firm', status: 'active',
    statusEffectiveFrom: null, gstins: [], fyEnd: '31 Mar', auditorAppointmentDate: null, booksBy: 'firm', partnerId: 'u-rajesh', managerId: 'u-priya',
    profile: emptyProfile(), directors: [], complianceStartDates: {}, flagHistory: [], createdAt: '2026-10-06T00:00:00Z', createdBy: 'u-farhan',
    updatedAt: '2026-10-06T00:00:00Z', updatedBy: 'u-farhan', ...o,
  };
  db.clients.push(c);
  return c;
}

const tasksOf = (db: DB, c: Client, code?: string) => db.tasks.filter((t) => t.clientId === c.id && (!code || t.complianceTypeCode === code));

describe('§3 generation', () => {
  it('#1 basic monthly generation: GSTR-1 and GSTR-3B per month, Upcoming, labelled by the period they cover', () => {
    const db = seedV5();
    const c = addClient(db, { gstins: [gst('27AABFT1234K1Z5', 'monthly')] });
    applyClientSync(db, c.id, 'u-farhan', '', T);
    const r1 = tasksOf(db, c, 'GSTR1_M');
    const r3 = tasksOf(db, c, 'GSTR3B_M');
    expect(r1.length).toBeGreaterThanOrEqual(3);
    expect(r3.length).toBe(r1.length);
    expect(r3[0]).toMatchObject({ periodLabel: 'Sep 2026', originalDue: '2026-10-20', status: 'upcoming', gstinId: 'g-27AABFT1234K1Z5' });
  });

  it('#2 idempotent re-run: the second run creates nothing', () => {
    const db = seedV5();
    const before = db.tasks.length;
    for (const c of db.clients) expect(applyClientSync(db, c.id, 'u-farhan', '', T).created).toBe(0);
    expect(db.tasks.length).toBe(before);
  });

  it('natural key (client, type, period, GSTIN/director) is unique across the whole seed', () => {
    const db = seedV5();
    const keys = db.tasks.filter((t) => t.kind === 'compliance').map((t) => taskKey(t.clientId, t.complianceTypeCode!, t.periodKey!, unitKeyOf(t)));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('compliance start date: no task for a period that starts before it (partial quarter)', () => {
    const db = seedV5();
    const c = addClient(db, { profile: { ...emptyProfile(), tds: true, tdsNonSalary: true }, complianceStartDates: { TDS_26Q: '2026-11-15' } });
    applyClientSync(db, c.id, 'u-farhan', '', T);
    const q = tasksOf(db, c, 'TDS_26Q').map((t) => t.periodKey);
    expect(q).not.toContain('FY2026-27-Q2'); // Jul–Sep
    expect(q).not.toContain('FY2026-27-Q3'); // Oct–Dec started before 15 Nov
  });

  it('leap year: the February period resolves to the right following-month dates', () => {
    const db = seedV5();
    const t3b = db.complianceTypes.find((t) => t.code === 'GSTR3B_M')!;
    const tds = db.complianceTypes.find((t) => t.code === 'TDS_PAY')!;
    expect(dueForPeriod(t3b, {}, '2028-02')!.due).toBe('2028-03-20');
    expect(dueForPeriod(tds, {}, '2028-02')!.due).toBe('2028-03-07');
    expect(dueForPeriod(tds, {}, '2028-03')!.due).toBe('2028-04-30');
  });
});

describe('A19 GST per registration', () => {
  it('two GSTINs on different frequencies generate separate tasks; IFF only in months 1–2 of the quarter', () => {
    const db = seedV5();
    const c = addClient(db, { gstins: [gst('29AABFT1234K1Z5', 'monthly'), gst('27AABFT1234K2Z4', 'qrmp', { iffOpted: true })] });
    applyClientSync(db, c.id, 'u-farhan', '', T);
    expect(tasksOf(db, c, 'GSTR3B_M').every((t) => t.gstinId === 'g-29AABFT1234K1Z5')).toBe(true);
    expect(tasksOf(db, c, 'GSTR3B_Q').every((t) => t.gstinId === 'g-27AABFT1234K2Z4')).toBe(true);
    const iff = tasksOf(db, c, 'IFF').map((t) => t.periodKey);
    expect(iff).toContain('2026-10'); // month 1 of Q3
    expect(iff).toContain('2026-11'); // month 2
    expect(iff).not.toContain('2026-12'); // month 3 is covered by the quarterly GSTR-1
  });

  it('a GSTIN changing frequency: periods before the change keep the old frequency', () => {
    const db = seedV5();
    const g = gst('27AABFT1234K1Z5', 'qrmp', {
      effectiveFrom: '2027-01-01',
      frequencyHistory: [
        { frequency: 'monthly', effectiveFrom: '2024-04-01', changedBy: 'u-farhan', changedAt: '2024-04-01T00:00:00Z' },
        { frequency: 'qrmp', effectiveFrom: '2027-01-01', changedBy: 'u-farhan', changedAt: '2026-10-06T00:00:00Z' },
      ],
    });
    const c = addClient(db, { gstins: [g] });
    applyClientSync(db, c.id, 'u-farhan', '', T);
    const monthly = tasksOf(db, c, 'GSTR3B_M').map((t) => t.periodKey);
    const quarterly = tasksOf(db, c, 'GSTR3B_Q').map((t) => t.periodKey);
    expect(monthly).toEqual(expect.arrayContaining(['2026-09', '2026-10', '2026-11', '2026-12']));
    expect(monthly.some((k) => k! >= '2027-01')).toBe(false);
    expect(quarterly).not.toContain('FY2026-27-Q3');
  });

  it('cancelling a GSTIN stops its future tasks', () => {
    const db = seedV5();
    const c = addClient(db, { gstins: [gst('27AABFT1234K1Z5', 'monthly')] });
    applyClientSync(db, c.id, 'u-farhan', '', T);
    c.gstins[0].status = 'cancelled';
    const r = applyClientSync(db, c.id, 'u-farhan', 'GST registration cancelled', T);
    expect(r.removed).toBeGreaterThan(0);
    expect(tasksOf(db, c).filter((t) => t.status === 'upcoming')).toHaveLength(0);
  });
});

describe('A20, A22, A23 types driven by the client', () => {
  it('#12 per-director DIR-3 KYC: three directors, three obligations', () => {
    const db = seedV5();
    const c = addClient(db, {
      constitution: 'private_company',
      agmDate: '2026-09-28',
      directors: ['01111111', '02222222', '03333333'].map((din, i) => ({ id: `d${i}`, name: `Director ${i + 1}`, din, designation: 'director' as const, dscId: null, appointedOn: null, ceasedOn: null, active: true })),
    });
    applyClientSync(db, c.id, 'u-farhan', '', '2026-07-01');
    const kyc = tasksOf(db, c, 'DIR3').filter((t) => t.periodKey === 'FY2025-26');
    expect(kyc.map((t) => t.directorId).sort()).toEqual(['d0', 'd1', 'd2']);
  });

  it('A22 transfer pricing creates Form 3CEB and moves ITR (audit case) to 30 Nov', () => {
    const db = seedV5();
    const c = addClient(db, { constitution: 'private_company', profile: { ...emptyProfile(), transferPricing: true }, agmDate: '2026-09-28' });
    applyClientSync(db, c.id, 'u-farhan', '', '2026-07-01');
    expect(tasksOf(db, c, 'TP3CEB').map((t) => t.originalDue)).toContain('2026-10-31');
    expect(tasksOf(db, c, 'ITR_A').find((t) => t.periodKey === 'FY2025-26')!.originalDue).toBe('2026-11-30');
  });

  it('statutory audit is generated for every company even with the flag off', () => {
    const db = seedV5();
    const c = addClient(db, { constitution: 'public_company', agmDate: '2026-09-28' });
    applyClientSync(db, c.id, 'u-farhan', '', '2026-07-01');
    expect(tasksOf(db, c, 'STAT_AUDIT').length).toBe(1);
  });

  it('ADT-1 follows the auditor appointment date, defaulting to the AGM', () => {
    const db = seedV5();
    const t = db.complianceTypes.find((x) => x.code === 'ADT1')!;
    expect(dueForPeriod(t, { agmDate: '2026-09-26' }, 'FY2025-26')!.due).toBe('2026-10-11');
    expect(dueForPeriod(t, { agmDate: '2026-09-26', auditorAppointmentDate: '2026-09-29' }, 'FY2025-26')!.due).toBe('2026-10-14');
  });
});

describe('§4 event dates and §5 extensions', () => {
  it('#4 AGM unknown, then confirmed: provisional date recomputes and history records it', () => {
    const db = seedV5();
    const c = addClient(db, { constitution: 'private_company' });
    applyClientSync(db, c.id, 'u-farhan', '', '2026-07-01');
    const aoc = tasksOf(db, c, 'AOC4').find((t) => t.periodKey === 'FY2025-26')!;
    expect(aoc.provisional).toBe(true);
    expect(aoc.originalDue).toBe('2026-10-30'); // 30 Sep ceiling + 30 days
    c.agmDate = '2026-09-12';
    recomputeDues(db, 'u-arjun', (t) => t.clientId === c.id, 'event_correction');
    expect(aoc.provisional).toBe(false);
    expect(aoc.effectiveDue).toBe('2026-10-12');
    expect(aoc.dueHistory.at(-1)).toMatchObject({ from: '2026-10-30', to: '2026-10-12', source: 'event_correction' });
  });

  it('#15 event date corrected after filing: the filing stays, Filed Late can become Filed', () => {
    const db = seedV5();
    const c = addClient(db, { constitution: 'private_company', agmDate: '2026-08-20' });
    applyClientSync(db, c.id, 'u-farhan', '', '2026-07-01');
    const aoc = tasksOf(db, c, 'AOC4').find((t) => t.periodKey === 'FY2025-26')!; // due 19 Sep
    aoc.ack = { type: 'srn', number: 'F12345678', date: '2026-09-25' };
    aoc.status = 'filed_late';
    c.agmDate = '2026-08-28'; // corrected → due 27 Sep
    recomputeDues(db, 'u-arjun', (t) => t.clientId === c.id, 'event_correction');
    expect(aoc.ack).toEqual({ type: 'srn', number: 'F12345678', date: '2026-09-25' });
    expect(aoc.status).toBe('filed');
  });

  it('#5 an extension covering the filing date flips Filed Late to Filed; Filed is never reversed', () => {
    const db = seedV5();
    const late = db.tasks.find((t) => t.status === 'filed_late' && t.kind === 'compliance')!;
    const onTime = db.tasks.find((t) => t.status === 'filed' && t.complianceTypeCode === late.complianceTypeCode && t.periodKey !== late.periodKey);
    const ext = (periodKeys: string[], newDueDate: string) => ({ id: 'x', complianceTypeCode: late.complianceTypeCode!, periodKeys, newDueDate, reference: 'N/2026', reason: 'r', status: 'published' as const, supersedesId: null, publishedAt: '2026-10-06T10:00:00Z', publishedBy: 'u-farhan', tasksMoved: 0 });
    const r = applyExtension(db, ext([late.periodKey!], late.ack!.date));
    expect(r.reclassified).toBe(1);
    expect(late.status).toBe('filed');
    if (onTime) {
      applyExtension(db, ext([onTime.periodKey!], '2020-01-01')); // an earlier date never makes a filing late
      expect(onTime.status).toBe('filed');
    }
  });

  it('an extension never touches Not Applicable tasks', () => {
    const db = seedV5();
    const t = db.tasks.find((x) => x.status === 'upcoming' && x.kind === 'compliance')!;
    t.status = 'not_applicable';
    t.naReason = 'test';
    const due = t.effectiveDue;
    applyExtension(db, { id: 'x', complianceTypeCode: t.complianceTypeCode!, periodKeys: [t.periodKey!], newDueDate: '2027-12-31', reference: '', reason: 'r', status: 'published', supersedesId: null, publishedAt: '2026-10-06T10:00:00Z', publishedBy: 'u-farhan', tasksMoved: 0 });
    expect(t.effectiveDue).toBe(due);
  });
});

describe('§7 mid-year changes', () => {
  it('#7 flag turned off: open tasks with work become Not Applicable with a reason; untouched ones go; filed ones stay', () => {
    const db = seedV5();
    const c = db.clients.find((x) => x.id === 'c-0102')!; // Deshmukh & Sons, TDS on
    const tds = tasksOf(db, c).filter((t) => ['TDS_PAY', 'TDS_24Q', 'TDS_26Q'].includes(t.complianceTypeCode!));
    const filed = tds.filter((t) => t.status === 'filed').map((t) => t.id);
    c.profile.tds = false;
    c.profile.tdsSalary = false;
    c.profile.tdsNonSalary = false;
    const plan = planClientSync(db, c, T);
    applyClientSync(db, c.id, 'u-priya', 'Applicability flag TDS removed effective 2026-10-06', T);
    for (const t of plan.markNA) expect(db.tasks.find((x) => x.id === t.id)!.naReason).toMatch(/TDS removed/);
    for (const id of filed) expect(db.tasks.find((x) => x.id === id)!.status).toBe('filed');
    expect(planClientSync(db, c, T).create.filter((p) => p.type.code.startsWith('TDS'))).toEqual([]);
  });

  it('#8 a dormant client keeps generating its live obligations', () => {
    const db = seedV5();
    const c = addClient(db, { status: 'dormant', gstins: [gst('27AABFT1234K1Z5', 'monthly')] });
    applyClientSync(db, c.id, 'u-farhan', '', T);
    expect(tasksOf(db, c, 'GSTR3B_M').length).toBeGreaterThan(0);
  });

  it('#9 a discontinued client generates no new recurring periods', () => {
    const db = seedV5();
    const c = addClient(db, { status: 'discontinued', gstins: [gst('27AABFT1234K1Z5', 'monthly')] });
    applyClientSync(db, c.id, 'u-farhan', '', T);
    expect(tasksOf(db, c)).toHaveLength(0);
  });
});
