// Realistic, fictional seed data generated relative to today's date so the
// prototype always opens on a live-looking week.

import type {
  AckType,
  Client,
  ComplianceProfile,
  GstFrequency,
  GstRegistration,
  DB,
  Engagement,
  ISODate,
  Task,
  TaskStatus,
  User,
  WorkEntry,
  InternalCategory,
} from './types';
import { DEFAULT_COMPLIANCE_TYPES, DEFAULT_TEMPLATES, DESCRIPTION_CHIPS, isOpen } from './master';
import { applyClientSync, dueForPeriod } from './compliance';
import { addDays, ayLabel, diffDays, fyKey, fyLabel, fyStartYear, iso, pad, toDate, today, weekStart, weekday } from './dates';
import { isoAt } from './access';
import { mulberry32, uid } from './util';
import { DEFAULT_SETTINGS, GST_STATES } from './migrations/migrate_v4_to_v5.js';
import { DEMO_DIRECTORS, DEMO_PIN_HASHES, addV5DemoData } from './seedV5';

export const DB_VERSION = 5;
export const DEMO_TEMP_PIN = '2026';

const BASE_PROFILE: ComplianceProfile = {
  tds: false,
  tdsSalary: false,
  tdsNonSalary: false,
  tdsNonResident: false,
  tcs: false,
  advanceTax: false,
  taxAudit: false,
  statutoryAudit: false,
  transferPricing: false,
  pf: false,
  esi: false,
};

export function emptyProfile(): ComplianceProfile {
  return { ...BASE_PROFILE };
}

// Seed client definitions keep a v4-style GST block; it is converted to gstins[] below.
type SeedProfile = Partial<ComplianceProfile> & { gstFrequency?: GstFrequency | 'not_applicable'; gstAnnualReturn?: boolean; gst9c?: boolean };
const SEED_BASE: SeedProfile = { ...BASE_PROFILE, gstFrequency: 'not_applicable', gstAnnualReturn: false, gst9c: false };

/** Extra v5 facts per seed client: further GSTINs, TDS/TCS split, transfer pricing. */
const V5_EXTRA: Record<string, { profile?: Partial<ComplianceProfile>; extraGstins?: { gstin: string; frequency: GstFrequency; iffOpted?: boolean; gstAnnualReturn?: boolean }[]; stateCode?: string }> = {
  'c-0101': { profile: { tcs: true } }, // TCS on sale of textile scrap (206C(1))
  'c-0103': { stateCode: '27' },
  'c-0104': { stateCode: '24' },
  'c-0107': { stateCode: '27' },
  'c-0108': {
    profile: { tdsNonResident: true, transferPricing: true }, // royalty to the US parent; international transactions → Form 3CEB
    extraGstins: [{ gstin: '27AAGCV2290B1ZA', frequency: 'qrmp', iffOpted: true, gstAnnualReturn: true }], // Pune branch on QRMP
  },
  'c-0109': { stateCode: '27' },
};

export function buildSeed(T: ISODate = today()): DB {
  const rand = mulberry32(20261005);
  const pick = <X,>(xs: X[]) => xs[Math.floor(rand() * xs.length)];
  const between = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
  const SYSTEM = 'u-farhan';
  const seedTime = isoAt(addDays(T, -90), '10:00');

  const usersV4 = [
    { id: 'u-rajesh', employeeCode: 'QX-P01', name: 'CA Rajesh Iyer', role: 'partner', designation: 'Partner', defaultLocation: 'office', locationOverrideAllowed: true, joiningDate: '2009-04-01' },
    { id: 'u-meera', employeeCode: 'QX-P02', name: 'CA Meera Kulkarni', role: 'partner', designation: 'Partner', defaultLocation: 'office', locationOverrideAllowed: true, joiningDate: '2012-06-01' },
    { id: 'u-priya', employeeCode: 'QX-M11', name: 'Priya Nair', role: 'manager', designation: 'Manager (CA)', defaultLocation: 'office', locationOverrideAllowed: true, joiningDate: '2017-07-10' },
    { id: 'u-arjun', employeeCode: 'QX-M12', name: 'Arjun Mehta', role: 'manager', designation: 'Manager (CS)', defaultLocation: 'office', locationOverrideAllowed: true, joiningDate: '2019-01-14' },
    { id: 'u-sneha', employeeCode: 'QX-S21', name: 'Sneha Patil', role: 'staff', designation: 'Senior', isSenior: true, defaultLocation: 'office', locationOverrideAllowed: true, joiningDate: '2021-08-02' },
    { id: 'u-karan', employeeCode: 'QX-S22', name: 'Karan Shah', role: 'staff', designation: 'Staff', defaultLocation: 'office', locationOverrideAllowed: true, joiningDate: '2023-05-15' },
    { id: 'u-divya', employeeCode: 'QX-S23', name: 'Divya Rao', role: 'staff', designation: 'Staff', defaultLocation: 'wfh', locationOverrideAllowed: true, joiningDate: '2024-02-01' },
    { id: 'u-rohit', employeeCode: 'QX-A31', name: 'Rohit Verma', role: 'article', designation: 'CA Article Assistant', defaultLocation: 'office', locationOverrideAllowed: true, joiningDate: '2025-01-06', principalPartnerId: 'u-rajesh' },
    { id: 'u-ananya', employeeCode: 'QX-A32', name: 'Ananya Joshi', role: 'article', designation: 'CS Trainee', defaultLocation: 'office', locationOverrideAllowed: false, joiningDate: '2025-07-01', principalPartnerId: 'u-meera' },
    { id: 'u-aditya', employeeCode: 'QX-A33', name: 'Aditya Kumar', role: 'article', designation: 'CA Article Assistant (new)', defaultLocation: 'office', locationOverrideAllowed: true, joiningDate: addDays(T, -3), principalPartnerId: 'u-rajesh' },
    { id: 'u-farhan', employeeCode: 'QX-AD41', name: 'Farhan Sheikh', role: 'admin', designation: 'Practice Admin', defaultLocation: 'office', locationOverrideAllowed: true, joiningDate: '2018-03-01' },
    // offboarded at the end of articleship — kept so history stays attributed (B1)
    { id: 'u-nikhil', employeeCode: 'QX-A29', name: 'Nikhil Bhosale', role: 'article', designation: 'CA Article Assistant (completed)', defaultLocation: 'office', locationOverrideAllowed: true, joiningDate: '2023-08-01', principalPartnerId: 'u-meera' },
  ] as Omit<User, 'active' | 'deactivatedOn' | 'deactivatedBy' | 'deactivationNote' | 'auth'>[];
  const users: User[] = usersV4.map((u) => {
    const pin = DEMO_PIN_HASHES[u.id];
    const offboarded = u.id === 'u-nikhil';
    return {
      ...u,
      email: `${u.name.replace(/^CA /, '').toLowerCase().replace(/[^a-z ]/g, '').trim().replace(/ +/g, '.')}@qepexindia.example`,
      active: !offboarded,
      deactivatedOn: offboarded ? addDays(T, -36) : null,
      deactivatedBy: offboarded ? SYSTEM : null,
      deactivationNote: offboarded ? 'Articleship completed. Inward register shows one client file still in his custody.' : null,
      auth: {
        credentialKind: 'pin',
        passwordHash: pin && !offboarded ? pin[1] : null,
        passwordSalt: pin && !offboarded ? pin[0] : null,
        hashIterations: 210000,
        mustChangePassword: true,
        tempPinIssuedAt: pin && !offboarded ? seedTime : null,
        tempPinIssuedBy: pin && !offboarded ? SYSTEM : null,
        failedAttempts: 0,
        lockedUntil: null,
        lastLoginAt: null,
        totpSecret: null,
        totpEnrolledAt: null,
      },
    };
  });

  const lastAgmYear = fyStartYear(T); // AGM for the FY just closed falls in Sep of this year
  type ClientSeed = Omit<Client, 'id' | 'flagHistory' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy' | 'fyEnd' | 'status' | 'gstins' | 'profile' | 'directors' | 'complianceStartDates' | 'statusEffectiveFrom' | 'auditorAppointmentDate'> & {
    id: string;
    profile: SeedProfile;
    gstins?: string[];
    status?: Client['status'];
    team: [string, 'staff' | 'reviewer'][];
  };
  const clientSeeds: ClientSeed[] = [
    {
      id: 'c-0101', code: 'CL-0101', name: 'Shree Ganesh Textiles Pvt Ltd', group: 'Agarwal Group', constitution: 'private_company',
      pan: 'AAKCS4821F', tan: 'PNES12345B', gstins: ['27AAKCS4821F1Z5'], cin: 'U17110MH2012PTC234567', udyam: 'UDYAM-MH-26-0012345',
      agmDate: iso(lastAgmYear, 9, 26), booksBy: 'firm', partnerId: 'u-rajesh', managerId: 'u-priya',
      contactName: 'Mahesh Agarwal (Director)', contactPhone: '+91 98220 41567', contactEmail: 'accounts@shreeganeshtex.example',
      profile: { ...SEED_BASE, gstFrequency: 'monthly', gstAnnualReturn: true, gst9c: true, tds: true, advanceTax: true, taxAudit: true, statutoryAudit: true, pf: true, esi: true },
      team: [['u-sneha', 'staff'], ['u-rohit', 'staff']],
    },
    {
      id: 'c-0102', code: 'CL-0102', name: 'Deshmukh & Sons', group: 'Deshmukh Family', constitution: 'partnership_firm',
      pan: 'AAFFD7310K', tan: 'PNED04567C', gstins: ['27AAFFD7310K1ZQ'], booksBy: 'client', partnerId: 'u-rajesh', managerId: 'u-priya',
      contactName: 'Vikas Deshmukh (Partner)', contactPhone: '+91 98500 22314', contactEmail: 'vikas@deshmukhsons.example',
      profile: { ...SEED_BASE, gstFrequency: 'qrmp', gstAnnualReturn: true, tds: true, advanceTax: true, taxAudit: true },
      team: [['u-karan', 'staff'], ['u-rohit', 'staff']],
    },
    {
      id: 'c-0103', code: 'CL-0103', name: 'Dr. Anil Deshpande', group: 'Deshpande Family', constitution: 'individual',
      pan: 'BXQPD5512M', booksBy: 'client', partnerId: 'u-meera', managerId: 'u-priya',
      contactName: 'Dr. Anil Deshpande', contactPhone: '+91 99230 18842', contactEmail: 'anil.deshpande@clinic.example',
      profile: { ...SEED_BASE, advanceTax: true },
      team: [['u-divya', 'staff']],
    },
    {
      id: 'c-0104', code: 'CL-0104', name: 'Rameshbhai Patel HUF', group: 'Patel Family', constitution: 'huf',
      pan: 'AAJHP6623L', booksBy: 'client', partnerId: 'u-meera', managerId: 'u-priya',
      contactName: 'Rameshbhai Patel (Karta)', contactPhone: '+91 98250 77310',
      profile: { ...BASE_PROFILE },
      team: [['u-divya', 'staff']],
    },
    {
      id: 'c-0105', code: 'CL-0105', name: 'Brightpath Logistics LLP', constitution: 'llp',
      pan: 'AAXFB9087P', tan: 'MUMB21345D', gstins: ['27AAXFB9087P1Z2'], cin: 'AAQ-4512', booksBy: 'firm', partnerId: 'u-meera', managerId: 'u-arjun',
      contactName: 'Neha Fernandes (Designated Partner)', contactPhone: '+91 99670 55128', contactEmail: 'finance@brightpath.example',
      profile: { ...SEED_BASE, gstFrequency: 'monthly', gstAnnualReturn: true, tds: true, advanceTax: true, taxAudit: true, pf: true },
      team: [['u-karan', 'staff'], ['u-ananya', 'staff']],
    },
    {
      id: 'c-0106', code: 'CL-0106', name: 'Nirmal Foods', group: 'Nirmal Family', constitution: 'proprietorship',
      pan: 'ACNPN4410H', gstins: ['27ACNPN4410H1ZK'], udyam: 'UDYAM-MH-26-0098761', booksBy: 'firm', partnerId: 'u-rajesh', managerId: 'u-priya',
      contactName: 'Suresh Nirmal (Proprietor)', contactPhone: '+91 97640 30019',
      profile: { ...SEED_BASE, gstFrequency: 'composition' },
      team: [['u-rohit', 'staff'], ['u-divya', 'staff']],
    },
    {
      id: 'c-0107', code: 'CL-0107', name: 'Aarohan Education Trust', constitution: 'trust',
      pan: 'AABTA3341R', tan: 'PNEA07788E', booksBy: 'client', partnerId: 'u-meera', managerId: 'u-priya',
      contactName: 'Fr. Joseph Dsouza (Trustee)', contactPhone: '+91 98221 60453', contactEmail: 'office@aarohantrust.example',
      profile: { ...SEED_BASE, tds: true, statutoryAudit: true, pf: true },
      team: [['u-sneha', 'staff']],
    },
    {
      id: 'c-0108', code: 'CL-0108', name: 'Vistara Softech Pvt Ltd', constitution: 'private_company',
      pan: 'AAGCV2290B', tan: 'BLRV09876A', gstins: ['29AAGCV2290B1Z8'], cin: 'U72900KA2019PTC123456',
      agmDate: iso(lastAgmYear, 9, 29), booksBy: 'firm', partnerId: 'u-rajesh', managerId: 'u-arjun',
      contactName: 'Kavya Rao (CFO)', contactPhone: '+91 98450 11276', contactEmail: 'kavya@vistarasoftech.example',
      profile: { ...SEED_BASE, gstFrequency: 'monthly', gstAnnualReturn: true, tds: true, advanceTax: true, statutoryAudit: true, pf: true },
      team: [['u-sneha', 'staff'], ['u-ananya', 'staff'], ['u-karan', 'staff']],
    },
    {
      id: 'c-0109', code: 'CL-0109', name: 'Konkan Agro Exports Ltd', constitution: 'public_company', status: 'dormant',
      pan: 'AACCK5120Q', cin: 'L01100MH2004PLC145872', booksBy: 'client', partnerId: 'u-rajesh', managerId: 'u-arjun',
      contactName: 'S. Sawant (Company Secretary)', contactPhone: '+91 90040 88213',
      profile: { ...BASE_PROFILE },
      team: [],
    },
  ];

  const db: DB = {
    version: DB_VERSION,
    seededOn: T,
    meta: { schemaVersion: DB_VERSION, migrationsApplied: [] },
    settings: { ...DEFAULT_SETTINGS },
    leaveRequests: [],
    udinRegister: [],
    dscRegister: [],
    dscMovements: [],
    notices: [],
    inwardOutward: [],
    notificationState: [],
    accessLog: [],
    attachments: [],
    importBatches: [],
    users,
    clients: [],
    clientTeam: [],
    complianceTypes: structuredClone(DEFAULT_COMPLIANCE_TYPES),
    templates: structuredClone(DEFAULT_TEMPLATES),
    engagements: [],
    tasks: [],
    entries: [],
    extensions: [],
    lockSettings: { dayOffset: 6, time: '16:00' },
    lockExtensions: [],
    audit: [],
  };

  const gstReg = (gstin: string, frequency: GstFrequency, annual: boolean, nineC: boolean, iff = false): GstRegistration => ({
    id: `gst-${gstin}`,
    gstin,
    stateCode: gstin.slice(0, 2),
    state: (GST_STATES as Record<string, string>)[gstin.slice(0, 2)] ?? 'Unknown',
    frequency,
    effectiveFrom: '2024-04-01',
    frequencyHistory: [{ frequency, effectiveFrom: '2024-04-01', changedBy: SYSTEM, changedAt: seedTime }],
    gstAnnualReturn: annual,
    gst9c: nineC,
    iffOpted: iff,
    status: 'active',
    cancelledOn: null,
  });
  for (const s of clientSeeds) {
    const { team, profile: sp, ...rest } = s;
    const extra = V5_EXTRA[s.id] ?? {};
    const { gstFrequency, gstAnnualReturn, gst9c, ...flags } = sp;
    const profile: ComplianceProfile = { ...BASE_PROFILE, ...flags, ...extra.profile };
    if (profile.tds) {
      profile.tdsSalary = true;
      profile.tdsNonSalary = true;
    }
    const gstins = (s.gstins ?? []).map((g) => gstReg(g, gstFrequency === 'not_applicable' || !gstFrequency ? 'not_set' : gstFrequency, !!gstAnnualReturn, !!gst9c));
    for (const g of extra.extraGstins ?? []) gstins.push(gstReg(g.gstin, g.frequency, !!g.gstAnnualReturn, false, g.iffOpted));
    const isCompany = s.constitution === 'private_company' || s.constitution === 'public_company';
    db.clients.push({
      ...rest,
      profile,
      gstins,
      stateCode: extra.stateCode ?? gstins[0]?.stateCode,
      directors: DEMO_DIRECTORS[s.id] ?? [],
      auditorAppointmentDate: isCompany && s.agmDate ? s.agmDate : null,
      complianceStartDates: {},
      statusEffectiveFrom: s.status === 'dormant' ? '2025-04-01' : null,
      status: s.status ?? 'active',
      fyEnd: '31 Mar',
      flagHistory: [],
      createdAt: seedTime,
      createdBy: SYSTEM,
      updatedAt: seedTime,
      updatedBy: SYSTEM,
    });
    for (const [userId, role] of team) db.clientTeam.push({ clientId: s.id, userId, role });
  }

  // A published CBDT extension of the tax audit report (illustrative), so extension history is visible.
  const fyClosed = fyStartYear(T) - 1;
  const tarExt = {
    id: uid(),
    complianceTypeCode: 'TAR',
    periodKeys: [fyKey(fyClosed)],
    newDueDate: iso(fyClosed + 1, 10, 31),
    reference: `CBDT Circular No. 14/${fyClosed + 1} (illustrative)`,
    reason: 'Extension of due date for audit reports under section 44AB',
    publishedAt: isoAt(addDays(T, -12), '18:30'),
    publishedBy: SYSTEM,
    tasksMoved: 0,
    status: 'published' as const,
    supersedesId: null,
  };
  db.extensions.push(tarExt);

  // Generate the compliance calendar for every client from ~11 weeks back
  const windowStart = addDays(T, -80);
  for (const c of db.clients) applyClientSync(db, c.id, SYSTEM, '', windowStart);
  tarExt.tasksMoved = db.tasks.filter((t) => t.complianceTypeCode === 'TAR').length;

  const tpl = (code: string) => db.templates.find((t) => t.code === code)!;
  const filingIdx = (t: Task) => tpl(t.templateCode).filingStageIndex ?? tpl(t.templateCode).stages.length - 1;

  const ackFor = (type: AckType, date: ISODate, client: Client): string => {
    const d = toDate(date);
    const n = (len: number) => Array.from({ length: len }, () => between(0, 9)).join('');
    switch (type) {
      case 'arn':
        return `AA${client.gstins[0]?.stateCode ?? '27'}${pad(d.getMonth() + 1)}${String(d.getFullYear()).slice(2)}${n(6)}${pick(['K', 'M', 'R', 'T', 'X'])}`;
      case 'challan':
        return `0510308 / ${pad(d.getDate())}${pad(d.getMonth() + 1)}${d.getFullYear()} / ${n(5)}`;
      case 'token':
      case 'itr_ack':
        return n(15);
      case 'srn':
        return `F${n(8)}`;
      case 'udin':
        return `${String(d.getFullYear()).slice(2)}1${n(5)}B${pick(['KC', 'LM', 'QR', 'XT'])}${pick(['DA', 'FE', 'GH'])}${n(4)}`;
      default:
        return `ACK-${n(8)}`;
    }
  };

  const fileTask = (t: Task, ackDate: ISODate, by: string) => {
    const client = db.clients.find((c) => c.id === t.clientId)!;
    const template = tpl(t.templateCode);
    t.ack = { type: template.ackType ?? 'other', number: ackFor(template.ackType ?? 'other', ackDate, client), date: ackDate };
    t.stageIndex = template.filingStageIndex ?? template.stages.length - 1;
    const status: TaskStatus = ackDate <= t.effectiveDue ? 'filed' : 'filed_late';
    t.statusHistory.push(
      { at: isoAt(addDays(ackDate, -6), '11:00'), by, from: 'upcoming', to: 'in_progress' },
      { at: isoAt(ackDate, '17:15'), by, from: 'in_progress', to: status, note: `${template.ackType?.toUpperCase()} recorded` },
    );
    t.status = status;
    t.checklist.forEach((c) => {
      c.status = 'received';
      c.dateRequested = addDays(t.effectiveDue, -18);
      c.dateReceived = addDays(t.effectiveDue, -between(8, 13));
    });
  };

  const reset = (t: Task) => {
    t.status = 'upcoming';
    t.ack = undefined;
    t.stageIndex = 0;
    t.statusHistory = t.statusHistory.slice(0, 1);
    t.checklist.forEach((c) => {
      c.status = 'not_requested';
      c.dateRequested = c.dateReceived = undefined;
    });
  };

  const setStatus = (t: Task, status: TaskStatus, stage: number, by: string, at: ISODate, note?: string) => {
    if (t.status !== status) t.statusHistory.push({ at: isoAt(at, '12:00'), by, from: t.status, to: status, note });
    t.status = status;
    t.stageIndex = Math.max(t.stageIndex, stage);
  };

  const find = (clientId: string, code: string, near: ISODate, direction: 'after' | 'before') => {
    const list = db.tasks
      .filter((t) => t.clientId === clientId && t.complianceTypeCode === code)
      .filter((t) => (direction === 'after' ? t.effectiveDue >= near : t.effectiveDue < near))
      .sort((a, b) => (direction === 'after' ? a.effectiveDue.localeCompare(b.effectiveDue) : b.effectiveDue.localeCompare(a.effectiveDue)));
    return list[0];
  };

  // Default statuses from how far the due date is from today
  for (const t of db.tasks) {
    const d = diffDays(t.effectiveDue, T);
    const by = t.assignedTo ?? SYSTEM;
    if (d < 0) {
      const ackDate = addDays(t.effectiveDue, -between(0, 3));
      if (weekday(ackDate) === 0) fileTask(t, addDays(ackDate, -1), by);
      else fileTask(t, ackDate, by);
    } else if (d <= 7) {
      setStatus(t, 'in_progress', between(1, 2), by, addDays(T, -between(2, 6)));
    } else if (d <= 25 && rand() < 0.5) {
      setStatus(t, 'in_progress', 1, by, addDays(T, -between(1, 4)));
    }
  }

  const followUp = (t: Task, daysAgo: number, by: string, channel: 'call' | 'email' | 'whatsapp' | 'other', notes: string) =>
    t.followUps.push({ id: uid(), at: addDays(T, -daysAgo), by, channel, notes });

  const request = (t: Task, names: string[], daysAgo: number) => {
    for (const name of names) {
      let item = t.checklist.find((c) => c.name === name);
      if (!item) {
        item = { id: uid(), name, status: 'requested' };
        t.checklist.push(item);
      }
      item.status = 'requested';
      item.dateRequested = addDays(T, -daysAgo);
    }
  };
  const receive = (t: Task, names: string[], daysAgo: number) => {
    for (const name of names) {
      const item = t.checklist.find((c) => c.name === name);
      if (item) {
        item.status = 'received';
        item.dateRequested ??= addDays(T, -daysAgo - 4);
        item.dateReceived = addDays(T, -daysAgo);
      }
    }
  };

  // ---- Specific, story-telling task states ----
  // Deshmukh & Sons: GSTR-1 (QRMP) waiting on the sales register
  const ds1 = find('c-0102', 'GSTR1_Q', T, 'after');
  if (ds1) {
    setStatus(ds1, 'pending_from_client', 1, 'u-karan', addDays(T, -5), 'Sales register for the quarter not received');
    ds1.pendingPeriods.push({ from: isoAt(addDays(T, -5), '12:00'), what: 'Sales register and credit notes for the quarter' });
    request(ds1, ['Sales register', 'Purchase register', 'Credit / debit notes'], 8);
    receive(ds1, ['Purchase register'], 4);
    followUp(ds1, 6, 'u-karan', 'call', 'Spoke to Vikas — sales register promised by Friday');
    followUp(ds1, 3, 'u-karan', 'whatsapp', 'Sent reminder with the list of pending documents');
  }
  // Vistara Softech: DIR-3 KYC overdue, director has not completed OTP verification
  const vk = db.tasks.find((t) => t.clientId === 'c-0108' && t.complianceTypeCode === 'DIR3' && t.directorId === 'dir-vs-1' && t.effectiveDue < T) ?? find('c-0108', 'DIR3', T, 'before');
  if (vk) {
    reset(vk);
    vk.checklist = [
      { id: uid(), name: "Director's PAN & Aadhaar", status: 'received', dateRequested: addDays(T, -24), dateReceived: addDays(T, -20) },
      { id: uid(), name: 'Mobile & email OTP verification', status: 'requested', dateRequested: addDays(T, -18) },
      { id: uid(), name: 'Passport-size photograph', status: 'requested', dateRequested: addDays(T, -18) },
    ];
    setStatus(vk, 'in_progress', 2, 'u-ananya', addDays(T, -20));
    setStatus(vk, 'pending_from_client', 2, 'u-ananya', addDays(T, -17), 'Waiting on director for OTP verification');
    vk.pendingPeriods.push({ from: isoAt(addDays(T, -17), '15:00'), what: 'Director OTP verification and photograph (Mr. Suresh Rao)' });
    followUp(vk, 15, 'u-ananya', 'email', 'Emailed Kavya with the KYC steps for the director');
    followUp(vk, 9, 'u-ananya', 'call', 'Director travelling — will complete OTP next week');
    followUp(vk, 2, 'u-arjun', 'whatsapp', 'Escalated to CFO: late fee of ₹5,000 applies after due date');
  }
  // Aarohan Trust: TDS payment waiting on the salary register
  const at = find('c-0107', 'TDS_PAY', T, 'after');
  if (at) {
    reset(at);
    setStatus(at, 'pending_from_client', 0, 'u-sneha', addDays(T, -3), 'Salary register awaited');
    at.pendingPeriods.push({ from: isoAt(addDays(T, -3), '11:30'), what: 'Salary register for last month' });
    request(at, ['Payment / salary register'], 4);
    followUp(at, 1, 'u-sneha', 'email', 'Reminder to the trust office with the challan due date');
  }
  // Brightpath: GSTR-1 prepared, waiting for the Manager's review
  const bp = find('c-0105', 'GSTR1_M', T, 'after');
  if (bp) {
    setStatus(bp, 'in_progress', 3, 'u-karan', addDays(T, -3));
    // first review round returned with two points, both cleared before resubmission (A13)
    bp.reviewPoints = [
      { id: uid(), text: 'B2B invoices to SEZ units are shown as regular supplies — move to SEZ with payment', raisedBy: 'u-arjun', raisedAt: isoAt(addDays(T, -2), '15:10'), clearedBy: 'u-karan', clearedAt: isoAt(addDays(T, -1), '12:30') },
      { id: uid(), text: 'Credit note CN-118 missing from table 9B', raisedBy: 'u-arjun', raisedAt: isoAt(addDays(T, -2), '15:12'), clearedBy: 'u-karan', clearedAt: isoAt(addDays(T, -1), '12:45') },
    ];
    setStatus(bp, 'under_review', 3, 'u-karan', addDays(T, -1), 'Submitted for review');
    bp.review = { submittedBy: 'u-karan', submittedAt: isoAt(addDays(T, -1), '16:40'), checkerId: 'u-arjun', decision: null, decidedAt: null };
    bp.checkerId = 'u-arjun';
    receive(bp, ['Sales register', 'Credit / debit notes', 'E-way bill summary'], 4);
  }
  // Shree Ganesh: GSTR-3B mid-reconciliation; AOC-4 started; TDS payment already done
  const sg3b = find('c-0101', 'GSTR3B_M', T, 'after');
  if (sg3b) {
    setStatus(sg3b, 'in_progress', 2, 'u-sneha', addDays(T, -2));
    receive(sg3b, ['Sales register', 'Purchase register', 'Bank statement'], 2);
  }
  const sgAoc = find('c-0101', 'AOC4', T, 'after');
  if (sgAoc) setStatus(sgAoc, 'in_progress', 1, 'u-sneha', addDays(T, -6));
  const sgTds = find('c-0101', 'TDS_PAY', T, 'after');
  if (sgTds && diffDays(sgTds.effectiveDue, T) <= 7) fileTask(sgTds, addDays(T, -2 - (weekday(addDays(T, -2)) === 0 ? 1 : 0)), 'u-sneha');
  // Deshmukh & Sons: tax audit (on extended date), had a client wait earlier
  const dsTar = db.tasks.find((t) => t.clientId === 'c-0102' && t.complianceTypeCode === 'TAR' && t.periodKey === fyKey(fyClosed));
  if (dsTar) {
    reset(dsTar);
    setStatus(dsTar, 'in_progress', 2, 'u-karan', addDays(T, -32));
    dsTar.pendingPeriods.push({ from: isoAt(addDays(T, -30), '10:00'), to: isoAt(addDays(T, -21), '16:00'), what: 'Stock statements and bank confirmations' });
    request(dsTar, ['Trial balance', 'General ledger', 'Bank statements & confirmations', 'Stock statements'], 30);
    receive(dsTar, ['Trial balance', 'General ledger', 'Bank statements & confirmations', 'Stock statements'], 21);
    followUp(dsTar, 27, 'u-karan', 'call', 'Requested stock statements again');
    followUp(dsTar, 23, 'u-priya', 'email', 'Formal reminder from Manager');
  }
  const bpTar = db.tasks.find((t) => t.clientId === 'c-0105' && t.complianceTypeCode === 'TAR' && t.periodKey === fyKey(fyClosed));
  if (bpTar) {
    reset(bpTar);
    setStatus(bpTar, 'in_progress', 1, 'u-karan', addDays(T, -12));
  }
  const sgTar = db.tasks.find((t) => t.clientId === 'c-0101' && t.complianceTypeCode === 'TAR' && t.periodKey === fyKey(fyClosed));
  const sgTarDate = iso(fyClosed + 1, 9, 26);
  if (sgTar && sgTarDate < T) {
    // filed before the original 30 Sep date, ahead of the extension
    reset(sgTar);
    fileTask(sgTar, sgTarDate, 'u-sneha');
  }
  // Aarohan Trust: statutory audit report overdue and with the Partner
  const atAudit = db.tasks.find((t) => t.clientId === 'c-0107' && t.complianceTypeCode === 'STAT_AUDIT' && t.periodKey === fyKey(fyClosed));
  if (atAudit) {
    reset(atAudit);
    setStatus(atAudit, 'in_progress', 4, 'u-sneha', addDays(T, -40));
    setStatus(atAudit, 'under_review', 5, 'u-priya', addDays(T, -4), 'Sent for Partner review');
    atAudit.review = { submittedBy: 'u-priya', submittedAt: isoAt(addDays(T, -4), '12:00'), checkerId: 'u-meera', decision: null, decidedAt: null };
    atAudit.reviewPoints = [
      { id: uid(), text: 'Obtain trustee confirmation for corpus donations above ₹1 lakh', raisedBy: 'u-meera', raisedAt: isoAt(addDays(T, -1), '18:05'), clearedBy: null, clearedAt: null },
    ];
    atAudit.checkerId = 'u-meera';
  }
  // Nirmal Foods: an older CMP-08 that was filed late
  const nf = db.tasks
    .filter((t) => t.clientId === 'c-0106' && t.complianceTypeCode === 'CMP08' && t.effectiveDue < addDays(T, -30))
    .sort((a, b) => a.effectiveDue.localeCompare(b.effectiveDue))[0];
  if (nf) {
    reset(nf);
    nf.pendingPeriods.push({ from: isoAt(addDays(nf.effectiveDue, -9), '11:00'), to: isoAt(addDays(nf.effectiveDue, 3), '13:00'), what: 'Purchase bills for the quarter' });
    fileTask(nf, addDays(nf.effectiveDue, 4), 'u-rohit');
  }
  // Dr. Deshpande: ITR filed late because of an AIS mismatch on the client's side
  const dITR = db.tasks.find((t) => t.clientId === 'c-0103' && t.complianceTypeCode === 'ITR_NA');
  if (dITR) {
    reset(dITR);
    dITR.pendingPeriods.push({ from: isoAt(addDays(dITR.effectiveDue, -12), '10:00'), to: isoAt(addDays(dITR.effectiveDue, 1), '18:00'), what: 'Clarification on AIS interest mismatch' });
    fileTask(dITR, addDays(dITR.effectiveDue, 2), 'u-divya');
    dITR.stageIndex = 6;
  }

  // ---- One-time engagements ----
  const oneTime = (e: Omit<Engagement, 'id' | 'createdAt' | 'createdBy' | 'status' | 'type' | 'feeBasis'> & { feeBasis?: Engagement['feeBasis'] }, stage: number, status: TaskStatus) => {
    const eng: Engagement = { feeBasis: null, ...e, id: uid(), type: 'one_time', status: 'active', createdAt: isoAt(e.startDate!, '10:00'), createdBy: e.managerId ?? SYSTEM };
    db.engagements.push(eng);
    const template = tpl(e.templateCode);
    const task: Task = {
      id: uid(),
      clientId: e.clientId,
      engagementId: eng.id,
      kind: 'engagement',
      periodLabel: e.financialYear ?? '',
      title: e.title,
      templateCode: e.templateCode,
      templateVersion: template.version,
      gstinId: null,
      directorId: null,
      signoff: null,
      review: null,
      reviewPoints: [],
      supersededByTaskId: null,
      originalDue: e.endDate!,
      effectiveDue: e.endDate!,
      status: 'upcoming',
      stageIndex: 0,
      pendingPeriods: [],
      assignedTo: e.team.find((m) => m.role === 'maker')?.userId,
      checkerId: e.team.find((m) => m.role === 'checker')?.userId,
      budgetHours: e.budgetHours,
      checklist: template.checklist.map((name) => ({ id: uid(), name, status: 'not_requested' as const })),
      followUps: [],
      statusHistory: [{ at: eng.createdAt, by: eng.createdBy, from: null, to: 'upcoming', note: 'Engagement created' }],
      dueHistory: [],
      createdAt: eng.createdAt,
      updatedAt: eng.createdAt,
      updatedBy: eng.createdBy,
    };
    if (status !== 'upcoming') setStatus(task, status, stage, task.assignedTo ?? SYSTEM, addDays(T, -8));
    db.tasks.push(task);
    return { eng, task };
  };

  const notice = oneTime(
    {
      clientId: 'c-0103', serviceLine: 'direct_tax', title: `Intimation u/s 143(1)(a) — ${ayLabel(fyClosed)}`,
      financialYear: fyLabel(fyClosed), templateCode: 'notice', partnerId: 'u-meera', managerId: 'u-priya',
      team: [{ userId: 'u-divya', role: 'maker' }, { userId: 'u-priya', role: 'checker' }], budgetHours: 6, billable: true,
      feeBasis: { type: 'fixed', amount: 7500, rate: null, retainerPeriod: null },
      startDate: addDays(T, -10), endDate: addDays(T, 7),
    },
    2,
    'in_progress',
  );
  request(notice.task, ['Notice copy', 'Relevant returns'], 9);
  receive(notice.task, ['Notice copy', 'Relevant returns'], 8);

  const q2 = fyStartYear(T);
  const books = oneTime(
    {
      clientId: 'c-0108', serviceLine: 'accounting', title: `Bookkeeping & MIS — Q2 ${fyLabel(q2)}`, financialYear: fyLabel(q2),
      templateCode: 'bookkeeping', partnerId: 'u-rajesh', managerId: 'u-arjun',
      team: [{ userId: 'u-sneha', role: 'maker' }, { userId: 'u-karan', role: 'maker' }, { userId: 'u-arjun', role: 'checker' }],
      budgetHours: 40, billable: true, startDate: addDays(T, -20), endDate: addDays(T, 10),
      feeBasis: { type: 'recurring', amount: 18000, rate: null, retainerPeriod: 'quarterly' },
    },
    2,
    'in_progress',
  );
  receive(books.task, ['Bank statements', 'Sales invoices'], 15);
  request(books.task, ['Purchase bills', 'Expense vouchers'], 15);
  receive(books.task, ['Purchase bills'], 10);

  const stock = oneTime(
    {
      clientId: 'c-0101', serviceLine: 'audit', title: `Stock audit for lender bank — ${fyLabel(fyClosed)}`, financialYear: fyLabel(fyClosed),
      templateCode: 'audit', partnerId: 'u-rajesh', managerId: 'u-priya',
      team: [{ userId: 'u-sneha', role: 'maker' }, { userId: 'u-rohit', role: 'maker' }, { userId: 'u-priya', role: 'checker' }],
      budgetHours: 16, billable: true, startDate: addDays(T, -4), endDate: addDays(T, 21),
      feeBasis: { type: 'time', amount: null, rate: 2500, retainerPeriod: null },
    },
    0,
    'in_progress',
  );

  // ---- Work entries ----
  const entries: WorkEntry[] = [];
  const start = addDays(weekStart(T), -14);
  const lastWeekStart = addDays(weekStart(T), -7);
  const skip = new Set([`u-karan|${addDays(lastWeekStart, 3)}`]); // Karan forgot to log last Thursday
  const leaveDays = new Set([`u-divya|${addDays(lastWeekStart, 4)}`]); // Divya on leave last Friday
  const dayHours = new Map<string, number>();
  const taskUsed = new Map<string, number>();
  const addEntry = (e: Omit<WorkEntry, 'id' | 'createdAt' | 'updatedAt' | 'modifiedBy' | 'location'> & { location?: WorkEntry['location'] }) => {
    const user = users.find((u) => u.id === e.userId)!;
    const key = `${e.userId}|${e.date}`;
    if ((dayHours.get(key) ?? 0) + e.hours > 11) return;
    dayHours.set(key, (dayHours.get(key) ?? 0) + e.hours);
    if (e.taskId) taskUsed.set(e.taskId, (taskUsed.get(e.taskId) ?? 0) + e.hours);
    const at = isoAt(e.date, `${between(17, 19)}:${pick(['05', '20', '35', '50'])}`);
    entries.push({ ...e, id: uid(), location: e.location ?? user.defaultLocation, createdAt: at, updatedAt: at, modifiedBy: e.userId });
  };
  const stageName = (t: Task, idx: number) => tpl(t.templateCode).stages[Math.min(idx, tpl(t.templateCode).stages.length - 1)];
  const workingDays: ISODate[] = [];
  for (let d = start; d < T; d = addDays(d, 1)) if (weekday(d) !== 0) workingDays.push(d);

  // 1) Filing entries on the day each filed task was filed
  for (const t of db.tasks) {
    if (!t.ack || t.ack.date < start || t.ack.date >= T || weekday(t.ack.date) === 0) continue;
    const by = t.assignedTo;
    if (!by || skip.has(`${by}|${t.ack.date}`) || leaveDays.has(`${by}|${t.ack.date}`)) continue;
    const template = tpl(t.templateCode);
    addEntry({
      userId: by, date: t.ack.date, clientId: t.clientId, engagementId: t.engagementId, taskId: t.id,
      stage: stageName(t, filingIdx(t)), hours: pick([0.75, 1, 1.25, 1.5]), description: 'Portal filing',
      outcome: `${t.title.split(' · ')[0]} filed — ${template.ackType === 'udin' ? 'UDIN' : (template.ackType ?? '').toUpperCase()} ${t.ack.number}`,
    });
  }
  // 2) Planned one-time engagement work
  const recurringBooks = workingDays.filter((d) => d >= addDays(T, -20));
  for (const d of recurringBooks.slice(-7, -1)) {
    addEntry({ userId: 'u-sneha', date: d, clientId: 'c-0108', engagementId: books.eng.id, taskId: books.task.id, stage: 'Entry', hours: 3, description: 'Data entry' });
    addEntry({ userId: 'u-karan', date: d, clientId: 'c-0108', engagementId: books.eng.id, taskId: books.task.id, stage: d > addDays(T, -4) ? 'Bank Reconciliation' : 'Entry', hours: 2.5, description: d > addDays(T, -4) ? 'Reconciliation' : 'Data entry' });
  }
  for (const [i, d] of workingDays.filter((x) => x >= addDays(T, -9)).slice(0, 4).entries()) {
    addEntry({ userId: 'u-divya', date: d, clientId: 'c-0103', engagementId: notice.eng.id, taskId: notice.task.id, stage: stageName(notice.task, Math.min(i, 2)), hours: [1.5, 2, 2, 1.5][i], description: ['Query resolution', 'Computation', 'Reconciliation', 'Drafting reply'][i] });
  }
  addEntry({ userId: 'u-priya', date: workingDays[workingDays.length - 2], clientId: 'c-0103', engagementId: notice.eng.id, taskId: notice.task.id, stage: 'Analysis', hours: 1, description: 'Client call' });
  for (const d of workingDays.slice(-3)) {
    addEntry({ userId: 'u-rohit', date: d, clientId: 'c-0101', engagementId: stock.eng.id, taskId: stock.task.id, stage: 'Planning', hours: 1.5, description: 'Vouching', location: 'client_site', clientSiteClientId: 'c-0101' });
  }
  // 3) Day-to-day compliance work, filling each person's day
  const target: Record<User['role'], [number, number]> = { staff: [26, 34], article: [24, 32], manager: [20, 28], partner: [12, 20], admin: [24, 30] };
  for (const user of users) {
    for (const d of workingDays) {
      if (d < user.joiningDate) continue;
      const key = `${user.id}|${d}`;
      if (skip.has(key)) continue;
      if (leaveDays.has(key)) {
        addEntry({ userId: user.id, date: d, internalCategory: 'leave', hours: 0, description: 'Personal leave (approved)' });
        continue;
      }
      if (user.id === 'u-aditya') continue;
      const [lo, hi] = target[user.role];
      let remaining = (between(lo, hi) / 4) * (weekday(d) === 6 ? 0.55 : 1) - (dayHours.get(key) ?? 0);
      remaining = Math.round(remaining * 4) / 4;
      if (user.role === 'admin') {
        addEntry({ userId: user.id, date: d, internalCategory: 'practice_administration', hours: Math.max(remaining, 2), description: pick(['Client master updates', 'Document inward register', 'DSC register update', 'Invoices raised']) });
        continue;
      }
      if (weekday(d) === 1 && user.role !== 'article') {
        addEntry({ userId: user.id, date: d, internalCategory: 'internal_meeting', hours: 1, description: 'Monday work allocation meeting' });
        remaining -= 1;
      }
      if (user.role === 'article' && weekday(d) === 6) {
        addEntry({ userId: user.id, date: d, internalCategory: 'articleship_classes', hours: 2, description: 'ICAI GMCS class' });
        remaining -= 2;
      }
      const myClients =
        user.role === 'partner'
          ? db.clients.filter((c) => c.partnerId === user.id).map((c) => c.id)
          : user.role === 'manager'
            ? db.clients.filter((c) => c.managerId === user.id).map((c) => c.id)
            : db.clientTeam.filter((a) => a.userId === user.id).map((a) => a.clientId);
      const candidates = db.tasks.filter((t) => {
        if (!myClients.includes(t.clientId) || t.kind !== 'compliance') return false;
        const end = t.ack ? t.ack.date : t.effectiveDue;
        if (t.ack && t.ack.date <= d) return false;
        if (t.status === 'not_applicable') return false;
        // keep most periods inside their budget so overruns stay the exception
        if ((taskUsed.get(t.id) ?? 0) >= (t.budgetHours ?? 4) * 0.8) return false;
        return diffDays(end, d) >= 0 && diffDays(end, d) <= 22 && t.effectiveDue >= addDays(d, -3);
      });
      const weighted = candidates.flatMap((t) => (t.assignedTo === user.id || (user.role !== 'staff' && user.role !== 'article') ? [t, t, t] : [t]));
      let guard = 0;
      while (remaining >= 0.5 && weighted.length && guard++ < 6) {
        const t = pick(weighted);
        if ((taskUsed.get(t.id) ?? 0) >= (t.budgetHours ?? 4) * 0.9) continue;
        const template = tpl(t.templateCode);
        const end = t.ack ? t.ack.date : t.effectiveDue;
        const fi = filingIdx(t);
        let idx: number;
        if (user.role === 'partner' || user.role === 'manager') {
          const r = template.stages.findIndex((s) => /Review/.test(s));
          idx = r >= 0 ? r : Math.max(0, fi - 1);
        } else {
          idx = Math.max(0, Math.min(fi - 1, Math.floor((1 - diffDays(end, d) / 20) * fi)));
        }
        if (isOpen(t.status)) idx = Math.min(idx, t.stageIndex);
        const room = Math.floor(((t.budgetHours ?? 4) * 0.9 - (taskUsed.get(t.id) ?? 0)) * 4) / 4;
        if (room < 0.25) continue;
        const h = Math.min(remaining, room, pick([0.75, 1, 1.5, 2, 2.5, 3]));
        const isAudit = t.templateCode === 'audit';
        const onSite = isAudit && user.role !== 'partner' && rand() < 0.5;
        addEntry({
          userId: user.id, date: d, clientId: t.clientId, engagementId: t.engagementId, taskId: t.id, stage: stageName(t, idx), hours: h,
          description: user.role === 'partner' || user.role === 'manager' ? pick(['Review', 'Client call', 'Query resolution']) : pick(DESCRIPTION_CHIPS.slice(0, 7)),
          location: onSite ? 'client_site' : undefined, clientSiteClientId: onSite ? t.clientId : undefined,
        });
        remaining -= h;
      }
      if (remaining >= 0.75 && user.role !== 'partner') {
        const cat: InternalCategory = pick(['knowledge_updates', 'training_cpe', 'other']);
        addEntry({ userId: user.id, date: d, internalCategory: cat, hours: Math.round(remaining * 4) / 4, description: cat === 'knowledge_updates' ? 'CBIC notifications reading' : cat === 'training_cpe' ? 'Webinar on GST amendments' : 'File organisation' });
      }
    }
  }
  // Today: one entry already logged by Sneha this morning
  if (sg3b && weekday(T) !== 0) {
    addEntry({ userId: 'u-sneha', date: T, clientId: 'c-0101', engagementId: sg3b.engagementId, taskId: sg3b.id, stage: '2B/Books Reconciliation', hours: 1.25, description: 'Reconciliation', outcome: 'GSTR-2B vs purchase register matched for 142 invoices' });
  }
  db.entries = entries;

  // Open tasks advance to the furthest stage their work entries reached
  for (const t of db.tasks) {
    if (!isOpen(t.status)) continue;
    const template = tpl(t.templateCode);
    for (const e of entries) {
      if (e.taskId !== t.id || !e.stage) continue;
      const idx = template.stages.indexOf(e.stage);
      if (idx > t.stageIndex && idx < (template.filingStageIndex ?? 99)) t.stageIndex = idx;
    }
    if (t.status === 'upcoming' && entries.some((e) => e.taskId === t.id)) {
      t.statusHistory.push({ at: isoAt(addDays(T, -3), '12:00'), by: t.assignedTo ?? SYSTEM, from: 'upcoming', to: 'in_progress', note: 'Work logged' });
      t.status = 'in_progress';
    }
  }

  // Event-linked tasks with a known AGM date are not provisional
  for (const t of db.tasks) {
    if (t.kind !== 'compliance') continue;
    const type = db.complianceTypes.find((x) => x.code === t.complianceTypeCode)!;
    const client = db.clients.find((c) => c.id === t.clientId)!;
    t.provisional = dueForPeriod(type, client, t.periodKey!)?.provisional ?? false;
  }

  db.audit.push(
    { id: uid(), at: tarExt.publishedAt, by: SYSTEM, entity: 'due_date', entityId: 'TAR', action: 'Extension published', detail: `Tax audit report ${fyLabel(fyClosed)}: 30 Sep → 31 Oct · ${tarExt.reference}` },
    { id: uid(), at: isoAt(addDays(T, -5), '12:00'), by: 'u-karan', entity: 'task', entityId: ds1?.id ?? '', action: 'Marked Pending from Client', detail: 'Deshmukh & Sons · Sales register and credit notes' },
    { id: uid(), at: isoAt(addDays(T, -1), '16:40'), by: 'u-karan', entity: 'task', entityId: bp?.id ?? '', action: 'Submitted for review', detail: 'Brightpath Logistics LLP · GSTR-1' },
  );
  addV5DemoData(db, T, { notice, stock, books, oneTime, rand });
  db.audit.sort((a, b) => b.at.localeCompare(a.at));
  return db;
}
