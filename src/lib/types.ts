// Domain types. Names follow the V1 schema (qepex_schema.sql) in camelCase,
// simplified for an in-browser prototype: history/log tables are embedded
// arrays on their parent record instead of separate tables.

export type ISODate = string; // 'YYYY-MM-DD' (IST, no timezone handling per spec §3)
export type ISODateTime = string; // full ISO timestamp

export type Role = 'partner' | 'manager' | 'staff' | 'article' | 'admin';
export type WorkLocation = 'office' | 'client_site' | 'wfh';

export interface User {
  id: string;
  employeeCode: string;
  name: string;
  role: Role;
  designation: string; // e.g. "Senior", "CA Article Assistant"
  isSenior?: boolean;
  defaultLocation: WorkLocation;
  locationOverrideAllowed: boolean;
  joiningDate: ISODate;
  principalPartnerId?: string;
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
export type GstFrequency = 'monthly' | 'qrmp' | 'composition' | 'not_applicable';

// client_compliance_profile
export interface ComplianceProfile {
  gstFrequency: GstFrequency;
  gstAnnualReturn: boolean;
  gst9c: boolean;
  tds: boolean;
  advanceTax: boolean;
  taxAudit: boolean;
  statutoryAudit: boolean;
  transferPricing: boolean;
  pf: boolean;
  esi: boolean;
}

export type FlagKey = keyof ComplianceProfile | 'isCompany' | 'isLLP' | 'auditCase' | 'gstRegistered';

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
  pan?: string;
  tan?: string;
  gstins: string[];
  cin?: string; // CIN or LLPIN
  udyam?: string;
  fyEnd: string; // "31 Mar"
  agmDate?: ISODate;
  booksBy: 'firm' | 'client';
  partnerId: string;
  managerId?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  profile: ComplianceProfile;
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

export interface StageTemplate {
  code: string;
  name: string;
  stages: string[];
  filingStageIndex: number | null; // stage that requires an acknowledgment
  ackType: AckType | null;
  reviewLevel: string;
  checklist: string[]; // default document checklist
}

export type DueRule =
  | { kind: 'monthly'; day: number; marchOverride?: { month: number; day: number } }
  | { kind: 'quarterly'; dates: { month: number; day: number }[] } // one per FY quarter Q1..Q4
  | { kind: 'annual'; month: number; day: number } // first occurrence after FY end
  | { kind: 'event'; event: 'agm'; offsetDays: number };

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
  applicability: ApplicabilityRule[]; // all must match
  periodLabelStyle?: 'fy' | 'ay' | 'instalment';
  defaultBudgetHours: number; // per period
  isActive: boolean;
  isCustom?: boolean;
}

// extensions
export interface Extension {
  id: string;
  complianceTypeCode: string;
  periodKeys: string[];
  newDueDate: ISODate;
  reference: string;
  reason: string;
  publishedAt: ISODateTime;
  publishedBy: string;
  tasksMoved: number;
}

export type EngagementStatus = 'active' | 'on_hold' | 'completed' | 'archived';

export interface EngagementMember {
  userId: string;
  role: 'maker' | 'checker';
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
  originalDue: ISODate;
  effectiveDue: ISODate;
  provisional?: boolean;
  status: TaskStatus;
  stageIndex: number;
  pendingPeriods: PendingPeriod[];
  ack?: { type: AckType; number: string; date: ISODate };
  naReason?: string;
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

export interface AuditEvent {
  id: string;
  at: ISODateTime;
  by: string;
  entity: 'client' | 'engagement' | 'task' | 'entry' | 'due_date' | 'lock' | 'template' | 'team';
  entityId: string;
  action: string;
  detail?: string;
}

export interface DB {
  version: number;
  seededOn: ISODate;
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
  audit: AuditEvent[];
}

export type ExtensionInput = Omit<Extension, 'id' | 'publishedAt' | 'publishedBy' | 'tasksMoved'>;
