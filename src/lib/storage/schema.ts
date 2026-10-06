// Single source of truth for schema version 5 storage.
// From these specs we generate the SQLite DDL, map records ⇄ rows, validate
// records in tests, and write SCHEMA_V5.md. Any field not listed is kept in the
// row's `extra_json` column, so nothing is ever dropped silently.

export type ColType = 'text' | 'integer' | 'real' | 'boolean' | 'json';

export interface Col {
  field: string;
  type: ColType;
  /** required = always present and non-null in a valid record */
  req?: boolean;
  /** null (not undefined) is the "empty" value for this field */
  nullable?: boolean;
  item?: string; // change-list item(s) the field serves
  doc: string;
  ref?: string; // referenced table, documentation + index
}

export interface ChildSpec {
  field: string; // array field on the parent record
  table: string;
  doc: string;
  item?: string;
  columns: Col[]; // each child must have an `id`
}

export interface TableSpec {
  collection: string; // key on DB
  table: string;
  key: string[]; // record fields forming the primary key
  doc: string;
  item: string;
  columns: Col[];
  children?: ChildSpec[];
  appendOnly?: boolean;
}

const s = (field: string, doc: string, o: Partial<Col> = {}): Col => ({ field, type: 'text', doc, ...o });
const n = (field: string, doc: string, o: Partial<Col> = {}): Col => ({ field, type: 'real', doc, ...o });
const i = (field: string, doc: string, o: Partial<Col> = {}): Col => ({ field, type: 'integer', doc, ...o });
const b = (field: string, doc: string, o: Partial<Col> = {}): Col => ({ field, type: 'boolean', doc, ...o });
const j = (field: string, doc: string, o: Partial<Col> = {}): Col => ({ field, type: 'json', doc, ...o });

const R = { req: true };
const NUL = { nullable: true };

export const TABLES: TableSpec[] = [
  {
    collection: 'users', table: 'users', key: ['id'], item: 'B1, A8, C1', doc: 'Firm members. Deactivated users stay so their history remains attributed.',
    columns: [
      s('id', 'Primary key', R), s('employeeCode', 'Employee code, unique', R), s('name', 'Full name', R),
      s('role', 'partner | manager | staff | article | admin', R), s('designation', 'e.g. "Senior", "CS Trainee"', R),
      b('isSenior', 'Senior staff may review junior work'), s('email', 'Work email'), s('phone', 'Mobile number'),
      s('defaultLocation', 'office | client_site | wfh', { ...R, item: 'A8' }), b('locationOverrideAllowed', 'Whether the person may change location on an entry', { ...R, item: 'A8' }),
      s('joiningDate', 'YYYY-MM-DD', R), s('principalPartnerId', 'Article assistants: principal Partner', { ref: 'users' }),
      b('active', 'false once offboarded', { ...R, item: 'B1' }), s('deactivatedOn', 'Offboarding date', { ...NUL, item: 'B1' }),
      s('deactivatedBy', 'User who offboarded', { ...NUL, item: 'B1', ref: 'users' }), s('deactivationNote', 'Reason / custody notes', { ...NUL, item: 'B1' }),
    ],
  },
  {
    // 1:1 with users, kept in its own table so credentials never travel with ordinary user reads/exports
    collection: 'users.auth', table: 'user_auth', key: ['userId'], item: 'C1', doc: 'Credentials and 2FA, one row per user. PIN/password hashed with PBKDF2-SHA256 (Web Crypto); plaintext never stored.',
    columns: [
      s('userId', 'users.id', { ...R, ref: 'users' }), s('credentialKind', 'pin | password', R), s('passwordHash', 'base64 PBKDF2 hash', NUL), s('passwordSalt', 'base64, 16 random bytes', NUL),
      i('hashIterations', 'PBKDF2 iterations', R), b('mustChangePassword', 'true while a temporary PIN issued by Admin is in use', R),
      s('tempPinIssuedAt', 'When Admin issued the temporary PIN', NUL), s('tempPinIssuedBy', 'Admin who issued it', { ...NUL, ref: 'users' }),
      i('failedAttempts', 'Consecutive failed sign-ins', R), s('lockedUntil', 'Locked after too many failures', NUL), s('lastLoginAt', 'Last successful sign-in', NUL),
      s('totpSecret', 'Base32 TOTP secret (authenticator app)', NUL), s('totpEnrolledAt', 'When 2FA was enrolled', NUL),
    ],
  },
  {
    collection: 'clients', table: 'clients', key: ['id'], item: 'Spec §4, A19, A20, A22', doc: 'Client master.',
    columns: [
      s('id', 'Primary key', R), s('code', 'Client code, e.g. CL-0142', R), s('name', 'Legal name', R), s('group', 'Family / promoter group'),
      s('constitution', 'individual | huf | proprietorship | partnership_firm | llp | private_company | public_company | trust | society | other', R),
      s('status', 'active | dormant | discontinued', R), s('statusEffectiveFrom', 'Date the current status applies from (Rules §7)', NUL),
      s('pan', 'PAN'), s('tan', 'TAN'), s('cin', 'CIN or LLPIN'), s('udyam', 'Udyam registration'), s('stateCode', 'Principal place of business (GST state code)'),
      s('fyEnd', 'Financial year end, "31 Mar"', R), s('agmDate', 'Latest / scheduled AGM'), s('auditorAppointmentDate', 'Drives ADT-1', { ...NUL, item: 'A23' }),
      s('booksBy', 'firm | client', R), s('partnerId', 'Assigned Partner', { ...R, ref: 'users' }), s('managerId', 'Assigned Manager', { ref: 'users' }),
      s('contactName', 'Primary contact'), s('contactPhone', 'Contact phone'), s('contactEmail', 'Contact email'),
      j('profile', 'Applicability flags: tds, tdsSalary, tdsNonSalary, tdsNonResident, tcs, advanceTax, taxAudit, statutoryAudit, transferPricing, pf, esi', { ...R, item: 'A22' }),
      j('complianceStartDates', 'compliance type code → first period start that may be generated (Rules §3.3)', R),
      j('flagHistory', 'Append-only flag changes', R), s('createdAt', 'ISO timestamp', R), s('createdBy', 'users.id', R), s('updatedAt', 'ISO timestamp', R), s('updatedBy', 'users.id', R),
    ],
    children: [
      {
        field: 'gstins', table: 'client_gstins', item: 'A19', doc: 'One row per GST registration, each with its own filing frequency. Replaces v4 profile.gstFrequency / gstAnnualReturn / gst9c.',
        columns: [
          s('id', 'Primary key', R), s('gstin', '15-character GSTIN', R), s('stateCode', 'First two digits', R), s('state', 'State name', R),
          s('frequency', 'monthly | qrmp | composition | not_set', R), s('effectiveFrom', 'Current frequency applies from', R),
          j('frequencyHistory', 'Append-only frequency changes', R), b('gstAnnualReturn', 'GSTR-9 applicable', R), b('gst9c', 'GSTR-9C applicable', R),
          b('iffOpted', 'IFF opted (QRMP)', R), s('status', 'active | cancelled', R), s('cancelledOn', 'Cancellation date', NUL),
        ],
      },
      {
        field: 'directors', table: 'client_directors', item: 'A20', doc: 'Directors / designated partners. DIR-3 KYC generates per director.',
        columns: [
          s('id', 'Primary key', R), s('name', 'Full name', R), s('din', '8-digit DIN', R),
          s('designation', 'director | managing_director | whole_time_director | independent_director | designated_partner | other', R),
          s('dscId', 'DSC held by the director', { ...NUL, ref: 'dsc_register', item: 'A16' }), s('appointedOn', 'Appointment date', NUL), s('ceasedOn', 'Cessation date', NUL), b('active', 'Currently on the board', R),
        ],
      },
    ],
  },
  {
    collection: 'clientTeam', table: 'client_team', key: ['clientId', 'userId'], item: 'Spec §2', doc: 'Client-team scoping.',
    columns: [s('clientId', 'clients.id', { ...R, ref: 'clients' }), s('userId', 'users.id', { ...R, ref: 'users' }), s('role', 'staff | reviewer', R)],
  },
  {
    collection: 'complianceTypes', table: 'compliance_types', key: ['code'], item: 'Spec §6, A22, A23', doc: 'Due-Date Master. All dates illustrative until verified.',
    columns: [
      s('code', 'Primary key', R), s('name', 'Full name', R), s('shortName', 'Short label', R), s('serviceLine', 'accounting | audit | direct_tax | gst | company_law | advisory', R),
      s('engagementGroup', 'Recurring engagement it rolls into', R), s('templateCode', 'stage_templates.code', { ...R, ref: 'stage_templates' }),
      s('frequency', 'monthly | quarterly | annual | event_based', R), j('rule', 'Due-date rule (monthly / quarterly / annual / event)', R),
      j('dueVariants', 'Alternative due dates by flag (ITR audit → 30 Nov with 3CEB)'), j('applicability', 'Flag conditions, all must hold', R),
      s('scope', 'client | gstin | director', { ...R, item: 'A19, A20' }), s('periodLabelStyle', 'fy | ay | instalment'), n('defaultBudgetHours', 'Budget per period', R),
      b('isActive', 'Generates tasks', R), b('isCustom', 'Added by Admin'), b('retired', 'Kept for history only'), j('replacedBy', 'Codes that replace a retired type'),
      b('illustrative', '"Illustrative, verify before go-live"', { ...R, item: 'A23' }), s('verifiedBy', 'Reviewer who verified against current law', { ...NUL, item: 'A23' }), s('verifiedAt', 'When verified', { ...NUL, item: 'A23' }),
    ],
  },
  {
    collection: 'templates', table: 'stage_templates', key: ['code'], item: 'Spec §9, A27', doc: 'Stage templates; fields hold the current version, versions[] the full history.',
    columns: [
      s('code', 'Primary key', R), s('name', 'Name', R), s('family', 'F1–F6 (Rules §2.1)'), j('stages', 'Ordered stage names', R),
      i('filingStageIndex', 'Stage that needs an acknowledgment', NUL), s('ackType', 'arn | srn | itr_ack | challan | token | udin | other', NUL), s('reviewLevel', 'Who reviews', R),
      j('checklist', 'Default document checklist', R), b('requiresSignoff', 'Partner sign-off needed to file', R), b('requiresUdin', 'UDIN needed to file', R),
      i('version', 'Current version number', { ...R, item: 'A27' }), j('versions', 'All versions, oldest first', { ...R, item: 'A27' }),
    ],
  },
  {
    collection: 'engagements', table: 'engagements', key: ['id'], item: 'Spec §5, A29', doc: 'Engagements (recurring from the calendar, or one-time).',
    columns: [
      s('id', 'Primary key', R), s('clientId', 'clients.id', { ...R, ref: 'clients' }), s('serviceLine', 'Service line', R), s('type', 'recurring | one_time', R),
      s('title', 'Title', R), s('financialYear', '"FY 2026-27"'), s('templateCode', 'stage_templates.code', { ...R, ref: 'stage_templates' }),
      s('status', 'active | on_hold | completed | archived', R), s('partnerId', 'users.id', { ...R, ref: 'users' }), s('managerId', 'users.id', { ref: 'users' }),
      j('team', '[{userId, role: maker | checker}]', R), n('budgetHours', 'Engagement Budget (one-time total / recurring per period)'), b('billable', 'Chargeable, set by Partner', R),
      j('feeBasis', '{type: fixed | recurring | time, amount, rate, retainerPeriod} or null = not set', { ...NUL, item: 'A29' }),
      s('startDate', 'Start'), s('endDate', 'Target / due date'), s('createdAt', 'ISO timestamp', R), s('createdBy', 'users.id', R),
    ],
  },
  {
    collection: 'tasks', table: 'tasks', key: ['id'], item: 'Spec §6, §10, §11, A13, A14, A19, A20, A27', doc: 'Compliance tasks and one-time engagement work items. Natural key (client, type, period, GSTIN/director).',
    columns: [
      s('id', 'Primary key', R), s('clientId', 'clients.id', { ...R, ref: 'clients' }), s('engagementId', 'engagements.id', { ...R, ref: 'engagements' }),
      s('kind', 'compliance | engagement', R), s('complianceTypeCode', 'compliance_types.code', { ref: 'compliance_types' }), s('periodKey', '"2026-09", "FY2026-27-Q2", "FY2025-26"'),
      s('periodLabel', 'Display label', R), s('title', 'Display title', R), s('templateCode', 'stage_templates.code', { ...R, ref: 'stage_templates' }),
      i('templateVersion', 'Template version the task follows', { ...R, item: 'A27' }), s('gstinId', 'client_gstins.id for per-GSTIN types', { ...NUL, item: 'A19', ref: 'client_gstins' }),
      s('directorId', 'client_directors.id for per-director types', { ...NUL, item: 'A20', ref: 'client_directors' }),
      s('originalDue', 'Computed due date', R), s('effectiveDue', 'Due date after extensions', R), b('provisional', 'Event date not yet known'),
      s('status', 'upcoming | in_progress | pending_from_client | under_review | filed | filed_late | not_applicable', R), i('stageIndex', 'Current stage', R),
      j('pendingPeriods', 'Append-only client-waiting periods', R), j('ack', '{type, number, date} — required for Filed / Filed Late'),
      j('signoff', '{by, at, udinId} Partner sign-off', NUL), j('review', '{submittedBy, submittedAt, checkerId, decision, decidedAt}', { ...NUL, item: 'A14' }),
      s('naReason', 'Reason when Not Applicable'), s('supersededByTaskId', 'Rules §7.3', { ...NUL, ref: 'tasks' }), s('assignedTo', 'Maker', { ref: 'users' }), s('checkerId', 'Checker', { ref: 'users' }),
      n('budgetHours', 'Per-period budget'), j('statusHistory', 'Append-only status changes', R), j('dueHistory', 'Append-only due-date changes', R),
      s('createdAt', 'ISO timestamp', R), s('updatedAt', 'ISO timestamp', R), s('updatedBy', 'users.id', R),
    ],
    children: [
      {
        field: 'reviewPoints', table: 'task_review_points', item: 'A13', doc: 'Review points raised by the checker; open until cleared.',
        columns: [s('id', 'Primary key', R), s('text', 'The point', R), s('raisedBy', 'users.id', R), s('raisedAt', 'ISO timestamp', R), s('clearedBy', 'users.id', NUL), s('clearedAt', 'ISO timestamp', NUL)],
      },
      {
        field: 'checklist', table: 'task_checklist_items', item: 'Spec §10, A18', doc: 'Document checklist.',
        columns: [
          s('id', 'Primary key', R), s('name', 'Document', R), s('status', 'not_requested | requested | received | not_applicable', R),
          s('dateRequested', 'YYYY-MM-DD'), s('dateReceived', 'YYYY-MM-DD'), s('note', 'Note per item', { item: 'A18' }),
        ],
      },
      {
        field: 'followUps', table: 'task_follow_ups', item: 'Spec §10', doc: 'Reminder log of client follow-ups.',
        columns: [s('id', 'Primary key', R), s('at', 'YYYY-MM-DD', R), s('by', 'users.id', R), s('channel', 'call | email | whatsapp | other', R), s('notes', 'What was said', R)],
      },
    ],
  },
  {
    collection: 'entries', table: 'work_entries', key: ['id'], item: 'Spec §8, §38', doc: 'Work entries.',
    columns: [
      s('id', 'Primary key', R), s('userId', 'users.id', { ...R, ref: 'users' }), s('date', 'YYYY-MM-DD', R), s('clientId', 'clients.id', { ref: 'clients' }),
      s('engagementId', 'engagements.id', { ref: 'engagements' }), s('taskId', 'tasks.id', { ref: 'tasks' }), s('stage', 'Stage name'), s('internalCategory', 'Non-client category'),
      n('hours', '0–12 in 0.25 steps', R), s('description', 'What was done'), s('outcome', 'Outcome / acknowledgment'), s('location', 'office | client_site | wfh', R),
      s('clientSiteClientId', 'Client premises', { ref: 'clients' }), s('createdAt', 'ISO timestamp', R), s('updatedAt', 'ISO timestamp', R), s('modifiedBy', 'users.id', R),
    ],
  },
  {
    collection: 'extensions', table: 'extensions', key: ['id'], item: 'Spec §6, Rules §5', doc: 'Published due-date extensions; append-only, corrections supersede.',
    columns: [
      s('id', 'Primary key', R), s('complianceTypeCode', 'compliance_types.code', { ...R, ref: 'compliance_types' }), j('periodKeys', 'Periods covered', R),
      s('newDueDate', 'YYYY-MM-DD', R), s('reference', 'Notification / circular number', R), s('reason', 'Reason', R), s('status', 'published | superseded', R),
      s('supersedesId', 'Earlier extension this replaces', { ...NUL, ref: 'extensions' }), s('publishedAt', 'ISO timestamp', R), s('publishedBy', 'users.id', R), i('tasksMoved', 'Open tasks moved', R),
    ],
  },
  {
    collection: 'lockExtensions', table: 'lock_extensions', key: ['id'], item: 'Spec §21', doc: 'Partner extensions of the weekly lock.',
    columns: [s('id', 'Primary key', R), s('weekStart', 'Monday of the week', R), s('userId', 'null = everyone', { nullable: true, ref: 'users' }), s('until', 'ISO timestamp', R), s('reason', 'Reason', R), s('by', 'users.id', R), s('at', 'ISO timestamp', R)],
  },
  {
    collection: 'leaveRequests', table: 'leave_requests', key: ['id'], item: 'B2', doc: 'Leave applications and decisions.',
    columns: [
      s('id', 'Primary key', R), s('userId', 'users.id', { ...R, ref: 'users' }), s('leaveType', 'full_day | half_day | multiple_days', R), s('reason', 'personal | sick | holiday | exam_study | other', R),
      s('note', 'Note', R), s('startDate', 'YYYY-MM-DD', R), s('endDate', 'YYYY-MM-DD', R), s('halfDaySession', 'AM | PM', NUL), n('days', 'Leave days (0.5 steps)', R),
      s('status', 'pending | approved | rejected | cancelled', R), s('appliedAt', 'ISO timestamp', R), s('decidedBy', 'users.id', { ...NUL, ref: 'users' }), s('decidedAt', 'ISO timestamp', NUL),
      s('decisionNote', 'Approver note', NUL), j('conflictTaskIds', 'Tasks due during the leave, captured at decision', R), j('reassignments', '[{taskId, fromUserId, toUserId}]', R),
    ],
  },
  {
    collection: 'udinRegister', table: 'udin_register', key: ['id'], item: 'B3', doc: 'UDIN register for documents signed by a Partner.',
    columns: [
      s('id', 'Primary key', R), s('clientId', 'clients.id', { ...R, ref: 'clients' }), s('taskId', 'tasks.id', { ...NUL, ref: 'tasks' }), s('engagementId', 'engagements.id', { ...NUL, ref: 'engagements' }),
      s('institute', 'icai | icsi', R), s('documentType', 'e.g. "Statutory audit report"', R), s('dateOfSigning', 'YYYY-MM-DD', R), s('signingPartnerId', 'users.id', { ...R, ref: 'users' }),
      s('udin', 'UDIN, null while awaiting generation', NUL), s('dateGenerated', 'YYYY-MM-DD', NUL), s('signedCopyRef', 'attachments.id or physical reference', NUL),
      s('status', 'pending_generation | generated | reconciled', R), s('reconciledAt', 'ISO timestamp', NUL), s('reconciledBy', 'users.id', { ...NUL, ref: 'users' }), s('notes', 'Notes', R),
      s('createdAt', 'ISO timestamp', R), s('createdBy', 'users.id', R),
    ],
  },
  {
    collection: 'dscRegister', table: 'dsc_register', key: ['id'], item: 'B4, A16', doc: 'Digital signature certificates and their custody. PINs are never stored.',
    columns: [
      s('id', 'Primary key', R), s('holderName', 'Certificate holder', R), s('holderDirectorId', 'client_directors.id', { ...NUL, ref: 'client_directors' }), s('holderUserId', 'users.id if a firm member', { ...NUL, ref: 'users' }),
      j('clientIds', 'Linked clients', R), s('dscClass', 'class_3 | class_2', R), s('dscType', 'signing | encryption | combined', R), s('issuingAuthority', 'eMudhra, Capricorn, …', R),
      s('tokenSerial', 'USB token serial', NUL), s('issueDate', 'YYYY-MM-DD', R), s('expiryDate', 'YYYY-MM-DD', R), s('custody', 'in_office | with_client | with_staff', R),
      s('custodyLocation', 'Physical location', NUL), s('custodyUserId', 'users.id when with staff', { ...NUL, ref: 'users' }), b('active', 'In use', R), s('notes', 'Notes', R),
      s('createdAt', 'ISO timestamp', R), s('createdBy', 'users.id', R),
    ],
  },
  {
    collection: 'dscMovements', table: 'dsc_movements', key: ['id'], item: 'B4', doc: 'Every DSC movement in or out.', appendOnly: true,
    columns: [
      s('id', 'Primary key', R), s('dscId', 'dsc_register.id', { ...R, ref: 'dsc_register' }), s('from', 'Previous custody', R), s('to', 'New custody', R),
      s('toLocation', 'New location', NUL), s('toUserId', 'users.id', { ...NUL, ref: 'users' }), s('movedAt', 'ISO timestamp', R), s('handledBy', 'users.id', { ...R, ref: 'users' }),
      s('relatedTaskId', 'tasks.id', { ...NUL, ref: 'tasks' }), s('notes', 'Notes', R),
    ],
  },
  {
    collection: 'notices', table: 'notices', key: ['id'], item: 'B5', doc: 'Notices from tax and regulatory authorities; each is its own engagement + work item.',
    columns: [
      s('id', 'Primary key', R), s('clientId', 'clients.id', { ...R, ref: 'clients' }), s('engagementId', 'engagements.id', { ...R, ref: 'engagements' }), s('taskId', 'tasks.id', { ...R, ref: 'tasks' }),
      s('authority', 'income_tax | gst | tds_traces | mca_roc | other', R), s('period', '"AY 2026-27", "FY 2024-25"', R), s('noticeType', 'e.g. "Scrutiny"', R), s('section', 'e.g. "143(2)"', R),
      s('din', 'DIN / reference number', NUL), s('dateOfNotice', 'YYYY-MM-DD', NUL), s('dateReceived', 'YYYY-MM-DD', R), s('responseDueDate', 'YYYY-MM-DD', R),
      s('status', 'received | analysis | data_gathering | draft_response | review | submitted | hearing | adjourned | closed', R),
      s('outcome', 'favourable | partly_favourable | unfavourable | demand_dropped | pending', NUL), n('demandRaised', '₹', NUL), n('demandDropped', '₹', NUL),
      s('assignedTo', 'users.id', { ...NUL, ref: 'users' }), s('reviewerId', 'users.id', { ...NUL, ref: 'users' }),
      s('createdAt', 'ISO timestamp', R), s('createdBy', 'users.id', R), s('updatedAt', 'ISO timestamp', R), s('updatedBy', 'users.id', R),
    ],
    children: [
      {
        field: 'hearings', table: 'notice_hearings', item: 'B5', doc: 'Hearing and adjournment dates.',
        columns: [s('id', 'Primary key', R), s('date', 'YYYY-MM-DD', R), s('adjournedTo', 'YYYY-MM-DD', NUL), s('outcomeNote', 'What happened', R), s('attendedBy', 'users.id', NUL)],
      },
    ],
  },
  {
    collection: 'inwardOutward', table: 'inward_outward', key: ['id'], item: 'B6', doc: 'Physical documents received from or returned to clients.',
    columns: [
      s('id', 'Primary key', R), s('clientId', 'clients.id', { ...R, ref: 'clients' }), s('direction', 'inward | outward', R), s('date', 'YYYY-MM-DD', R),
      s('documentDescription', 'What the document is', R), s('documentType', 'Original / certified copy / …', NUL), s('counterpartyName', 'Who handed over / received at the client', R),
      s('handledBy', 'users.id', { ...R, ref: 'users' }), s('currentLocation', 'Where it is now', NUL), s('custodianUserId', 'users.id', { ...NUL, ref: 'users' }),
      s('linkedInwardId', 'Inward entry an outward entry returns', { ...NUL, ref: 'inward_outward' }), b('returned', 'Inward document returned', R), s('returnDueDate', 'YYYY-MM-DD', NUL),
      s('taskId', 'tasks.id', { ...NUL, ref: 'tasks' }), s('engagementId', 'engagements.id', { ...NUL, ref: 'engagements' }), s('notes', 'Notes', R), s('createdAt', 'ISO timestamp', R), s('createdBy', 'users.id', R),
    ],
  },
  {
    collection: 'notificationState', table: 'notification_state', key: ['id'], item: 'B7', doc: 'Read / dismissed state of computed in-app notifications.',
    columns: [s('id', '`${userId}|${notificationKey}`', R), s('userId', 'users.id', { ...R, ref: 'users' }), s('notificationKey', 'Deterministic key, e.g. "due:T-3:<taskId>"', R), s('readAt', 'ISO timestamp', NUL), s('dismissedAt', 'ISO timestamp', NUL)],
  },
  {
    collection: 'accessLog', table: 'access_log', key: ['id'], item: 'C5', doc: 'Every view of sensitive registers, notices, attachments and exports.', appendOnly: true,
    columns: [
      s('id', 'Primary key', R), s('at', 'ISO timestamp', R), s('userId', 'users.id', { ...R, ref: 'users' }),
      s('entity', 'udin_register | dsc_register | notice | inward_outward | attachment | export | backup | audit_trail', R), s('entityId', 'Record viewed', NUL),
      s('action', 'view | download | export | print', R), s('detail', 'Context', R),
    ],
  },
  {
    collection: 'attachments', table: 'attachments', key: ['id'], item: 'C7, E3', doc: 'File metadata; the file body is in IndexedDB (store "files", key blobKey).',
    columns: [
      s('id', 'Primary key', R), j('owner', '{entity, id} the file belongs to', R), s('fileName', 'Original file name', R), s('mimeType', 'MIME type', R), i('sizeBytes', 'Size', R),
      s('sha256', 'Hex digest of the body', R), s('blobKey', 'IndexedDB key', R), s('description', 'Description', R), s('uploadedBy', 'users.id', { ...R, ref: 'users' }), s('uploadedAt', 'ISO timestamp', R),
      s('deletedAt', 'Soft delete', NUL),
    ],
  },
  {
    collection: 'importBatches', table: 'import_batches', key: ['id'], item: 'B15', doc: 'Bulk imports with their validation results.',
    columns: [
      s('id', 'Primary key', R), s('kind', 'clients | users | client_teams', R), s('fileName', 'Uploaded file', R), s('uploadedBy', 'users.id', { ...R, ref: 'users' }), s('uploadedAt', 'ISO timestamp', R),
      s('status', 'validated | imported | failed | cancelled', R), i('rowCount', 'Rows in file', R), i('importedCount', 'Rows imported', R), i('errorCount', 'Rows with errors', R),
      j('errors', '[{row, field, message}]', R), j('createdIds', 'Records created', R), i('previewTaskCount', 'Tasks the import generates', R), s('importedAt', 'ISO timestamp', NUL),
    ],
  },
  {
    collection: 'audit', table: 'audit_log', key: ['id'], item: 'Spec §22, E5', doc: 'Audit trail of every change.', appendOnly: true,
    columns: [
      s('id', 'Primary key', R), s('at', 'ISO timestamp', R), s('by', 'users.id', R), s('entity', 'Record type', R), s('entityId', 'Record id', R), s('action', 'What happened', R),
      s('detail', 'Context'), j('changes', '[{field, from, to}]', { item: 'E5' }),
    ],
  },
];

/** Single-value settings stored in the key/value table `app_meta`. */
export const META_KEYS: { key: string; doc: string; item: string }[] = [
  { key: 'version', doc: 'Data version, kept from v4 (equals meta.schemaVersion)', item: 'E2' },
  { key: 'seededOn', doc: 'Date the demo data was generated', item: 'E7' },
  { key: 'meta', doc: '{schemaVersion, migrationsApplied[]}', item: 'E2' },
  { key: 'lockSettings', doc: '{dayOffset, time} weekly lock', item: 'Spec §21' },
  { key: 'settings', doc: 'UDIN pending window, pending-from-client alert days, session timeout, reminder timings', item: 'B3, B7, C1' },
];

export const snake = (f: string) => f.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
/** Quoted identifier — several column names (group, from, to, by, date) are SQL keywords. */
export const q = (name: string) => `"${name}"`;

const SQL_TYPE: Record<ColType, string> = { text: 'TEXT', integer: 'INTEGER', real: 'REAL', boolean: 'INTEGER', json: 'TEXT' };

export function ddl(): string {
  const out: string[] = ['PRAGMA foreign_keys = OFF;', 'CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);'];
  for (const t of TABLES) {
    const cols = t.columns.map((c) => `  ${q(snake(c.field))} ${SQL_TYPE[c.type]}${c.req ? ' NOT NULL' : ''}${c.ref && t.key.length === 1 && c.field !== t.key[0] ? ` REFERENCES ${c.ref}` : ''}`);
    cols.push('  extra_json TEXT');
    const pk = t.collection === 'users.auth' ? q('user_id') : t.key.map((k) => q(snake(k))).join(', ');
    out.push(`CREATE TABLE IF NOT EXISTS ${t.table} (\n${cols.join(',\n')},\n  PRIMARY KEY (${pk})\n);`);
    for (const c of t.columns) if (c.ref && !t.key.includes(c.field)) out.push(`CREATE INDEX IF NOT EXISTS ix_${t.table}_${snake(c.field)} ON ${t.table}(${q(snake(c.field))});`);
    for (const ch of t.children ?? []) {
      const ccols = ch.columns.map((c) => `  ${q(snake(c.field))} ${SQL_TYPE[c.type]}${c.req ? ' NOT NULL' : ''}`);
      const fk = `${snake(t.table.replace(/s$/, ''))}_id`;
      out.push(
        `CREATE TABLE IF NOT EXISTS ${ch.table} (\n  ${fk} TEXT NOT NULL REFERENCES ${t.table},\n  position INTEGER NOT NULL,\n${ccols.join(',\n')},\n  extra_json TEXT,\n  PRIMARY KEY (${fk}, id)\n);`,
      );
      out.push(`CREATE INDEX IF NOT EXISTS ix_${ch.table}_${fk} ON ${ch.table}(${fk}, position);`);
    }
  }
  return out.join('\n\n');
}

export const childFk = (t: TableSpec) => `${snake(t.table.replace(/s$/, ''))}_id`;
