// Domain types — data schema version 5 (see SCHEMA_V5.md).
// Names follow the V1 schema (qepex_schema.sql) in camelCase. Each collection
// is stored as SQLite tables in the browser (src/lib/storage); nested arrays
// with their own ids become child tables, append-only histories are JSON columns.
// Item IDs in comments refer to the In-Code Change List (A*, B*, C*, E*).

export type ISODate = string; // 'YYYY-MM-DD' (IST, no timezone handling per spec §3)
export type ISODateTime = string; // full ISO timestamp

export type Role = 'partner' | 'manager' | 'staff' | 'article' | 'admin';
export type WorkLocation = 'office' | 'client_site' | 'wfh';

// C1 — credentials. Hash is PBKDF2-SHA256 via Web Crypto; plaintext is never stored.
export interface UserAuth {
  credentialKind: 'pin' | 'password';
  passwordHash: string | null; // base64
  passwordSalt: string | null; // base64, 16 random bytes
  hashIterations: number;
  mustChangePassword: boolean; // true while a temporary PIN issued by Admin is in use
  tempPinIssuedAt: ISODateTime | null;
  tempPinIssuedBy: string | null;
  failedAttempts: number;
  lockedUntil: ISODateTime | null;
  lastLoginAt: ISODateTime | null;
  totpSecret: string | null; // base32; set when the user enrols an authenticator app
  totpEnrolledAt: ISODateTime | null;
}

export interface User {
  id: string;
  employeeCode: string;
  name: string;
  role: Role;
  designation: string; // e.g. "Senior", "CA Article Assistant"
  isSenior?: boolean;
  email?: string;
  phone?: string;
  defaultLocation: WorkLocation; // A8
  locationOverrideAllowed: boolean; // A8
  joiningDate: ISODate;
  principalPartnerId?: string;
  active: boolean; // B1
  deactivatedOn: ISODate | null; // B1
  deactivatedBy: string | null;
  deactivationNote: string | null;
  auth: UserAuth; // C1
}

export type Constitution =
  | 'individual'
  | 'huf'
  | 'proprietorship'
  | 'partnership_firm'
  | 'llp'
  | 'private_company'
  | 'public_company'
  | 'trust'
  | 'society'
  | 'other';

export type ClientStatus = 'active' | 'dormant' | 'discontinued';
/** 'not_set' only appears on GSTINs migrated without a known frequency; generates nothing. */
export type GstFrequency = 'monthly' | 'qrmp' | 'composition' | 'not_set';

// A19 — one entry per GST registration, each with its own frequency and annual-return flags.
export interface GstRegistration {
  id: string;
  gstin: string;
  stateCode: string; // first two digits of the GSTIN, e.g. '27'
  state: string; // e.g. 'Maharashtra'
  frequency: GstFrequency;
  effectiveFrom: ISODate; // date the current frequency applies from
  frequencyHistory: { frequency: GstFrequency; effectiveFrom: ISODate; changedBy: string; changedAt: ISODateTime }[];
  gstAnnualReturn: boolean; // GSTR-9
  gst9c: boolean; // GSTR-9C
  iffOpted: boolean; // IFF for QRMP months 1–2 (Rules §1.2)
  status: 'active' | 'cancelled';
  cancelledOn: ISODate | null;
}

export type DirectorDesignation =
  | 'director'
  | 'managing_director'
  | 'whole_time_director'
  | 'independent_director'
  | 'designated_partner'
  | 'other';

// A20 — directors / designated partners; DIR-3 KYC is generated per director.
export interface Director {
  id: string;
  name: string;
  din: string; // 8 digits
  designation: DirectorDesignation;
  dscId: string | null; // link to dscRegister (B4, A16)
  appointedOn: ISODate | null;
  ceasedOn: ISODate | null;
  active: boolean;
}

// client_compliance_profile. GST settings moved to Client.gstins[] in v5.
export interface ComplianceProfile {
  tds: boolean; // gate for TDS/TCS payment
  tdsSalary: boolean; // Form 24Q
  tdsNonSalary: boolean; // Form 26Q
  tdsNonResident: boolean; // Form 27Q
  tcs: boolean; // Form 27EQ
  advanceTax: boolean;
  taxAudit: boolean;
  statutoryAudit: boolean;
  transferPricing: boolean; // Form 3CEB (A22)
  pf: boolean;
  esi: boolean;
}

export type FlagKey =
  | keyof ComplianceProfile
  | 'isCompany'
  | 'isLLP'
  | 'auditCase'
  | 'gstRegistered'
  // evaluated per GSTIN (A19)
  | 'gstFrequency'
  | 'gstAnnualReturn'
  | 'gst9c'
  | 'iffOpted';

export interface FlagChange {
  at: ISODateTime;
  by: string;
  flag: string;
  oldValue: string;
  newValue: string;
}

export interface Client {
  id: string;
  code: string; // CL-0142
  name: string;
  group?: string;
  constitution: Constitution;
  status: ClientStatus;
  statusEffectiveFrom: ISODate | null; // Rules §7.4–7.5
  pan?: string;
  tan?: string;
  gstins: GstRegistration[]; // A19 — replaces the v4 string[] of GSTINs
  cin?: string; // CIN or LLPIN
  udyam?: string;
  stateCode?: string; // principal place of business, for clients without a GSTIN
  fyEnd: string; // "31 Mar"
  agmDate?: ISODate;
  auditorAppointmentDate: ISODate | null; // ADT-1 (A23)
  booksBy: 'firm' | 'client';
  partnerId: string;
  managerId?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  profile: ComplianceProfile;
  directors: Director[]; // A20
  /** compliance type code → date generation starts (Rules §3.3). */
  complianceStartDates: Record<string, ISODate>;
  flagHistory: FlagChange[];
  createdAt: ISODateTime;
  createdBy: string;
  updatedAt: ISODateTime;
  updatedBy: string;
}

// client_team_assignments
export interface TeamAssignment {
  clientId: string;
  userId: string;
  role: 'staff' | 'reviewer';
}

export type ServiceLine = 'accounting' | 'audit' | 'direct_tax' | 'gst' | 'company_law' | 'advisory';

export type AckType = 'arn' | 'srn' | 'itr_ack' | 'challan' | 'token' | 'udin' | 'other';

export interface TemplateVersion {
  version: number;
  name: string;
  stages: string[];
  checklist: string[];
  filingStageIndex: number | null;
  ackType: AckType | null;
  reviewLevel: string;
  effectiveFrom: ISODateTime;
  createdBy: string;
  note: string;
}

export interface StageTemplate {
  code: string;
  name: string;
  family?: 'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6';
  stages: string[];
  filingStageIndex: number | null; // stage that requires an acknowledgment
  ackType: AckType | null;
  reviewLevel: string;
  checklist: string[]; // default document checklist
  requiresSignoff: boolean; // F4 and the DSC-signing step of F5 (Rules §8)
  requiresUdin: boolean;
  version: number; // A27 — current version; new tasks use it
  versions: TemplateVersion[]; // A27 — full history, oldest first
}

export type DueRule =
  | { kind: 'monthly'; day: number; marchOverride?: { month: number; day: number }; quarterMonths?: number[] } // quarterMonths: IFF = [1, 2]
  | { kind: 'quarterly'; dates: { month: number; day: number }[] } // one per FY quarter Q1..Q4
  | { kind: 'annual'; month: number; day: number } // first occurrence after FY end
  | { kind: 'event'; event: 'agm' | 'auditor_appointment'; offsetDays: number };

export interface ApplicabilityRule {
  flag: FlagKey;
  value: string; // 'true' | 'false' | gst frequency value
}

// compliance_types — the Due-Date Master
export interface ComplianceType {
  code: string;
  name: string;
  shortName: string;
  serviceLine: ServiceLine;
  engagementGroup: string; // recurring engagement this rolls up into, e.g. "GST Returns"
  templateCode: string;
  frequency: 'monthly' | 'quarterly' | 'annual' | 'event_based';
  rule: DueRule;
  /** Annual types only: alternative due date when a flag holds (ITR-A → 30 Nov with 3CEB). */
  dueVariants?: { when: ApplicabilityRule; month: number; day: number }[];
  applicability: ApplicabilityRule[]; // all must match
  /** Where one task is generated: per client, per GSTIN (A19) or per director (A20). */
  scope: 'client' | 'gstin' | 'director';
  periodLabelStyle?: 'fy' | 'ay' | 'instalment';
  defaultBudgetHours: number; // per period
  isActive: boolean;
  isCustom?: boolean;
  retired?: boolean; // kept for history, never generates (v4 TDS_RET)
  replacedBy?: string[];
  illustrative: boolean; // A23 — "illustrative, verify before go-live"
  verifiedBy: string | null;
  verifiedAt: ISODateTime | null;
}

// extensions (Rules §5). Scope filters by state/class are A25 (Version 2).
export interface Extension {
  id: string;
  complianceTypeCode: string;
  periodKeys: string[];
  newDueDate: ISODate;
  reference: string;
  reason: string;
  status: 'published' | 'superseded';
  supersedesId: string | null;
  publishedAt: ISODateTime;
  publishedBy: string;
  tasksMoved: number;
}

export type EngagementStatus = 'active' | 'on_hold' | 'completed' | 'archived';

export interface EngagementMember {
  userId: string;
  role: 'maker' | 'checker';
}

// A29 — captured now so V2 billing has history.
export interface FeeBasis {
  type: 'fixed' | 'recurring' | 'time';
  amount: number | null; // fixed fee, or retainer per period (₹, excl. GST)
  rate: number | null; // ₹ per hour, time-based only
  retainerPeriod: 'monthly' | 'quarterly' | 'annual' | null;
}

export interface Engagement {
  id: string;
  clientId: string;
  serviceLine: ServiceLine;
  type: 'recurring' | 'one_time';
  title: string;
  financialYear?: string; // "FY 2026-27"
  templateCode: string;
  status: EngagementStatus;
  partnerId: string;
  managerId?: string;
  team: EngagementMember[];
  budgetHours?: number; // one-time: total; recurring: per period (see task.budgetHours)
  billable: boolean; // set by Partner — never shown to Staff/Article
  feeBasis: FeeBasis | null; // A29 — null = not set
  startDate?: ISODate;
  endDate?: ISODate;
  createdAt: ISODateTime;
  createdBy: string;
}

export type TaskStatus =
  | 'upcoming'
  | 'in_progress'
  | 'pending_from_client'
  | 'under_review'
  | 'filed'
  | 'filed_late'
  | 'not_applicable';

export type ChecklistStatus = 'requested' | 'received' | 'not_applicable' | 'not_requested';

export interface ChecklistItem {
  id: string;
  name: string;
  status: ChecklistStatus;
  dateRequested?: ISODate;
  dateReceived?: ISODate;
  note?: string; // A18
}

export interface FollowUp {
  id: string;
  at: ISODate;
  by: string;
  channel: 'call' | 'email' | 'whatsapp' | 'other';
  notes: string;
}

export interface PendingPeriod {
  from: ISODateTime;
  to?: ISODateTime;
  what: string;
}

export interface StatusChange {
  at: ISODateTime;
  by: string;
  from: TaskStatus | null;
  to: TaskStatus;
  note?: string;
}

export interface DueChange {
  at: ISODateTime;
  by: string;
  from: ISODate;
  to: ISODate;
  source: 'extension' | 'master_change' | 'event_correction' | 'manual_correction';
  reference?: string;
}

// A13 — review points tracked individually.
export interface ReviewPoint {
  id: string;
  text: string;
  raisedBy: string;
  raisedAt: ISODateTime;
  clearedBy: string | null;
  clearedAt: ISODateTime | null;
}

// A14 — the latest maker–checker cycle on the task.
export interface ReviewState {
  submittedBy: string;
  submittedAt: ISODateTime;
  checkerId: string;
  decision: 'approved' | 'returned' | null;
  decidedAt: ISODateTime | null;
}

export interface SignOff {
  by: string; // Partner
  at: ISODateTime;
  udinId: string | null; // udinRegister id (B3)
}

// compliance_tasks (plus a 'work item' for one-time engagements so that stages,
// pending-from-client and checklists work identically for both)
export interface Task {
  id: string;
  clientId: string;
  engagementId: string;
  kind: 'compliance' | 'engagement';
  complianceTypeCode?: string;
  periodKey?: string;
  periodLabel: string;
  title: string;
  templateCode: string;
  templateVersion: number; // A27
  gstinId: string | null; // A19 — set for per-GSTIN types
  directorId: string | null; // A20 — set for per-director types
  originalDue: ISODate;
  effectiveDue: ISODate;
  provisional?: boolean;
  status: TaskStatus;
  stageIndex: number;
  pendingPeriods: PendingPeriod[];
  ack?: { type: AckType; number: string; date: ISODate };
  signoff: SignOff | null;
  review: ReviewState | null; // A14
  reviewPoints: ReviewPoint[]; // A13
  naReason?: string;
  supersededByTaskId: string | null; // Rules §7.3
  assignedTo?: string;
  checkerId?: string;
  budgetHours?: number;
  checklist: ChecklistItem[];
  followUps: FollowUp[];
  statusHistory: StatusChange[];
  dueHistory: DueChange[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  updatedBy: string;
}

export type InternalCategory =
  | 'internal_meeting'
  | 'training_cpe'
  | 'articleship_classes'
  | 'practice_administration'
  | 'business_development'
  | 'knowledge_updates'
  | 'leave'
  | 'other';

// work_entries
export interface WorkEntry {
  id: string;
  userId: string;
  date: ISODate;
  clientId?: string;
  engagementId?: string;
  taskId?: string;
  stage?: string;
  internalCategory?: InternalCategory;
  hours: number; // 0–12 in 0.25 steps
  description?: string;
  outcome?: string;
  location: WorkLocation;
  clientSiteClientId?: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  modifiedBy: string;
}

// weekly_locks (firm setting + Partner extensions)
export interface LockSettings {
  dayOffset: number; // days after the week's Monday: 6 = that Sunday, 7 = next Monday
  time: string; // "16:00"
}

export interface LockExtension {
  id: string;
  weekStart: ISODate;
  userId: string | null; // null = everyone
  until: ISODateTime;
  reason: string;
  by: string;
  at: ISODateTime;
}

// ---------- New collections in v5 ----------

// B2
export interface LeaveRequest {
  id: string;
  userId: string;
  leaveType: 'full_day' | 'half_day' | 'multiple_days';
  reason: 'personal' | 'sick' | 'holiday' | 'exam_study' | 'other';
  note: string;
  startDate: ISODate;
  endDate: ISODate;
  halfDaySession: 'AM' | 'PM' | null;
  days: number; // 0.5 steps; counts against articleship entitlement in V2 (B8)
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  appliedAt: ISODateTime;
  decidedBy: string | null;
  decidedAt: ISODateTime | null;
  decisionNote: string | null;
  conflictTaskIds: string[]; // tasks due during the leave, captured when decided
  reassignments: { taskId: string; fromUserId: string; toUserId: string }[];
}

// B3
export interface UdinRecord {
  id: string;
  clientId: string;
  taskId: string | null;
  engagementId: string | null;
  institute: 'icai' | 'icsi';
  documentType: string; // e.g. "Statutory audit report", "Net worth certificate"
  dateOfSigning: ISODate;
  signingPartnerId: string;
  udin: string | null; // null while awaiting generation
  dateGenerated: ISODate | null;
  signedCopyRef: string | null; // attachment id or physical-file reference
  status: 'pending_generation' | 'generated' | 'reconciled';
  reconciledAt: ISODateTime | null;
  reconciledBy: string | null;
  notes: string;
  createdAt: ISODateTime;
  createdBy: string;
}

export type DscCustody = 'in_office' | 'with_client' | 'with_staff';

// B4 — PINs are never stored.
export interface DscRecord {
  id: string;
  holderName: string;
  holderDirectorId: string | null; // A20 link when the holder is a client's director
  holderUserId: string | null; // when the holder is a firm member
  clientIds: string[];
  dscClass: 'class_3' | 'class_2';
  dscType: 'signing' | 'encryption' | 'combined';
  issuingAuthority: string; // e.g. "eMudhra", "Capricorn", "(n)Code"
  tokenSerial: string | null;
  issueDate: ISODate;
  expiryDate: ISODate;
  custody: DscCustody;
  custodyLocation: string | null; // "DSC cabinet, drawer 2"
  custodyUserId: string | null; // with_staff
  active: boolean;
  notes: string;
  createdAt: ISODateTime;
  createdBy: string;
}

export interface DscMovement {
  id: string;
  dscId: string;
  from: DscCustody;
  to: DscCustody;
  toLocation: string | null;
  toUserId: string | null;
  movedAt: ISODateTime;
  handledBy: string;
  relatedTaskId: string | null;
  notes: string;
}

export type NoticeStatus = 'received' | 'analysis' | 'data_gathering' | 'draft_response' | 'review' | 'submitted' | 'hearing' | 'adjourned' | 'closed';

// B5 — each notice is tracked as its own engagement (+ work item task).
export interface Notice {
  id: string;
  clientId: string;
  engagementId: string;
  taskId: string;
  authority: 'income_tax' | 'gst' | 'tds_traces' | 'mca_roc' | 'other';
  period: string; // "AY 2026-27", "FY 2024-25", "Jul 2025"
  noticeType: string; // "Intimation", "Scrutiny", "ASMT-10"
  section: string; // "143(1)(a)", "148", "73"
  din: string | null; // DIN / reference number
  dateOfNotice: ISODate | null;
  dateReceived: ISODate;
  responseDueDate: ISODate;
  hearings: { id: string; date: ISODate; adjournedTo: ISODate | null; outcomeNote: string; attendedBy: string | null }[];
  status: NoticeStatus;
  outcome: 'favourable' | 'partly_favourable' | 'unfavourable' | 'demand_dropped' | 'pending' | null;
  demandRaised: number | null; // ₹
  demandDropped: number | null; // ₹
  assignedTo: string | null;
  reviewerId: string | null;
  createdAt: ISODateTime;
  createdBy: string;
  updatedAt: ISODateTime;
  updatedBy: string;
}

// B6
export interface InwardOutward {
  id: string;
  clientId: string;
  direction: 'inward' | 'outward';
  date: ISODate;
  documentDescription: string;
  documentType: string | null; // "Original", "Certified copy", "Bank statement"
  counterpartyName: string; // who handed over / received at the client
  handledBy: string; // firm user
  currentLocation: string | null;
  custodianUserId: string | null; // B1 offboarding custody check
  linkedInwardId: string | null; // outward entry that returns an inward document
  returned: boolean; // inward only
  returnDueDate: ISODate | null;
  taskId: string | null;
  engagementId: string | null;
  notes: string;
  createdAt: ISODateTime;
  createdBy: string;
}

// B7 — notifications are computed from data; only read/dismissed state is stored.
export interface NotificationState {
  id: string; // `${userId}|${notificationKey}`
  userId: string;
  notificationKey: string; // deterministic, e.g. 'due:T-3:<taskId>'
  readAt: ISODateTime | null;
  dismissedAt: ISODateTime | null;
}

// C5 — append-only sensitive-view log.
export interface AccessLogEntry {
  id: string;
  at: ISODateTime;
  userId: string;
  entity: 'udin_register' | 'dsc_register' | 'notice' | 'inward_outward' | 'attachment' | 'export' | 'backup' | 'audit_trail';
  entityId: string | null;
  action: 'view' | 'download' | 'export' | 'print';
  detail: string;
}

// C7 / E3 — metadata only; file bodies live in IndexedDB under blobKey.
export interface Attachment {
  id: string;
  owner: { entity: 'task' | 'notice' | 'udin' | 'dsc' | 'inward_outward' | 'leave' | 'engagement' | 'client'; id: string };
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string; // hex
  blobKey: string;
  description: string;
  uploadedBy: string;
  uploadedAt: ISODateTime;
  deletedAt: ISODateTime | null;
}

// B15
export interface ImportBatch {
  id: string;
  kind: 'clients' | 'users' | 'client_teams';
  fileName: string;
  uploadedBy: string;
  uploadedAt: ISODateTime;
  status: 'validated' | 'imported' | 'failed' | 'cancelled';
  rowCount: number;
  importedCount: number;
  errorCount: number;
  errors: { row: number; field: string; message: string }[];
  createdIds: string[];
  previewTaskCount: number; // tasks the import would generate (shown before import)
  importedAt: ISODateTime | null;
}

export interface Settings {
  udinPendingDays: number; // B3 — "Awaiting UDIN" after this many days
  pendingFromClientAlertDays: number; // B7 / Rules §9
  pendingFollowUpEveryDays: number;
  sessionTimeoutMinutes: number; // C1
  reminderLeadDays: number[]; // 7 / 3 / 1
  escalateToManagerAfterDays: number;
  escalateToPartnerAfterDays: number;
  reviewSlaDays: number;
  dscExpiryAlertDays: number[]; // 30 / 7
  noticeReminderDays: number[]; // 7 / 3 / 1
  agmCeilingMonths: number; // Rules §4.2
  attachmentMaxBytes: number; // C7
  pinMinLength: number; // C1
  maxFailedLogins: number; // C1
}

export interface AuditEvent {
  id: string;
  at: ISODateTime;
  by: string;
  entity:
    | 'client'
    | 'engagement'
    | 'task'
    | 'entry'
    | 'due_date'
    | 'lock'
    | 'template'
    | 'team'
    | 'user'
    | 'leave'
    | 'udin'
    | 'dsc'
    | 'notice'
    | 'inward_outward'
    | 'notification'
    | 'attachment'
    | 'import'
    | 'settings'
    | 'system';
  entityId: string;
  action: string;
  detail?: string;
  changes?: { field: string; from: string; to: string }[]; // E5 — field-level diff
}

export interface MigrationRecord {
  id: string; // e.g. 'v4_to_v5'
  from: number;
  to: number;
  at: ISODateTime;
  summary: string;
}

export interface Meta {
  schemaVersion: number;
  migrationsApplied: MigrationRecord[];
}

export interface DB {
  version: number; // kept from v4; always equals meta.schemaVersion
  seededOn: ISODate;
  meta: Meta;
  users: User[];
  clients: Client[];
  clientTeam: TeamAssignment[];
  complianceTypes: ComplianceType[];
  templates: StageTemplate[];
  engagements: Engagement[];
  tasks: Task[];
  entries: WorkEntry[];
  extensions: Extension[];
  lockSettings: LockSettings;
  lockExtensions: LockExtension[];
  settings: Settings;
  leaveRequests: LeaveRequest[];
  udinRegister: UdinRecord[];
  dscRegister: DscRecord[];
  dscMovements: DscMovement[];
  notices: Notice[];
  inwardOutward: InwardOutward[];
  notificationState: NotificationState[];
  accessLog: AccessLogEntry[];
  attachments: Attachment[];
  importBatches: ImportBatch[];
  audit: AuditEvent[];
}

export type ExtensionInput = Omit<Extension, 'id' | 'publishedAt' | 'publishedBy' | 'tasksMoved' | 'status' | 'supersedesId'> & {
  supersedesId?: string | null;
};
