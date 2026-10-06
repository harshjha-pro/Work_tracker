// Demo data for the collections added in schema v5 (E7). Everything is fictional
// and generated relative to today so "Reset demo data" always shows a live picture.

import type { DB, Director, Engagement, ISODate, Task, TaskStatus } from './types';
import { addDays, ayLabel, fyLabel, fyStartYear, weekStart } from './dates';
import { isoAt } from './access';
import { sha256Hex } from './util';
import { isOpen } from './master';

export const DEMO_PIN_HASHES: Record<string, [string, string]> = {
  'u-rajesh': ['aF/w7HoWZT29Q7vzDAc+lg==', 'LT2Tz/dkwBZ4PUTyYwOBwcTfwvsfmF1bfdNm4dzwrus='],
  'u-meera': ['bQyyk5sovQpHnnM6P9uqlA==', 'Hd4YZ+LV1HwP230vXBaLH/2wtZO7foU4CAoz/51yq2k='],
  'u-priya': ['WbLdTzGn5mB/5Z6fVKL/qQ==', 'Ylaar45nbM3gBoVTNMVU/D4lSQgu4yrINRin2OFJcx0='],
  'u-arjun': ['Cyt9EXHIPD77VTtTijBlig==', '45bwDtwxehRh6txjYdMldOKlxfjWXUpKZIWG46Tes68='],
  'u-sneha': ['9C7N/I9W9xdZ7f2C05CioQ==', 'WUD11knyoNOoa8j203M9LByPqRI/lP7OFcwTnezH+z0='],
  'u-karan': ['r0xXYH3kXHY+fEFQHwUwUA==', '5WxbNrQ5n7D14pn7dp9rwt0BjLU8+/Nf95GQWiegl7w='],
  'u-divya': ['WBwLBJkGppHk+TBtUWgL2A==', 'i5gdU/fwdBLXi4BZ75kIxHM68nyegJB5K32wvQBZTJU='],
  'u-rohit': ['aVQPp47/jVWu0H582vVH6A==', '2QPG0PZlO8s6TUuHh44tWTMyFJay4LPnBYcTJzQHua4='],
  'u-ananya': ['znuJPZCEXKyH+ko7mph2sw==', 'jFDwk+PqWzw9fDD0Ph45WeG59G2LIenn4CFjYj1EQLg='],
  'u-aditya': ['HO0kJPs0YuT2G29EpGUPUA==', '3mIPvh6KXMH2ldFvRr0gJXDZA/v5p20Kb92HPXU8ex4='],
  'u-farhan': ['q/pHHcUgEDH+MNdpmiZWYw==', 's3lI6swM49UdsTJHMH49agGjSQu9g/ggHvXfj/QgPBI='],
};

const dir = (id: string, name: string, din: string, designation: Director['designation'], dscId: string | null, appointedOn: string): Director => ({
  id, name, din, designation, dscId, appointedOn, ceasedOn: null, active: true,
});

export const DEMO_DIRECTORS: Record<string, Director[]> = {
  'c-0101': [
    dir('dir-sg-1', 'Mahesh Agarwal', '01234567', 'managing_director', 'dsc-01', '2012-04-10'),
    dir('dir-sg-2', 'Sunita Agarwal', '01234568', 'director', 'dsc-02', '2012-04-10'),
    dir('dir-sg-3', 'Rakesh Agarwal', '02345671', 'whole_time_director', null, '2019-09-30'),
  ],
  'c-0105': [
    dir('dir-bp-1', 'Neha Fernandes', '07654321', 'designated_partner', 'dsc-04', '2018-06-01'),
    dir('dir-bp-2', 'Joel Fernandes', '07654322', 'designated_partner', null, '2018-06-01'),
  ],
  'c-0108': [
    dir('dir-vs-1', 'Suresh Rao', '08123456', 'managing_director', 'dsc-03', '2019-03-15'),
    dir('dir-vs-2', 'Anand Kulkarni', '08123457', 'director', 'dsc-05', '2021-11-02'),
  ],
  'c-0109': [
    dir('dir-ka-1', 'Prakash Desai', '00456789', 'director', null, '2004-07-20'),
    dir('dir-ka-2', 'Meghana Desai', '00456790', 'director', null, '2010-01-05'),
  ],
};

const enc = (s: string) => new TextEncoder().encode(s);

/** A tiny but valid one-page PDF with a line of text. */
function pdf(title: string, line: string): Uint8Array {
  const content = `BT /F1 14 Tf 72 760 Td (${title}) Tj 0 -24 Td /F1 11 Tf (${line}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return enc(out);
}

/** Bodies for the demo attachments; persist.ts writes them to IndexedDB on first boot. */
export const DEMO_FILES: Record<string, () => Uint8Array> = {
  'blob-notice-143-1a': () => pdf('Intimation u/s 143(1)(a) - Dr. Anil Deshpande', 'Proposed adjustment: interest income mismatch with AIS (Rs 38,412).'),
  'blob-networth-cert': () => pdf('Net worth certificate - Dr. Anil Deshpande', 'Net worth as on 31-03-2026: Rs 2,84,16,500. Signed by CA Meera Kulkarni.'),
  'blob-asmt10': () => pdf('Form GST ASMT-10 - Brightpath Logistics LLP', 'Discrepancy: ITC in GSTR-3B exceeds GSTR-2B by Rs 1,84,500 (FY 2024-25).'),
  'blob-stock-summary': () => enc('Godown,Item,Qty (m),Value (Rs)\nBhiwandi-1,Cotton fabric 60s,18450,2214000\nBhiwandi-1,Polyester blend,9320,838800\nIchalkaranji,Grey cloth,26100,1957500\n'),
};

interface Helpers {
  notice: { eng: Engagement; task: Task };
  stock: { eng: Engagement; task: Task };
  books: { eng: Engagement; task: Task };
  oneTime: (e: Omit<Engagement, 'id' | 'createdAt' | 'createdBy' | 'status' | 'type' | 'feeBasis'> & { feeBasis?: Engagement['feeBasis'] }, stage: number, status: TaskStatus) => { eng: Engagement; task: Task };
  rand: () => number;
}

export function addV5DemoData(db: DB, T: ISODate, h: Helpers) {
  const fyClosed = fyStartYear(T) - 1;
  const at = (days: number, time = '11:00') => isoAt(addDays(T, days), time);
  const audit = (by: string, entity: DB['audit'][number]['entity'], entityId: string, action: string, detail: string, days: number) =>
    db.audit.push({ id: `seed-audit-${db.audit.length + 1}`, at: at(days, '17:30'), by, entity, entityId, action, detail });

  // ---------- UDIN register (B3): signed audit tasks + certificates ----------
  for (const t of db.tasks) {
    if (t.ack?.type !== 'udin') continue;
    const c = db.clients.find((x) => x.id === t.clientId)!;
    const id = `udin:${t.id}`;
    db.udinRegister.push({
      id, clientId: t.clientId, taskId: t.id, engagementId: t.engagementId, institute: 'icai', documentType: t.title.split(' · ')[0],
      dateOfSigning: t.ack.date, signingPartnerId: c.partnerId, udin: t.ack.number, dateGenerated: t.ack.date, signedCopyRef: null,
      status: c.id === 'c-0101' && t.complianceTypeCode === 'STAT_AUDIT' ? 'reconciled' : 'generated',
      reconciledAt: c.id === 'c-0101' && t.complianceTypeCode === 'STAT_AUDIT' ? at(-5) : null,
      reconciledBy: c.id === 'c-0101' && t.complianceTypeCode === 'STAT_AUDIT' ? 'u-rajesh' : null,
      notes: '', createdAt: isoAt(t.ack.date, '17:00'), createdBy: t.assignedTo ?? 'u-farhan',
    });
    t.signoff = { by: c.partnerId, at: isoAt(t.ack.date, '16:00'), udinId: id };
  }
  db.udinRegister.push(
    {
      id: 'udin-cert-turnover', clientId: 'c-0102', taskId: null, engagementId: null, institute: 'icai', documentType: 'Turnover certificate for bank (CC limit renewal)',
      dateOfSigning: addDays(T, -18), signingPartnerId: 'u-rajesh', udin: null, dateGenerated: null, signedCopyRef: 'Physical file DS/2026/14',
      status: 'pending_generation', reconciledAt: null, reconciledBy: null, notes: 'Bank collected the original; UDIN still to be generated on the ICAI portal.',
      createdAt: at(-18, '16:30'), createdBy: 'u-karan',
    },
    {
      id: 'udin-cert-networth', clientId: 'c-0103', taskId: null, engagementId: null, institute: 'icai', documentType: 'Net worth certificate (visa application)',
      dateOfSigning: addDays(T, -3), signingPartnerId: 'u-meera', udin: '26118734BMKQXP2187', dateGenerated: addDays(T, -3), signedCopyRef: 'att-networth',
      status: 'generated', reconciledAt: null, reconciledBy: null, notes: '', createdAt: at(-3, '15:20'), createdBy: 'u-divya',
    },
  );
  audit('u-karan', 'udin', 'udin-cert-turnover', 'UDIN register entry added', 'Deshmukh & Sons · Turnover certificate · awaiting UDIN', -18);
  audit('u-divya', 'udin', 'udin-cert-networth', 'UDIN recorded', 'Dr. Anil Deshpande · Net worth certificate · 26118734BMKQXP2187', -3);

  // ---------- DSC register + movements (B4) ----------
  const dsc = (id: string, holderName: string, o: Partial<DB['dscRegister'][number]>): DB['dscRegister'][number] => ({
    id, holderName, holderDirectorId: null, holderUserId: null, clientIds: [], dscClass: 'class_3', dscType: 'signing', issuingAuthority: 'eMudhra',
    tokenSerial: null, issueDate: addDays(T, -400), expiryDate: addDays(T, 330), custody: 'in_office', custodyLocation: 'DSC cabinet, drawer 1',
    custodyUserId: null, active: true, notes: '', createdAt: isoAt(addDays(T, -90), '10:00'), createdBy: 'u-farhan', ...o,
  });
  db.dscRegister.push(
    dsc('dsc-01', 'Mahesh Agarwal', { holderDirectorId: 'dir-sg-1', clientIds: ['c-0101'], tokenSerial: 'EPASS2003-7741902', issueDate: addDays(T, -710), expiryDate: addDays(T, 20), notes: 'Renewal to be started — needed for AOC-4 this month.' }),
    dsc('dsc-02', 'Sunita Agarwal', { holderDirectorId: 'dir-sg-2', clientIds: ['c-0101'], issuingAuthority: 'Capricorn', custody: 'with_client', custodyLocation: null, expiryDate: addDays(T, 410) }),
    dsc('dsc-03', 'Suresh Rao', { holderDirectorId: 'dir-vs-1', clientIds: ['c-0108'], dscType: 'combined', custody: 'with_staff', custodyLocation: null, custodyUserId: 'u-ananya', expiryDate: addDays(T, 290) }),
    dsc('dsc-04', 'Neha Fernandes', { holderDirectorId: 'dir-bp-1', clientIds: ['c-0105'], issuingAuthority: '(n)Code Solutions', custodyLocation: 'DSC cabinet, drawer 2', issueDate: addDays(T, -725), expiryDate: addDays(T, 5) }),
    dsc('dsc-05', 'Anand Kulkarni', { holderDirectorId: 'dir-vs-2', clientIds: ['c-0108'], custody: 'with_client', custodyLocation: null, issueDate: addDays(T, -745), expiryDate: addDays(T, -15), active: false, notes: 'Expired — client informed on WhatsApp.' }),
    dsc('dsc-06', 'CA Rajesh Iyer', { holderUserId: 'u-rajesh', dscType: 'combined', issuingAuthority: 'Capricorn', custody: 'with_staff', custodyLocation: null, custodyUserId: 'u-rajesh', expiryDate: addDays(T, 520), notes: "Partner's own DSC for e-filing audit reports." }),
  );
  const mv = (id: string, dscId: string, from: DB['dscMovements'][number]['from'], to: DB['dscMovements'][number]['to'], days: number, handledBy: string, o: Partial<DB['dscMovements'][number]> = {}) =>
    db.dscMovements.push({ id, dscId, from, to, toLocation: null, toUserId: null, movedAt: at(days, '12:15'), handledBy, relatedTaskId: null, notes: '', ...o });
  const vk = db.tasks.find((t) => t.clientId === 'c-0108' && t.complianceTypeCode === 'DIR3' && t.directorId === 'dir-vs-1' && t.status === 'pending_from_client');
  mv('dscm-1', 'dsc-04', 'with_client', 'in_office', -60, 'u-farhan', { toLocation: 'DSC cabinet, drawer 2', notes: 'Received from Neha Fernandes for LLP Form 11' });
  mv('dscm-2', 'dsc-01', 'with_client', 'in_office', -30, 'u-farhan', { toLocation: 'DSC cabinet, drawer 1', notes: 'Received for AOC-4 / MGT-7' });
  mv('dscm-3', 'dsc-02', 'in_office', 'with_client', -10, 'u-farhan', { notes: 'Returned to Sunita Agarwal after DIR-3 KYC' });
  mv('dscm-4', 'dsc-03', 'in_office', 'with_staff', -3, 'u-farhan', { toUserId: 'u-ananya', relatedTaskId: vk?.id ?? null, notes: 'Taken to client office for DIR-3 KYC OTP' });
  for (const m of db.dscMovements) audit(m.handledBy, 'dsc', m.dscId, 'DSC moved', `${m.from.replace('_', ' ')} → ${m.to.replace('_', ' ')} · ${m.notes}`, -1);

  // ---------- Notices (B5) ----------
  const ext143 = h.notice;
  db.notices.push({
    id: 'notice-143-1a', clientId: ext143.eng.clientId, engagementId: ext143.eng.id, taskId: ext143.task.id, authority: 'income_tax', period: ayLabel(fyClosed),
    noticeType: 'Intimation (proposed adjustment)', section: '143(1)(a)', din: `CPC/${fyClosed + 1}-${String((fyClosed + 2) % 100).padStart(2, '0')}/A1/137845210`,
    dateOfNotice: addDays(T, -12), dateReceived: addDays(T, -10), responseDueDate: ext143.task.effectiveDue, hearings: [], status: 'data_gathering',
    outcome: 'pending', demandRaised: 38412, demandDropped: null, assignedTo: 'u-divya', reviewerId: 'u-priya',
    createdAt: at(-10, '10:00'), createdBy: 'u-priya', updatedAt: at(-2), updatedBy: 'u-divya',
  });
  const asmt = h.oneTime(
    {
      clientId: 'c-0105', serviceLine: 'gst', title: `ASMT-10 scrutiny — ${fyLabel(fyClosed - 1)}`, financialYear: fyLabel(fyClosed - 1), templateCode: 'notice',
      partnerId: 'u-meera', managerId: 'u-arjun', team: [{ userId: 'u-karan', role: 'maker' }, { userId: 'u-arjun', role: 'checker' }],
      budgetHours: 12, billable: true, startDate: addDays(T, -25), endDate: addDays(T, 4), feeBasis: { type: 'fixed', amount: 25000, rate: null, retainerPeriod: null },
    },
    4,
    'in_progress',
  );
  db.notices.push({
    id: 'notice-asmt10', clientId: 'c-0105', engagementId: asmt.eng.id, taskId: asmt.task.id, authority: 'gst', period: fyLabel(fyClosed - 1),
    noticeType: 'ASMT-10 (scrutiny of returns)', section: '61', din: 'ZD270926031457K', dateOfNotice: addDays(T, -28), dateReceived: addDays(T, -25),
    responseDueDate: addDays(T, 4), hearings: [{ id: 'hr-asmt-1', date: addDays(T, 12), adjournedTo: null, outcomeNote: 'Personal hearing scheduled before the proper officer', attendedBy: null }],
    status: 'review', outcome: 'pending', demandRaised: 184500, demandDropped: null, assignedTo: 'u-karan', reviewerId: 'u-arjun',
    createdAt: at(-25, '10:00'), createdBy: 'u-arjun', updatedAt: at(-1), updatedBy: 'u-karan',
  });
  const scr = h.oneTime(
    {
      clientId: 'c-0102', serviceLine: 'direct_tax', title: `Scrutiny u/s 143(2) — ${ayLabel(fyClosed - 2)}`, financialYear: fyLabel(fyClosed - 2), templateCode: 'notice',
      partnerId: 'u-rajesh', managerId: 'u-priya', team: [{ userId: 'u-karan', role: 'maker' }, { userId: 'u-priya', role: 'checker' }],
      budgetHours: 30, billable: true, startDate: addDays(T, -210), endDate: addDays(T, -62), feeBasis: { type: 'time', amount: null, rate: 3000, retainerPeriod: null },
    },
    7,
    'in_progress',
  );
  scr.task.ack = { type: 'other', number: 'Order u/s 143(3) — no addition', date: addDays(T, -64) };
  scr.task.statusHistory.push({ at: at(-64, '17:00'), by: 'u-karan', from: 'in_progress', to: 'filed', note: 'Assessment order received — returned income accepted' });
  scr.task.status = 'filed';
  scr.task.stageIndex = 7;
  scr.eng.status = 'completed';
  db.notices.push({
    id: 'notice-143-2', clientId: 'c-0102', engagementId: scr.eng.id, taskId: scr.task.id, authority: 'income_tax', period: ayLabel(fyClosed - 2),
    noticeType: 'Scrutiny (limited)', section: '143(2)', din: `ITBA/AST/S/143(2)/${fyClosed - 1}-${String(fyClosed % 100).padStart(2, '0')}/1061297734(1)`,
    dateOfNotice: addDays(T, -214), dateReceived: addDays(T, -210), responseDueDate: addDays(T, -180),
    hearings: [
      { id: 'hr-143-1', date: addDays(T, -150), adjournedTo: addDays(T, -128), outcomeNote: 'Adjourned at our request — bank confirmations awaited', attendedBy: 'u-priya' },
      { id: 'hr-143-2', date: addDays(T, -128), adjournedTo: null, outcomeNote: 'Submissions accepted; no further queries', attendedBy: 'u-priya' },
    ],
    status: 'closed', outcome: 'demand_dropped', demandRaised: 312000, demandDropped: 312000, assignedTo: 'u-karan', reviewerId: 'u-priya',
    createdAt: at(-210, '10:00'), createdBy: 'u-priya', updatedAt: at(-64), updatedBy: 'u-priya',
  });
  audit('u-arjun', 'notice', 'notice-asmt10', 'Notice recorded', 'Brightpath Logistics LLP · ASMT-10 · response due ' + addDays(T, 4), -25);
  audit('u-priya', 'notice', 'notice-143-2', 'Notice closed', 'Deshmukh & Sons · 143(2) · demand of ₹3,12,000 dropped', -64);

  // ---------- Inward / outward register (B6) ----------
  const io = (id: string, o: Omit<DB['inwardOutward'][number], 'id' | 'createdAt' | 'createdBy'>, days: number) =>
    db.inwardOutward.push({ id, ...o, createdAt: at(days, '12:40'), createdBy: o.handledBy });
  io('io-1', {
    clientId: 'c-0101', direction: 'inward', date: addDays(T, -4), documentDescription: 'Stock registers and godown records FY 2025-26 (3 files)', documentType: 'Original',
    counterpartyName: 'Mahesh Agarwal', handledBy: 'u-rohit', currentLocation: 'Audit room, rack B', custodianUserId: 'u-rohit', linkedInwardId: null, returned: false,
    returnDueDate: addDays(T, 21), taskId: h.stock.task.id, engagementId: h.stock.eng.id, notes: 'For the lender stock audit',
  }, -4);
  io('io-2', {
    clientId: 'c-0102', direction: 'inward', date: addDays(T, -35), documentDescription: 'Original bank statements FY 2025-26 (SBI, HDFC)', documentType: 'Original',
    counterpartyName: 'Vikas Deshmukh', handledBy: 'u-karan', currentLocation: null, custodianUserId: null, linkedInwardId: null, returned: true,
    returnDueDate: addDays(T, -15), taskId: null, engagementId: null, notes: '',
  }, -35);
  io('io-3', {
    clientId: 'c-0102', direction: 'outward', date: addDays(T, -20), documentDescription: 'Original bank statements FY 2025-26 (SBI, HDFC) returned', documentType: 'Original',
    counterpartyName: 'Vikas Deshmukh', handledBy: 'u-karan', currentLocation: null, custodianUserId: null, linkedInwardId: 'io-2', returned: false,
    returnDueDate: null, taskId: null, engagementId: null, notes: 'Acknowledged on our copy of the covering letter',
  }, -20);
  io('io-4', {
    clientId: 'c-0107', direction: 'inward', date: addDays(T, -75), documentDescription: 'Donation receipt books 2025-26 (2 books)', documentType: 'Original',
    counterpartyName: 'Fr. Joseph Dsouza', handledBy: 'u-nikhil', currentLocation: 'Not traced since Nikhil Bhosale left', custodianUserId: 'u-nikhil', linkedInwardId: null,
    returned: false, returnDueDate: addDays(T, -40), taskId: null, engagementId: null, notes: 'Flagged at offboarding — custody not handed over',
  }, -75);
  io('io-5', {
    clientId: 'c-0103', direction: 'outward', date: addDays(T, -3), documentDescription: 'Signed net worth certificate (original)', documentType: 'Original',
    counterpartyName: 'Dr. Anil Deshpande', handledBy: 'u-divya', currentLocation: null, custodianUserId: null, linkedInwardId: null, returned: false,
    returnDueDate: null, taskId: null, engagementId: null, notes: 'UDIN 26118734BMKQXP2187',
  }, -3);
  audit('u-farhan', 'user', 'u-nikhil', 'User deactivated', 'Nikhil Bhosale · articleship completed · 1 inward document still in custody', -36);

  // ---------- Leave (B2) ----------
  const lastWeekStart = addDays(weekStart(T), -7);
  const dueBetween = (userId: string, a: ISODate, b: ISODate) =>
    db.tasks.filter((t) => t.assignedTo === userId && isOpen(t.status) && t.effectiveDue >= a && t.effectiveDue <= b).map((t) => t.id);
  db.leaveRequests.push(
    {
      id: 'lv-1', userId: 'u-divya', leaveType: 'full_day', reason: 'personal', note: 'Family function in Kolhapur', startDate: addDays(lastWeekStart, 4), endDate: addDays(lastWeekStart, 4),
      halfDaySession: null, days: 1, status: 'approved', appliedAt: at(-14, '10:05'), decidedBy: 'u-priya', decidedAt: at(-13, '18:10'), decisionNote: 'Approved',
      conflictTaskIds: [], reassignments: [],
    },
    {
      id: 'lv-2', userId: 'u-karan', leaveType: 'multiple_days', reason: 'personal', note: "Sister's wedding in Surat", startDate: addDays(T, 8), endDate: addDays(T, 10),
      halfDaySession: null, days: 3, status: 'pending', appliedAt: at(-1, '09:40'), decidedBy: null, decidedAt: null, decisionNote: null,
      conflictTaskIds: dueBetween('u-karan', addDays(T, 8), addDays(T, 10)), reassignments: [],
    },
    {
      id: 'lv-3', userId: 'u-ananya', leaveType: 'multiple_days', reason: 'exam_study', note: 'CS Executive exams (study leave)', startDate: addDays(T, 30), endDate: addDays(T, 38),
      halfDaySession: null, days: 8, status: 'approved', appliedAt: at(-6, '11:00'), decidedBy: 'u-meera', decidedAt: at(-5, '16:20'), decisionNote: 'All the best',
      conflictTaskIds: dueBetween('u-ananya', addDays(T, 30), addDays(T, 38)), reassignments: [],
    },
    {
      id: 'lv-4', userId: 'u-rohit', leaveType: 'full_day', reason: 'personal', note: '', startDate: addDays(T, 2), endDate: addDays(T, 2),
      halfDaySession: null, days: 1, status: 'rejected', appliedAt: at(-2, '10:15'), decidedBy: 'u-priya', decidedAt: at(-2, '13:00'),
      decisionNote: 'Stock audit fieldwork at Shree Ganesh that day — please pick another date', conflictTaskIds: [], reassignments: [],
    },
    {
      id: 'lv-5', userId: 'u-sneha', leaveType: 'half_day', reason: 'sick', note: 'Doctor appointment', startDate: addDays(T, -9), endDate: addDays(T, -9),
      halfDaySession: 'PM', days: 0.5, status: 'approved', appliedAt: at(-10, '18:00'), decidedBy: 'u-priya', decidedAt: at(-10, '19:30'), decisionNote: null,
      conflictTaskIds: [], reassignments: [],
    },
  );
  audit('u-karan', 'leave', 'lv-2', 'Leave applied', `Karan Shah · 3 days · ${db.leaveRequests[1].conflictTaskIds.length} task(s) due during the leave`, -1);
  audit('u-meera', 'leave', 'lv-3', 'Leave approved', 'Ananya Joshi · CS Executive study leave · 8 days', -5);

  // ---------- Attachments (C7) — bodies go to IndexedDB under blobKey ----------
  const att = (id: string, owner: DB['attachments'][number]['owner'], fileName: string, mimeType: string, blobKey: string, description: string, by: string, days: number) => {
    const body = DEMO_FILES[blobKey]();
    db.attachments.push({ id, owner, fileName, mimeType, sizeBytes: body.length, sha256: sha256Hex(body), blobKey, description, uploadedBy: by, uploadedAt: at(days, '14:00'), deletedAt: null });
  };
  att('att-notice-143', { entity: 'notice', id: 'notice-143-1a' }, `Intimation_143(1)(a)_${ayLabel(fyClosed).replace(' ', '')}.pdf`, 'application/pdf', 'blob-notice-143-1a', 'Copy of the intimation from CPC', 'u-divya', -10);
  att('att-networth', { entity: 'udin', id: 'udin-cert-networth' }, 'NetWorth_Certificate_Deshpande_signed.pdf', 'application/pdf', 'blob-networth-cert', 'Signed copy', 'u-divya', -3);
  att('att-asmt10', { entity: 'notice', id: 'notice-asmt10' }, 'ASMT-10_Brightpath.pdf', 'application/pdf', 'blob-asmt10', 'Notice copy from the GST portal', 'u-karan', -25);
  att('att-stock', { entity: 'task', id: h.stock.task.id }, 'Godown_stock_summary_Aug2026.csv', 'text/csv', 'blob-stock-summary', "Client's stock summary for the bank", 'u-rohit', -4);

  // ---------- In-app notification state (B7) ----------
  const sg3b = db.tasks.find((t) => t.clientId === 'c-0101' && t.complianceTypeCode === 'GSTR3B_M' && isOpen(t.status));
  db.notificationState.push(
    { id: `u-rajesh|dsc-expiry-30:dsc-01`, userId: 'u-rajesh', notificationKey: 'dsc-expiry-30:dsc-01', readAt: at(-1, '09:05'), dismissedAt: null },
    { id: `u-rajesh|udin-pending:udin-cert-turnover`, userId: 'u-rajesh', notificationKey: 'udin-pending:udin-cert-turnover', readAt: at(-2, '09:10'), dismissedAt: null },
    ...(sg3b ? [{ id: `u-sneha|due-7:${sg3b.id}`, userId: 'u-sneha', notificationKey: `due-7:${sg3b.id}`, readAt: at(-1, '10:00'), dismissedAt: at(-1, '10:01') }] : []),
  );

  // ---------- Sensitive-view access log (C5) ----------
  db.accessLog.push(
    { id: 'acc-1', at: at(-7, '18:20'), userId: 'u-farhan', entity: 'backup', entityId: null, action: 'download', detail: 'Full backup downloaded' },
    { id: 'acc-2', at: at(-3, '12:05'), userId: 'u-meera', entity: 'udin_register', entityId: null, action: 'view', detail: 'UDIN reconciliation view' },
    { id: 'acc-3', at: at(-2, '17:45'), userId: 'u-farhan', entity: 'export', entityId: null, action: 'export', detail: 'Work entries CSV, last month, all people' },
    { id: 'acc-4', at: at(-1, '09:05'), userId: 'u-rajesh', entity: 'dsc_register', entityId: 'dsc-01', action: 'view', detail: 'Opened DSC record' },
    { id: 'acc-5', at: at(-1, '11:30'), userId: 'u-priya', entity: 'notice', entityId: 'notice-143-1a', action: 'view', detail: 'Opened notice' },
    { id: 'acc-6', at: at(-1, '11:32'), userId: 'u-priya', entity: 'attachment', entityId: 'att-notice-143', action: 'download', detail: 'Downloaded notice copy' },
  );

  // ---------- Import batches (B15) ----------
  db.importBatches.push(
    {
      id: 'imp-1', kind: 'clients', fileName: 'client_master_import_jul2026.csv', uploadedBy: 'u-farhan', uploadedAt: isoAt(addDays(T, -90), '09:30'), status: 'imported',
      rowCount: 4, importedCount: 3, errorCount: 1,
      errors: [{ row: 5, field: 'gstin', message: '27AAXFB9087P1Z is 14 characters; a GSTIN has 15' }],
      createdIds: ['c-0105', 'c-0106', 'c-0107'], previewTaskCount: 41, importedAt: isoAt(addDays(T, -90), '09:42'),
    },
    {
      id: 'imp-2', kind: 'users', fileName: 'new_joiners_oct2026.csv', uploadedBy: 'u-farhan', uploadedAt: at(-4, '15:00'), status: 'validated',
      rowCount: 1, importedCount: 0, errorCount: 0, errors: [], createdIds: [], previewTaskCount: 0, importedAt: null,
    },
  );
  audit('u-farhan', 'import', 'imp-1', 'Clients imported', '3 of 4 rows imported · 1 row rejected (invalid GSTIN)', -90);
  void h.books;
  void h.rand;
}
