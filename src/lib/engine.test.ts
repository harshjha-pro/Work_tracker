import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import { buildSeed } from './seed';
import { applyClientSync, applyExtension, dueForPeriod, planClientSync, recomputeDues } from './compliance';
import { isLocked } from './access';
import { STATUS_LABEL } from './master';

const T = '2026-10-05';

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 5, 11, 30));
});
afterAll(() => vi.useRealTimers());

describe('due-date rules', () => {
  const db = buildSeed(T);
  const type = (c: string) => db.complianceTypes.find((t) => t.code === c)!;
  it('monthly, March override, quarterly, annual and AGM-linked', () => {
    expect(dueForPeriod(type('GSTR3B_M'), {}, '2026-09')!.due).toBe('2026-10-20');
    expect(dueForPeriod(type('GSTR1_M'), {}, '2026-12')!.due).toBe('2027-01-11');
    expect(dueForPeriod(type('TDS_PAY'), {}, '2027-03')!.due).toBe('2027-04-30');
    expect(dueForPeriod(type('TDS_RET'), {}, 'FY2026-27-Q4')!.due).toBe('2027-05-31');
    expect(dueForPeriod(type('ADV_TAX'), {}, 'FY2026-27-Q3')!.due).toBe('2026-12-15');
    expect(dueForPeriod(type('ITR_A'), {}, 'FY2025-26')!.due).toBe('2026-10-31');
    expect(dueForPeriod(type('GSTR9'), {}, 'FY2025-26')!.due).toBe('2026-12-31');
    expect(dueForPeriod(type('AOC4'), { agmDate: '2026-09-26' }, 'FY2025-26')!.due).toBe('2026-10-26');
    expect(dueForPeriod(type('AOC4'), {}, 'FY2025-26')!.provisional).toBe(true);
  });
});

describe('seed', () => {
  const db = buildSeed(T);
  it('has a realistic spread of statuses', () => {
    const counts: Record<string, number> = {};
    for (const t of db.tasks) counts[STATUS_LABEL[t.status]] = (counts[STATUS_LABEL[t.status]] ?? 0) + 1;
    console.log(counts, 'tasks', db.tasks.length, 'entries', db.entries.length, 'engagements', db.engagements.length);
    expect(counts['Pending from Client']).toBeGreaterThanOrEqual(3);
    expect(counts['Filed']).toBeGreaterThan(10);
    expect(counts['Filed Late']).toBeGreaterThanOrEqual(2);
  });
  it('filed tasks always carry an acknowledgment', () => {
    for (const t of db.tasks) if (t.status === 'filed' || t.status === 'filed_late') expect(t.ack?.number).toBeTruthy();
  });
  it('entries respect the hour rules', () => {
    for (const e of db.entries) {
      expect(e.hours).toBeGreaterThanOrEqual(0);
      expect(e.hours).toBeLessThanOrEqual(12);
      expect(e.hours * 4).toBe(Math.round(e.hours * 4));
    }
    const perDay = new Map<string, number>();
    for (const e of db.entries) perDay.set(`${e.userId}|${e.date}`, (perDay.get(`${e.userId}|${e.date}`) ?? 0) + e.hours);
    const max = Math.max(...perDay.values());
    expect(max).toBeLessThanOrEqual(11);
  });
  it('the tax audit extension applies', () => {
    const tar = db.tasks.filter((t) => t.complianceTypeCode === 'TAR' && t.periodKey === 'FY2025-26');
    expect(tar.length).toBe(3);
    for (const t of tar) expect(t.effectiveDue).toBe('2026-10-31');
  });
  it('last week is locked, this week open', () => {
    expect(isLocked(db, 'u-karan', '2026-10-02')).toBe(true);
    expect(isLocked(db, 'u-karan', '2026-10-05')).toBe(false);
  });
});

describe('flags drive the calendar', () => {
  it('turning TDS on creates tasks; turning it off removes untouched ones', () => {
    const db = buildSeed(T);
    const c = db.clients.find((x) => x.code === 'CL-0103')!;
    c.profile.tds = true;
    const plan = planClientSync(db, c);
    expect(plan.create.some((p) => p.type.code === 'TDS_PAY' && p.period.due === '2026-10-07')).toBe(true);
    const r = applyClientSync(db, c.id, 'u-farhan', 'test');
    expect(r.created).toBeGreaterThan(4);
    c.profile.tds = false;
    const r2 = applyClientSync(db, c.id, 'u-farhan', 'test');
    expect(r2.removed).toBe(r.created);
  });
  it('an extension moves open tasks and reclassifies late filings', () => {
    const db = buildSeed(T);
    const open = db.tasks.filter((t) => t.complianceTypeCode === 'GSTR3B_M' && t.periodKey === '2026-09');
    expect(open.length).toBe(3);
    const r = applyExtension(db, { id: 'x', complianceTypeCode: 'GSTR3B_M', periodKeys: ['2026-09'], newDueDate: '2026-10-25', reference: 'N', reason: 'r', publishedAt: new Date().toISOString(), publishedBy: 'u-farhan', tasksMoved: 0 });
    expect(r.moved).toBe(3);
    for (const t of open) expect(t.effectiveDue).toBe('2026-10-25');
  });
  it('master rule change recomputes open tasks', () => {
    const db = buildSeed(T);
    const t = db.complianceTypes.find((x) => x.code === 'GSTR1_M')!;
    t.rule = { kind: 'monthly', day: 13 };
    const moved = recomputeDues(db, 'u-farhan', (x) => x.complianceTypeCode === 'GSTR1_M', 'master_change');
    expect(moved).toBeGreaterThan(0);
    const sep = db.tasks.find((x) => x.complianceTypeCode === 'GSTR1_M' && x.periodKey === '2026-09')!;
    expect(sep.effectiveDue).toBe('2026-10-13');
  });
});

describe('seeded effort', () => {
  it('keeps nearly all recurring periods within budget', () => {
    const db = buildSeed(T);
    const over = db.tasks.filter((t) => t.kind === 'compliance' && t.budgetHours && db.entries.filter((e) => e.taskId === t.id).reduce((a, e) => a + e.hours, 0) > t.budgetHours * 1.1);
    expect(over.length).toBeLessThanOrEqual(3);
  });
});
