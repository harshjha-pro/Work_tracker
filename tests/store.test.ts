// Store guards that protect the data: Rules Spec §8 status rules, maker–checker,
// A13/A14 review control, and the E5 audit hook on new collections.
import { beforeEach, describe, expect, it } from 'vitest';
import { useApp } from '../src/store';
import { seedV5 } from './helpers';

const st = () => useApp.getState();
const as = (userId: string) => useApp.setState({ currentUserId: userId });

beforeEach(() => {
  useApp.setState({ db: seedV5(), hydrated: false, currentUserId: 'u-karan' });
});

const openGst = () => st().db.tasks.find((t) => t.complianceTypeCode === 'GSTR3B_M' && t.status === 'in_progress' && t.reviewPoints.length === 0)!;

describe('§8 status rules', () => {
  it('#10 Filed without an acknowledgment is rejected', () => {
    const t = openGst();
    expect(st().recordFiling(t.id, 'arn', '  ', '2026-10-06')).toMatchObject({ ok: false });
    expect(st().db.tasks.find((x) => x.id === t.id)!.status).toBe('in_progress');
  });

  it('#14 Not Applicable is rejected on a filed task', () => {
    const t = st().db.tasks.find((x) => x.status === 'filed')!;
    expect(st().markNotApplicable(t.id, 'turnover below threshold')).toMatchObject({ ok: false });
    expect(st().db.tasks.find((x) => x.id === t.id)!.status).toBe('filed');
  });

  it('#11 the maker cannot check their own work; article assistants never check', () => {
    const t = openGst();
    expect(st().submitForReview(t.id, 'u-karan')).toMatchObject({ ok: false });
    expect(st().submitForReview(t.id, 'u-arjun')).toMatchObject({ ok: true });
    expect(st().reviewDecision(t.id, true, '')).toMatchObject({ ok: false }); // still Karan
    as('u-ananya');
    expect(st().reviewDecision(t.id, true, '')).toMatchObject({ ok: false });
  });
});

describe('A13 / A14 review control', () => {
  it('returning a task creates review points; filing is blocked until they are cleared and approved', () => {
    const t = openGst();
    st().submitForReview(t.id, 'u-arjun');
    expect(st().recordFiling(t.id, 'arn', 'AA2710260000011', '2026-10-06').ok).toBe(false); // with the checker
    as('u-arjun');
    expect(st().reviewDecision(t.id, false, 'Match ITC with 2B\nAdd credit note CN-41').ok).toBe(true);
    let task = st().db.tasks.find((x) => x.id === t.id)!;
    expect(task.reviewPoints.map((p) => p.text)).toEqual(['Match ITC with 2B', 'Add credit note CN-41']);
    expect(task.review?.decision).toBe('returned');
    as('u-karan');
    expect(st().recordFiling(t.id, 'arn', 'AA2710260000011', '2026-10-06')).toMatchObject({ ok: false, error: expect.stringMatching(/2 review points/) });
    for (const p of task.reviewPoints) st().clearReviewPoint(t.id, p.id);
    st().submitForReview(t.id, 'u-arjun');
    as('u-arjun');
    expect(st().reviewDecision(t.id, true, '').ok).toBe(true);
    as('u-karan');
    expect(st().recordFiling(t.id, 'arn', 'AA2710260000011', '2026-10-06').ok).toBe(true);
    task = st().db.tasks.find((x) => x.id === t.id)!;
    expect(task.status).toBe('filed');
  });

  it('audit filings need the Partner approval and create a UDIN register entry with the sign-off', () => {
    const t = st().db.tasks.find((x) => x.templateCode === 'audit' && x.status === 'under_review' && x.reviewPoints.some((p) => !p.clearedAt))!;
    expect(t).toBeDefined(); // Aarohan statutory audit, open point raised by the Partner
    as('u-meera');
    const open = t.reviewPoints.find((p) => !p.clearedAt)!;
    expect(st().reviewDecision(t.id, true, '').ok).toBe(false);
    st().clearReviewPoint(t.id, open.id);
    expect(st().reviewDecision(t.id, true, 'Signed').ok).toBe(true);
    as('u-sneha');
    expect(st().recordFiling(t.id, 'udin', '26118734BKCDLM4521', '2026-10-06').ok).toBe(true);
    const done = st().db.tasks.find((x) => x.id === t.id)!;
    const udin = st().db.udinRegister.find((u) => u.id === done.signoff?.udinId)!;
    expect(udin).toMatchObject({ udin: '26118734BKCDLM4521', signingPartnerId: 'u-meera', taskId: t.id });
  });
});

describe('E5 audit hook on new collections', () => {
  it('adding and changing a record writes field-level audit entries', () => {
    const before = st().db.audit.length;
    const leave = { ...st().db.leaveRequests[1] };
    expect(st().saveRecord('leaveRequests', { ...leave, status: 'approved', decidedBy: 'u-priya', decidedAt: '2026-10-06T12:00:00Z' }).ok).toBe(true);
    const entry = st().db.audit[0];
    expect(st().db.audit.length).toBe(before + 1);
    expect(entry).toMatchObject({ entity: 'leave', entityId: leave.id, by: 'u-karan' });
    expect(entry.changes!.map((c) => c.field)).toEqual(expect.arrayContaining(['status', 'decidedBy', 'decidedAt']));
  });

  it('append-only registers refuse edits and deletes; users are never deleted', () => {
    const m = st().db.dscMovements[0];
    expect(st().saveRecord('dscMovements', { ...m, notes: 'changed' }).ok).toBe(false);
    expect(st().deleteRecord('dscMovements', m.id).ok).toBe(false);
    expect(st().deleteRecord('users', 'u-karan').ok).toBe(false);
  });

  it('credential changes are audited without writing the hash to the log', () => {
    const u = st().db.users.find((x) => x.id === 'u-aditya')!;
    st().saveRecord('users', { ...u, auth: { ...u.auth, passwordHash: 'SECRET-HASH', passwordSalt: 'SALT' } });
    const entry = st().db.audit[0];
    expect(JSON.stringify(entry)).not.toContain('SECRET-HASH');
    expect(entry.changes).toEqual([{ field: 'auth', from: '(credentials)', to: '(credentials changed)' }]);
  });

  it('sensitive views go to the access log', () => {
    const n = st().db.accessLog.length;
    st().logAccess('dsc_register', 'dsc-01', 'view', 'Opened DSC record');
    expect(st().db.accessLog).toHaveLength(n + 1);
    expect(st().db.accessLog.at(-1)).toMatchObject({ userId: 'u-karan', entity: 'dsc_register' });
  });

  it('deleting a record keeps its last values in the audit trail', () => {
    const io = st().db.inwardOutward[0];
    expect(st().deleteRecord('inwardOutward', io.id, 'Entered twice').ok).toBe(true);
    expect(st().db.audit[0]).toMatchObject({ entity: 'inward_outward', entityId: io.id, detail: 'Entered twice' });
    expect(st().db.audit[0].changes!.some((c) => c.field === 'documentDescription')).toBe(true);
  });
});
