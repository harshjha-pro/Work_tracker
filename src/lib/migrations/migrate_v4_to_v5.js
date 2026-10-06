/**
 * Data migration v4 → v5 for the QEPEX Work Tracker.
 *
 * Pure function: no clock reads, no randomness, no I/O, input is never mutated.
 * Idempotent: a db already at version ≥ 5 is returned unchanged (same reference),
 * and every step is written so re-applying it to v5 records changes nothing.
 * Every id that exists in v4 survives unchanged; new child records get ids
 * derived from their parent id, so two runs produce identical output.
 *
 * Self-contained on purpose: a migration is a frozen snapshot. Later edits to
 * the app's seed or master data must not change what this migration does.
 *
 * Usage:
 *   const { db, report } = migrate_v4_to_v5(v4db, { now: new Date().toISOString() });
 */

export const MIGRATION_ID = 'v4_to_v5';

/** GST state codes (first two digits of a GSTIN). */
export const GST_STATES = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
  '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '25': 'Daman and Diu', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra',
  '28': 'Andhra Pradesh (old)', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu',
  '34': 'Puducherry', '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
  '97': 'Other Territory',
};

const GST_CODES = ['GSTR1_M', 'GSTR3B_M', 'GSTR1_Q', 'GSTR3B_Q', 'CMP08', 'GSTR9', 'GSTR9C', 'IFF', 'GSTR4'];
const TDS_RETURN_CODES = ['TDS_24Q', 'TDS_26Q', 'TDS_27Q', 'TCS_27EQ'];

/** Compliance types added in v5 (Rules Spec §2.2 / §10). All dates illustrative. */
const NEW_COMPLIANCE_TYPES = [
  {
    code: 'IFF', name: 'IFF (QRMP, months 1–2)', shortName: 'IFF', serviceLine: 'gst', engagementGroup: 'GST Returns',
    templateCode: 'gst_return', frequency: 'monthly', rule: { kind: 'monthly', day: 13, quarterMonths: [1, 2] },
    applicability: [{ flag: 'gstFrequency', value: 'qrmp' }, { flag: 'iffOpted', value: 'true' }], scope: 'gstin', defaultBudgetHours: 1.5,
  },
  {
    code: 'GSTR4', name: 'GSTR-4 (composition annual return)', shortName: 'GSTR-4', serviceLine: 'gst', engagementGroup: 'GST Annual Return',
    templateCode: 'gst_return', frequency: 'annual', rule: { kind: 'annual', month: 4, day: 30 },
    applicability: [{ flag: 'gstFrequency', value: 'composition' }], scope: 'gstin', defaultBudgetHours: 4,
  },
  {
    code: 'TP3CEB', name: 'Transfer pricing report (Form 3CEB)', shortName: 'Form 3CEB', serviceLine: 'audit', engagementGroup: 'Transfer Pricing',
    templateCode: 'audit', frequency: 'annual', rule: { kind: 'annual', month: 10, day: 31 }, periodLabelStyle: 'ay',
    applicability: [{ flag: 'transferPricing', value: 'true' }], scope: 'client', defaultBudgetHours: 25,
  },
  {
    code: 'TDS_24Q', name: 'TDS return 24Q (salary)', shortName: '24Q', serviceLine: 'direct_tax', engagementGroup: 'TDS Compliance',
    templateCode: 'tds_return', frequency: 'quarterly', rule: { kind: 'quarterly', dates: [{ month: 7, day: 31 }, { month: 10, day: 31 }, { month: 1, day: 31 }, { month: 5, day: 31 }] },
    applicability: [{ flag: 'tds', value: 'true' }, { flag: 'tdsSalary', value: 'true' }], scope: 'client', defaultBudgetHours: 4,
  },
  {
    code: 'TDS_26Q', name: 'TDS return 26Q (non-salary)', shortName: '26Q', serviceLine: 'direct_tax', engagementGroup: 'TDS Compliance',
    templateCode: 'tds_return', frequency: 'quarterly', rule: { kind: 'quarterly', dates: [{ month: 7, day: 31 }, { month: 10, day: 31 }, { month: 1, day: 31 }, { month: 5, day: 31 }] },
    applicability: [{ flag: 'tds', value: 'true' }, { flag: 'tdsNonSalary', value: 'true' }], scope: 'client', defaultBudgetHours: 4,
  },
  {
    code: 'TDS_27Q', name: 'TDS return 27Q (non-resident)', shortName: '27Q', serviceLine: 'direct_tax', engagementGroup: 'TDS Compliance',
    templateCode: 'tds_return', frequency: 'quarterly', rule: { kind: 'quarterly', dates: [{ month: 7, day: 31 }, { month: 10, day: 31 }, { month: 1, day: 31 }, { month: 5, day: 31 }] },
    applicability: [{ flag: 'tds', value: 'true' }, { flag: 'tdsNonResident', value: 'true' }], scope: 'client', defaultBudgetHours: 3,
  },
  {
    code: 'TCS_27EQ', name: 'TCS return 27EQ', shortName: '27EQ', serviceLine: 'direct_tax', engagementGroup: 'TDS Compliance',
    templateCode: 'tds_return', frequency: 'quarterly', rule: { kind: 'quarterly', dates: [{ month: 7, day: 15 }, { month: 10, day: 15 }, { month: 1, day: 15 }, { month: 5, day: 15 }] },
    applicability: [{ flag: 'tcs', value: 'true' }], scope: 'client', defaultBudgetHours: 3,
  },
  {
    code: 'ADT1', name: 'ADT-1 (auditor appointment)', shortName: 'ADT-1', serviceLine: 'company_law', engagementGroup: 'ROC Annual Filing',
    templateCode: 'roc', frequency: 'event_based', rule: { kind: 'event', event: 'auditor_appointment', offsetDays: 15 },
    applicability: [{ flag: 'isCompany', value: 'true' }], scope: 'client', defaultBudgetHours: 1,
  },
];

const TEMPLATE_FAMILY = {
  gst_return: { family: 'F1', requiresSignoff: false, requiresUdin: false },
  itr: { family: 'F2', requiresSignoff: false, requiresUdin: false },
  tds_return: { family: 'F3', requiresSignoff: false, requiresUdin: false },
  audit: { family: 'F4', requiresSignoff: true, requiresUdin: true },
  roc: { family: 'F5', requiresSignoff: true, requiresUdin: false },
};

export const DEFAULT_SETTINGS = {
  udinPendingDays: 15,
  pendingFromClientAlertDays: 10,
  pendingFollowUpEveryDays: 3,
  sessionTimeoutMinutes: 30,
  reminderLeadDays: [7, 3, 1],
  escalateToManagerAfterDays: 1,
  escalateToPartnerAfterDays: 3,
  reviewSlaDays: 2,
  dscExpiryAlertDays: [30, 7],
  noticeReminderDays: [7, 3, 1],
  agmCeilingMonths: 6,
  attachmentMaxBytes: 5 * 1024 * 1024,
  pinMinLength: 4,
  maxFailedLogins: 5,
};

const NEW_COLLECTIONS = [
  'leaveRequests', 'udinRegister', 'dscRegister', 'dscMovements', 'notices',
  'inwardOutward', 'notificationState', 'accessLog', 'attachments', 'importBatches',
];

const NOTICE_STATUS_BY_STAGE = ['received', 'analysis', 'data_gathering', 'draft_response', 'review', 'submitted', 'hearing', 'closed'];

const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');

/** Calendar start of the period a task covers. */
export function periodStart(/** @type {string} */ periodKey) {
  let m = /^(\d{4})-(\d{2})$/.exec(periodKey);
  if (m) return `${m[1]}-${m[2]}-01`;
  m = /^FY(\d{4})-\d{2}-Q(\d)$/.exec(periodKey);
  if (m) {
    const fy = +m[1];
    const q = +m[2];
    const month = 4 + (q - 1) * 3;
    return month > 12 ? `${fy + 1}-${pad(month - 12)}-01` : `${fy}-${pad(month)}-01`;
  }
  m = /^FY(\d{4})-\d{2}$/.exec(periodKey);
  if (m) return `${m[1]}-04-01`;
  return null;
}

/**
 * @param {any} v4 the `state.db` object persisted by app data version 4
 * @param {{ now: string }} opts `now` is an ISO timestamp supplied by the caller (keeps the function pure)
 * @returns {{ db: any, report: any }}
 */
export function migrate_v4_to_v5(v4, opts) {
  if (!opts || typeof opts.now !== 'string') throw new Error('migrate_v4_to_v5: opts.now (ISO timestamp) is required');
  if (!v4 || typeof v4 !== 'object') throw new Error('migrate_v4_to_v5: no data to migrate');
  if ((v4.version ?? 0) >= 5 && v4.meta && v4.meta.schemaVersion >= 5) {
    return { db: v4, report: { skipped: true, reason: `already at schema version ${v4.meta.schemaVersion}` } };
  }
  if (v4.version !== 4) throw new Error(`migrate_v4_to_v5: expected data version 4, found ${v4.version}`);

  const now = opts.now;
  const today = now.slice(0, 10);
  /** @type {any} */
  const db = JSON.parse(JSON.stringify(v4));
  /** @type {{collection: string, action: string, count: number, detail: string}[]} */
  const transformations = [];
  /** @type {{collection: string, id: string, issue: string, decision: string}[]} */
  const judgementCalls = [];
  const note = (collection, action, count, detail) => transformations.push({ collection, action, count, detail });
  const judge = (collection, id, issue, decision) => judgementCalls.push({ collection, id, issue, decision });

  const countsBefore = countCollections(v4);
  const userIds = new Set((db.users || []).map((u) => u.id));
  const adminFallback = (db.users || []).find((u) => u.role === 'admin')?.id ?? 'system';

  // ---------- users (B1, A8, C1) ----------
  let usersTouched = 0;
  for (const u of db.users) {
    if (u.auth && 'active' in u) continue;
    usersTouched++;
    if (!('active' in u)) u.active = true;
    u.deactivatedOn ??= null;
    u.deactivatedBy ??= null;
    u.deactivationNote ??= null;
    u.defaultLocation ??= 'office';
    if (typeof u.locationOverrideAllowed !== 'boolean') u.locationOverrideAllowed = true;
    u.auth ??= {
      credentialKind: 'pin',
      passwordHash: null,
      passwordSalt: null,
      hashIterations: 210000,
      mustChangePassword: true,
      tempPinIssuedAt: null,
      tempPinIssuedBy: null,
      failedAttempts: 0,
      lockedUntil: null,
      lastLoginAt: null,
      totpSecret: null,
      totpEnrolledAt: null,
    };
  }
  note('users', 'added active/deactivation fields and an empty credential record (auth)', usersTouched,
    'No PIN exists yet: each user signs in with a temporary PIN issued by the Practice Admin and must set their own. 2FA enrolment starts empty.');
  judge('users', '*', 'Nobody has a PIN after migration, including the Practice Admin who issues them.',
    'First sign-in of an Admin account with no PIN set lets that Admin choose a PIN; every other user waits for a temporary PIN from Admin.');

  // ---------- tasks index for later steps ----------
  const tasksByClient = new Map();
  for (const t of db.tasks) {
    if (!tasksByClient.has(t.clientId)) tasksByClient.set(t.clientId, []);
    tasksByClient.get(t.clientId).push(t);
  }

  // ---------- clients (A19, A20, Rules §1.1, §3.3) ----------
  let gstEntries = 0;
  let clientsTouched = 0;
  for (const c of db.clients) {
    const already = Array.isArray(c.gstins) && c.gstins.every((g) => g && typeof g === 'object');
    if (already && Array.isArray(c.directors) && c.complianceStartDates) continue;
    clientsTouched++;
    const p = c.profile || {};
    const clientTasks = tasksByClient.get(c.id) || [];
    const created = (c.createdAt || now).slice(0, 10);

    if (!already) {
      const oldFreq = p.gstFrequency ?? 'not_applicable';
      const gstStarts = clientTasks.filter((t) => GST_CODES.includes(t.complianceTypeCode)).map((t) => periodStart(t.periodKey)).filter(Boolean).sort();
      const effectiveFrom = gstStarts[0] && gstStarts[0] < created ? gstStarts[0] : created;
      const list = (c.gstins || []).filter((g) => typeof g === 'string' && g.trim());
      c.gstins = list.map((g, i) => {
        const gstin = g.trim().toUpperCase();
        const stateCode = gstin.slice(0, 2);
        let frequency = oldFreq;
        if (oldFreq === 'not_applicable') {
          frequency = 'not_set';
          judge('clients', c.id, `${c.code} has GSTIN ${gstin} but GST frequency "not applicable" in v4.`, 'Kept the GSTIN with frequency "not set"; no GST tasks generate until a Manager sets the frequency.');
        }
        if (list.length > 1 && i > 0) judge('clients', c.id, `${c.code} has ${list.length} GSTINs; v4 held one frequency for all.`, `Applied the client's frequency (${oldFreq}) to ${gstin}; review per registration.`);
        if (!GST_STATES[stateCode]) judge('clients', c.id, `${gstin} has an unknown state code ${stateCode}.`, 'Kept as entered with state "Unknown".');
        gstEntries++;
        return {
          id: `${c.id}:gst:${gstin}`,
          gstin,
          stateCode,
          state: GST_STATES[stateCode] ?? 'Unknown',
          frequency,
          effectiveFrom,
          frequencyHistory: [{ frequency, effectiveFrom, changedBy: 'migration', changedAt: now }],
          gstAnnualReturn: !!p.gstAnnualReturn,
          gst9c: !!p.gst9c,
          iffOpted: false,
          status: 'active',
          cancelledOn: null,
        };
      });
      if (oldFreq !== 'not_applicable' && !list.length) {
        judge('clients', c.id, `${c.code} had GST frequency "${oldFreq}" but no GSTIN.`, 'No registration created (a GSTIN is required); GST tasks stop generating until a GSTIN is added. Existing tasks are kept.');
      }
      if (!c.stateCode && c.gstins[0]) c.stateCode = c.gstins[0].stateCode;
    }

    // profile: GST moved to gstins[]; TDS split into return-type flags
    if ('gstFrequency' in p) delete p.gstFrequency;
    if ('gstAnnualReturn' in p) delete p.gstAnnualReturn;
    if ('gst9c' in p) delete p.gst9c;
    if (!('tdsSalary' in p)) {
      p.tdsSalary = !!p.tds;
      p.tdsNonSalary = !!p.tds;
      p.tdsNonResident = false;
      p.tcs = false;
    }
    const isCompany = c.constitution === 'private_company' || c.constitution === 'public_company';
    if (isCompany && !p.statutoryAudit) {
      p.statutoryAudit = true;
      judge('clients', c.id, `${c.code} is a company with statutory audit off.`, 'Turned statutory audit on — it is mandatory for companies (Rules §1.2).');
    }
    c.profile = p;
    c.directors ??= [];
    c.auditorAppointmentDate ??= null;
    if (!('statusEffectiveFrom' in c)) {
      c.statusEffectiveFrom = null;
      if (c.status !== 'active') judge('clients', c.id, `${c.code} is ${c.status} but v4 did not record since when.`, 'statusEffectiveFrom left empty for the Manager to fill in.');
    }

    // compliance start date per type: earliest existing period, else the client's creation date
    if (!c.complianceStartDates) {
      /** @type {Record<string, string>} */
      const starts = {};
      for (const t of clientTasks) {
        if (t.kind !== 'compliance' || !t.complianceTypeCode) continue;
        const s = periodStart(t.periodKey);
        if (s && (!starts[t.complianceTypeCode] || s < starts[t.complianceTypeCode])) starts[t.complianceTypeCode] = s;
      }
      // TDS return split: new return types start after the last quarter that already has a TDS_RET task
      if (p.tds) {
        const lastRet = clientTasks.filter((t) => t.complianceTypeCode === 'TDS_RET').map((t) => t.periodKey).sort().pop();
        const nextQuarter = lastRet ? nextQuarterStart(lastRet) : today;
        for (const code of TDS_RETURN_CODES) starts[code] = nextQuarter;
      }
      c.complianceStartDates = starts;
    }
  }
  note('clients', 'GSTINs converted from text to registration records (state, frequency, effective date, GSTR-9/9C flags)', gstEntries,
    'profile.gstFrequency, profile.gstAnnualReturn and profile.gst9c are REMOVED: replaced by gstins[].frequency / .gstAnnualReturn / .gst9c.');
  note('clients', 'added directors[], auditorAppointmentDate, statusEffectiveFrom, complianceStartDates, TDS sub-flags', clientsTouched,
    'Clients with TDS on get tdsSalary + tdsNonSalary on (24Q + 26Q); tdsNonResident and tcs off. Directors start empty (DIR-3 KYC stays client-level until directors are recorded).');

  // ---------- compliance types (A22, A23) ----------
  const typesAdded = upgradeComplianceTypes(db.complianceTypes);
  note('complianceTypes', 'added Rules Spec types: IFF, GSTR-4, Form 3CEB, 24Q, 26Q, 27Q, 27EQ, ADT-1 (all marked illustrative)', typesAdded,
    'TDS_RET (single TDS return) retired: kept with its existing tasks for history, no longer generates. 29 active types after migration.');
  note('complianceTypes', 'added scope (client / gstin / director), illustrative + verification fields; ITR (audit) due 30 Nov when Form 3CEB applies', db.complianceTypes.length, '');
  if (db.complianceTypes.some((t) => t.code === 'STAT_AUDIT' && t.rule?.kind === 'annual' && (t.rule.month !== 9 || t.rule.day !== 30))) {
    judge('complianceTypes', 'STAT_AUDIT', 'Seeded rule (1 Sep) differs from the Rules Spec internal target (30 Sep).', 'Left as is — the Due-Date Master is firm data; change it in the app if 30 Sep is wanted.');
  }

  // ---------- templates (A27) ----------
  upgradeTemplates(db.templates, db.seededOn ? `${db.seededOn}T00:00:00.000Z` : now);
  note('templates', 'added version 1 history entry, family and sign-off/UDIN requirement', db.templates.length, 'Audit (F4) requires Partner sign-off and UDIN; ROC (F5) requires sign-off before DSC signing.');

  // ---------- engagements (A29) ----------
  let feeSet = 0;
  for (const e of db.engagements) {
    if ('feeBasis' in e) continue;
    e.feeBasis = e.type === 'recurring' ? { type: 'recurring', amount: null, rate: null, retainerPeriod: null } : null;
    if (e.feeBasis) feeSet++;
  }
  note('engagements', 'added feeBasis: "recurring" (amount not set) for compliance engagements, not set for one-time work', db.engagements.length, `${feeSet} set to recurring.`);

  // ---------- tasks (A13, A14, A19, A20, A27, B3) ----------
  const clientById = new Map(db.clients.map((c) => [c.id, c]));
  db.udinRegister = Array.isArray(db.udinRegister) ? db.udinRegister : [];
  let pointsCreated = 0;
  let reviewsDerived = 0;
  let gstLinked = 0;
  let udinCreated = 0;
  for (const t of db.tasks) {
    if ('reviewPoints' in t && 'templateVersion' in t) continue;
    const c = clientById.get(t.clientId);
    t.templateVersion ??= 1;
    t.directorId ??= null;
    t.supersededByTaskId ??= null;
    t.signoff ??= null;
    if (!('gstinId' in t)) {
      t.gstinId = null;
      if (GST_CODES.includes(t.complianceTypeCode) && c) {
        if (c.gstins.length === 1) {
          t.gstinId = c.gstins[0].id;
          gstLinked++;
        } else {
          judge('tasks', t.id, `${c.code} ${t.title}: GST task with ${c.gstins.length} GSTINs on the client.`, 'Left unlinked (gstinId empty); link it to the right registration in the app.');
        }
      }
    }
    // review state and review points from the v4 status history
    let review = null;
    const points = [];
    for (const h of t.statusHistory || []) {
      if (h.to === 'under_review') review = { submittedBy: h.by, submittedAt: h.at, checkerId: t.checkerId ?? h.by, decision: null, decidedAt: null };
      if (h.from === 'under_review' && h.to === 'in_progress' && review) {
        const returned = typeof h.note === 'string' && h.note.startsWith('Returned with review points:');
        review = { ...review, decision: returned ? 'returned' : 'approved', decidedAt: h.at, checkerId: h.by };
        if (returned) {
          points.push({ id: `${t.id}:rp:${points.length + 1}`, text: h.note.replace('Returned with review points:', '').trim(), raisedBy: h.by, raisedAt: h.at, clearedBy: null, clearedAt: null });
        }
      }
    }
    if (review) reviewsDerived++;
    t.review ??= review;
    if (points.length && (t.status === 'filed' || t.status === 'filed_late')) {
      const filedAt = [...t.statusHistory].reverse().find((h) => h.to === 'filed' || h.to === 'filed_late');
      for (const rp of points) {
        rp.clearedBy = filedAt?.by ?? null;
        rp.clearedAt = filedAt?.at ?? null;
      }
      judge('tasks', t.id, `${t.title}: review points from v4 notes on a task that is already filed.`, 'Marked cleared by the person who recorded the filing, at the filing time.');
    }
    pointsCreated += points.length;
    t.reviewPoints ??= points;
    // UDIN acknowledgments become UDIN register entries and a Partner sign-off
    if (t.ack && t.ack.type === 'udin' && !t.signoff && c) {
      const udinId = `udin:${t.id}`;
      if (!db.udinRegister.some((u) => u.id === udinId)) {
        db.udinRegister.push({
          id: udinId, clientId: t.clientId, taskId: t.id, engagementId: t.engagementId ?? null, institute: 'icai',
          documentType: (t.title || '').split(' · ')[0] || 'Audit report', dateOfSigning: t.ack.date, signingPartnerId: c.partnerId,
          udin: t.ack.number, dateGenerated: t.ack.date, signedCopyRef: null, status: 'generated', reconciledAt: null, reconciledBy: null,
          notes: 'Created from the task acknowledgment during migration to v5', createdAt: now, createdBy: 'migration',
        });
        udinCreated++;
      }
      t.signoff = { by: c.partnerId, at: `${t.ack.date}T12:00:00.000Z`, udinId };
      judge('tasks', t.id, `${c.code} ${t.title}: UDIN recorded in v4 without a named signing Partner.`, "Signing Partner set to the client's assigned Partner.");
    }
  }
  note('tasks', 'added reviewPoints, review, templateVersion, gstinId, directorId, signoff, supersededByTaskId', db.tasks.length,
    `${gstLinked} GST tasks linked to their GSTIN; ${reviewsDerived} review cycles and ${pointsCreated} review points derived from status history.`);
  note('udinRegister', 'created from audit tasks whose acknowledgment is a UDIN', udinCreated, 'Each such task gets a sign-off linked to its UDIN entry.');

  // ---------- notices from v4 notice engagements (B5) ----------
  db.notices = Array.isArray(db.notices) ? db.notices : [];
  let noticesCreated = 0;
  for (const e of db.engagements) {
    if (e.templateCode !== 'notice') continue;
    const id = `notice:${e.id}`;
    if (db.notices.some((n) => n.id === id)) continue;
    const task = db.tasks.find((t) => t.engagementId === e.id && t.kind === 'engagement');
    if (!task) continue;
    const section = /u\/s\s*([\w().]+)/i.exec(e.title)?.[1] ?? '';
    const period = /(AY|FY)\s?\d{4}-\d{2}/.exec(e.title)?.[0] ?? e.financialYear ?? '';
    const noticeType = e.title.split(/\s+u\/s|\s+—/)[0].trim() || 'Notice';
    const authority = e.serviceLine === 'direct_tax' ? 'income_tax' : e.serviceLine === 'gst' ? 'gst' : e.serviceLine === 'company_law' ? 'mca_roc' : 'other';
    const maker = e.team.find((m) => m.role === 'maker')?.userId ?? null;
    const checker = e.team.find((m) => m.role === 'checker')?.userId ?? e.managerId ?? null;
    db.notices.push({
      id, clientId: e.clientId, engagementId: e.id, taskId: task.id, authority, period, noticeType, section, din: null,
      dateOfNotice: null, dateReceived: e.startDate ?? task.createdAt.slice(0, 10), responseDueDate: task.effectiveDue,
      hearings: [], status: task.status === 'filed' || task.status === 'filed_late' ? 'submitted' : NOTICE_STATUS_BY_STAGE[task.stageIndex] ?? 'received',
      outcome: null, demandRaised: null, demandDropped: null, assignedTo: task.assignedTo ?? maker, reviewerId: task.checkerId ?? checker,
      createdAt: e.createdAt, createdBy: e.createdBy, updatedAt: now, updatedBy: 'migration',
    });
    noticesCreated++;
    judge('notices', id, `Notice engagement "${e.title}" had no notice record in v4.`,
      `Created a notice record: section "${section}", period "${period}", received ${e.startDate ?? '—'}, response due ${task.effectiveDue}. DIN and date of notice left empty to fill in.`);
  }
  note('notices', 'created from one-time engagements using the Notice template', noticesCreated, '');

  // ---------- extensions (Rules §5.4) ----------
  for (const x of db.extensions) {
    x.status ??= 'published';
    x.supersedesId ??= null;
  }
  note('extensions', 'added status = published and supersedesId', db.extensions.length, '');

  // ---------- new collections, settings, meta ----------
  for (const k of NEW_COLLECTIONS) if (!Array.isArray(db[k])) db[k] = [];
  db.settings = { ...DEFAULT_SETTINGS, ...(db.settings || {}) };
  note('settings', 'created with defaults', 1, 'UDIN pending window 15 days, pending-from-client alert 10 days, session timeout 30 minutes (plus Rules §9 reminder timings).');
  note('*', 'created empty collections', NEW_COLLECTIONS.length, NEW_COLLECTIONS.join(', '));

  // dangling references are reported, never deleted
  for (const e of db.entries) {
    if (!userIds.has(e.userId)) judge('entries', e.id, `Entry belongs to unknown user ${e.userId}.`, 'Kept unchanged.');
  }

  db.version = 5;
  db.meta = {
    schemaVersion: 5,
    migrationsApplied: [...(db.meta?.migrationsApplied ?? []), { id: MIGRATION_ID, from: 4, to: 5, at: now, summary: `${transformations.length} transformations, ${judgementCalls.length} judgement calls` }],
  };
  db.audit = Array.isArray(db.audit) ? db.audit : [];
  if (!db.audit.some((a) => a.id === `audit:${MIGRATION_ID}`)) {
    db.audit.unshift({ id: `audit:${MIGRATION_ID}`, at: now, by: adminFallback, entity: 'system', entityId: 'schema', action: 'Data migrated from version 4 to 5', detail: `${transformations.length} transformations, ${judgementCalls.length} judgement calls` });
  }

  return {
    db,
    report: { from: 4, to: 5, at: now, countsBefore, countsAfter: countCollections(db), transformations, judgementCalls },
  };
}

/**
 * v5 fields for the Due-Date Master, in place. Also used by the app to build its
 * default master data, so a fresh install and a migrated one are identical.
 * @param {any[]} types
 * @returns {number} number of types added
 */
export function upgradeComplianceTypes(types) {
  let added = 0;
  for (const t of types) {
    if (!('scope' in t)) t.scope = GST_CODES.includes(t.code) ? 'gstin' : t.code === 'DIR3' ? 'director' : 'client';
    t.illustrative ??= true;
    t.verifiedBy ??= null;
    t.verifiedAt ??= null;
    if (t.code === 'ITR_A' && !t.dueVariants) t.dueVariants = [{ when: { flag: 'transferPricing', value: 'true' }, month: 11, day: 30 }];
    if (t.code === 'TDS_RET' && !t.retired) {
      t.retired = true;
      t.isActive = false;
      t.replacedBy = ['TDS_24Q', 'TDS_26Q', 'TDS_27Q', 'TCS_27EQ'];
    }
  }
  for (const nt of NEW_COMPLIANCE_TYPES) {
    if (types.some((t) => t.code === nt.code)) continue;
    types.push({ ...JSON.parse(JSON.stringify(nt)), isActive: true, illustrative: true, verifiedBy: null, verifiedAt: null });
    added++;
  }
  return added;
}

/**
 * v5 fields for stage templates (A27), in place.
 * @param {any[]} templates
 * @param {string} effectiveFrom timestamp for the version-1 history entry
 */
export function upgradeTemplates(templates, effectiveFrom) {
  for (const tpl of templates) {
    const fam = TEMPLATE_FAMILY[tpl.code];
    if (fam && !tpl.family) Object.assign(tpl, fam);
    tpl.requiresSignoff ??= false;
    tpl.requiresUdin ??= false;
    if (!tpl.versions) {
      tpl.version = 1;
      tpl.versions = [{
        version: 1, name: tpl.name, stages: [...tpl.stages], checklist: [...tpl.checklist], filingStageIndex: tpl.filingStageIndex,
        ackType: tpl.ackType, reviewLevel: tpl.reviewLevel, effectiveFrom, createdBy: 'migration', note: 'Version in use before schema v5',
      }];
    }
  }
}

function nextQuarterStart(/** @type {string} */ periodKey) {
  const m = /^FY(\d{4})-\d{2}-Q(\d)$/.exec(periodKey);
  if (!m) return periodStart(periodKey);
  const fy = +m[1];
  const q = +m[2];
  return q === 4 ? `${fy + 1}-04-01` : periodStart(`FY${fy}-${pad((fy + 1) % 100)}-Q${q + 1}`);
}

export function countCollections(/** @type {any} */ db) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const [k, v] of Object.entries(db)) if (Array.isArray(v)) out[k] = v.length;
  return out;
}

/** Convenience for the zustand envelope persisted by v4: { state: { db, currentUserId }, version }. */
export function migratePersistedEnvelope(/** @type {any} */ envelope, /** @type {{ now: string }} */ opts) {
  const { db, report } = migrate_v4_to_v5(envelope.state.db, opts);
  return { envelope: { ...envelope, state: { ...envelope.state, db }, version: db.version }, report };
}
