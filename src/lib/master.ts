import type {
  ComplianceType,
  Constitution,
  InternalCategory,
  Role,
  ServiceLine,
  StageTemplate,
  TaskStatus,
  WorkLocation,
  AckType,
  GstFrequency,
  FlagKey,
} from './types';

export const ROLE_LABEL: Record<Role, string> = {
  partner: 'Partner',
  manager: 'Manager',
  staff: 'Staff / Senior',
  article: 'Article Assistant',
  admin: 'Practice Admin',
};

export const CONSTITUTION_LABEL: Record<Constitution, string> = {
  individual: 'Individual',
  huf: 'HUF',
  proprietorship: 'Proprietorship',
  partnership_firm: 'Partnership Firm',
  llp: 'LLP',
  private_company: 'Private Company',
  public_company: 'Public Company',
  trust: 'Trust',
  society: 'Society',
  other: 'Other',
};

export const SERVICE_LINE_LABEL: Record<ServiceLine, string> = {
  accounting: 'Accounting',
  audit: 'Audit & Assurance',
  direct_tax: 'Direct Tax',
  gst: 'Indirect Tax (GST)',
  company_law: 'Company Law & Secretarial',
  advisory: 'Advisory & Other',
};

export const STATUS_LABEL: Record<TaskStatus, string> = {
  upcoming: 'Upcoming',
  in_progress: 'In Progress',
  pending_from_client: 'Pending from Client',
  under_review: 'Under Review',
  filed: 'Filed',
  filed_late: 'Filed Late',
  not_applicable: 'Not Applicable',
};

export const OPEN_STATUSES: TaskStatus[] = ['upcoming', 'in_progress', 'pending_from_client', 'under_review'];
export const isOpen = (s: TaskStatus) => OPEN_STATUSES.includes(s);
export const isFiled = (s: TaskStatus) => s === 'filed' || s === 'filed_late';

export const LOCATION_LABEL: Record<WorkLocation, string> = {
  office: 'Office',
  client_site: 'Client Site',
  wfh: 'Work From Home',
};

export const INTERNAL_LABEL: Record<InternalCategory, string> = {
  internal_meeting: 'Internal Meeting',
  training_cpe: 'Training & CPE',
  articleship_classes: 'Articleship Classes / Exam Leave',
  practice_administration: 'Practice Administration',
  business_development: 'Business Development',
  knowledge_updates: 'Knowledge Updates',
  leave: 'Leave',
  other: 'Other',
};

export const ACK_LABEL: Record<AckType, string> = {
  arn: 'ARN',
  srn: 'SRN',
  itr_ack: 'ITR Acknowledgment No.',
  challan: 'Challan (CIN)',
  token: 'Token No.',
  udin: 'UDIN',
  other: 'Acknowledgment No.',
};

export const GST_FREQ_LABEL: Record<GstFrequency, string> = {
  not_applicable: 'Not registered',
  monthly: 'Monthly',
  qrmp: 'QRMP (quarterly)',
  composition: 'Composition',
};

export const FLAG_LABEL: Record<FlagKey, string> = {
  gstFrequency: 'GST filing frequency',
  gstRegistered: 'GST registered',
  gstAnnualReturn: 'GSTR-9 annual return',
  gst9c: 'GSTR-9C reconciliation',
  tds: 'TDS / TCS',
  advanceTax: 'Advance tax',
  taxAudit: 'Tax audit (44AB)',
  statutoryAudit: 'Statutory audit',
  transferPricing: 'Transfer pricing',
  pf: 'PF',
  esi: 'ESI',
  isCompany: 'Company (ROC filings)',
  isLLP: 'LLP (ROC filings)',
  auditCase: 'Audit case for ITR',
};

export const DESCRIPTION_CHIPS = [
  'Data entry',
  'Reconciliation',
  'Vouching',
  'Computation',
  'Client call',
  'Portal filing',
  'Query resolution',
  'Drafting reply',
];

export const DEFAULT_TEMPLATES: StageTemplate[] = [
  {
    code: 'gst_return',
    name: 'GST return',
    stages: ['Data Requested', 'Data Received', '2B/Books Reconciliation', 'Preparation', 'Client Approval', 'Filed (ARN)'],
    filingStageIndex: 5,
    ackType: 'arn',
    reviewLevel: 'Senior or Manager',
    checklist: ['Sales register', 'Purchase register', 'Credit / debit notes', 'Bank statement', 'E-way bill summary'],
  },
  {
    code: 'itr',
    name: 'Income tax return',
    stages: ['Documents Requested', 'Data Received', 'Computation', 'Review', 'Client Approval', 'Filed', 'E-verified'],
    filingStageIndex: 5,
    ackType: 'itr_ack',
    reviewLevel: 'Manager',
    checklist: ['Form 16', 'AIS / TIS', 'Bank statements', 'Capital gains statements', 'Investment proofs (80C / 80D)'],
  },
  {
    code: 'tds_return',
    name: 'TDS return',
    stages: ['Data Received', 'Challan Matching', 'Preparation', 'Review', 'Filed', 'Certificates Issued'],
    filingStageIndex: 4,
    ackType: 'token',
    reviewLevel: 'Senior or Manager',
    checklist: ['Challan details', 'Deductee PAN list', 'Salary / payment register', 'Lower deduction certificates'],
  },
  {
    code: 'tax_payment',
    name: 'Tax / statutory payment',
    stages: ['Data Requested', 'Data Received', 'Computation', 'Review', 'Challan Paid'],
    filingStageIndex: 4,
    ackType: 'challan',
    reviewLevel: 'Senior',
    checklist: ['Payment / salary register', 'Vendor invoices', 'Previous challans'],
  },
  {
    code: 'audit',
    name: 'Statutory / tax audit',
    stages: [
      'Planning',
      'Risk Assessment',
      'Fieldwork / Vouching',
      'Queries to Client',
      'Manager Review',
      'Partner Review',
      'Report Signed (UDIN)',
    ],
    filingStageIndex: 6,
    ackType: 'udin',
    reviewLevel: 'Partner sign-off',
    checklist: ['Trial balance', 'General ledger', 'Bank statements & confirmations', 'Fixed asset register', 'Stock statements', 'Board minutes'],
  },
  {
    code: 'bookkeeping',
    name: 'Bookkeeping',
    stages: ['Data Received', 'Entry', 'Bank Reconciliation', 'Review', 'MIS / Finalization'],
    filingStageIndex: null,
    ackType: null,
    reviewLevel: 'Senior',
    checklist: ['Bank statements', 'Sales invoices', 'Purchase bills', 'Expense vouchers'],
  },
  {
    code: 'roc',
    name: 'ROC annual filing',
    stages: ['Financials Received', 'Board / AGM Documents', 'Form Preparation', 'DSC Signing', 'Filed (SRN)', 'Approved'],
    filingStageIndex: 4,
    ackType: 'srn',
    reviewLevel: 'Manager',
    checklist: ['Signed financial statements', 'Board resolution', 'AGM notice & minutes', 'Director DSCs', "Auditor's report"],
  },
  {
    code: 'notice',
    name: 'Notice / assessment',
    stages: ['Notice Received', 'Analysis', 'Data Gathering', 'Draft Response', 'Review', 'Submitted', 'Hearing', 'Closed'],
    filingStageIndex: 5,
    ackType: 'other',
    reviewLevel: 'Partner',
    checklist: ['Notice copy', 'Relevant returns', 'Supporting documents', 'Authorisation letter'],
  },
  {
    code: 'other',
    name: 'Other',
    stages: ['Planning', 'Work in Progress', 'Review', 'Completed'],
    filingStageIndex: null,
    ackType: null,
    reviewLevel: 'Manager',
    checklist: [],
  },
];

const q = (a: [number, number], b: [number, number], c: [number, number], d: [number, number]) =>
  [a, b, c, d].map(([month, day]) => ({ month, day }));

// Illustrative defaults from spec §6 — to be verified against current law before go-live.
export const DEFAULT_COMPLIANCE_TYPES: ComplianceType[] = [
  {
    code: 'GSTR1_M', name: 'GSTR-1 (monthly filers)', shortName: 'GSTR-1', serviceLine: 'gst', engagementGroup: 'GST Returns',
    templateCode: 'gst_return', frequency: 'monthly', rule: { kind: 'monthly', day: 11 },
    applicability: [{ flag: 'gstFrequency', value: 'monthly' }], defaultBudgetHours: 3, isActive: true,
  },
  {
    code: 'GSTR3B_M', name: 'GSTR-3B (monthly filers)', shortName: 'GSTR-3B', serviceLine: 'gst', engagementGroup: 'GST Returns',
    templateCode: 'gst_return', frequency: 'monthly', rule: { kind: 'monthly', day: 20 },
    applicability: [{ flag: 'gstFrequency', value: 'monthly' }], defaultBudgetHours: 4, isActive: true,
  },
  {
    code: 'GSTR1_Q', name: 'GSTR-1 / IFF (QRMP)', shortName: 'GSTR-1 (QRMP)', serviceLine: 'gst', engagementGroup: 'GST Returns',
    templateCode: 'gst_return', frequency: 'quarterly', rule: { kind: 'quarterly', dates: q([7, 13], [10, 13], [1, 13], [4, 13]) },
    applicability: [{ flag: 'gstFrequency', value: 'qrmp' }], defaultBudgetHours: 3, isActive: true,
  },
  {
    code: 'GSTR3B_Q', name: 'GSTR-3B (QRMP)', shortName: 'GSTR-3B (QRMP)', serviceLine: 'gst', engagementGroup: 'GST Returns',
    templateCode: 'gst_return', frequency: 'quarterly', rule: { kind: 'quarterly', dates: q([7, 22], [10, 22], [1, 22], [4, 22]) },
    applicability: [{ flag: 'gstFrequency', value: 'qrmp' }], defaultBudgetHours: 4, isActive: true,
  },
  {
    code: 'CMP08', name: 'CMP-08 (composition)', shortName: 'CMP-08', serviceLine: 'gst', engagementGroup: 'GST Returns',
    templateCode: 'gst_return', frequency: 'quarterly', rule: { kind: 'quarterly', dates: q([7, 18], [10, 18], [1, 18], [4, 18]) },
    applicability: [{ flag: 'gstFrequency', value: 'composition' }], defaultBudgetHours: 2, isActive: true,
  },
  {
    code: 'GSTR9', name: 'GSTR-9 annual return', shortName: 'GSTR-9', serviceLine: 'gst', engagementGroup: 'GST Annual Return',
    templateCode: 'gst_return', frequency: 'annual', rule: { kind: 'annual', month: 12, day: 31 },
    applicability: [{ flag: 'gstAnnualReturn', value: 'true' }], defaultBudgetHours: 10, isActive: true,
  },
  {
    code: 'GSTR9C', name: 'GSTR-9C reconciliation', shortName: 'GSTR-9C', serviceLine: 'gst', engagementGroup: 'GST Annual Return',
    templateCode: 'gst_return', frequency: 'annual', rule: { kind: 'annual', month: 12, day: 31 },
    applicability: [{ flag: 'gst9c', value: 'true' }], defaultBudgetHours: 12, isActive: true,
  },
  {
    code: 'TDS_PAY', name: 'TDS/TCS payment', shortName: 'TDS payment', serviceLine: 'direct_tax', engagementGroup: 'TDS Compliance',
    templateCode: 'tax_payment', frequency: 'monthly', rule: { kind: 'monthly', day: 7, marchOverride: { month: 4, day: 30 } },
    applicability: [{ flag: 'tds', value: 'true' }], defaultBudgetHours: 1.5, isActive: true,
  },
  {
    code: 'TDS_RET', name: 'TDS/TCS quarterly return', shortName: 'TDS return', serviceLine: 'direct_tax', engagementGroup: 'TDS Compliance',
    templateCode: 'tds_return', frequency: 'quarterly', rule: { kind: 'quarterly', dates: q([7, 31], [10, 31], [1, 31], [5, 31]) },
    applicability: [{ flag: 'tds', value: 'true' }], defaultBudgetHours: 5, isActive: true,
  },
  {
    code: 'ADV_TAX', name: 'Advance tax instalment', shortName: 'Advance tax', serviceLine: 'direct_tax', engagementGroup: 'Income Tax',
    templateCode: 'tax_payment', frequency: 'quarterly', rule: { kind: 'quarterly', dates: q([6, 15], [9, 15], [12, 15], [3, 15]) },
    applicability: [{ flag: 'advanceTax', value: 'true' }], periodLabelStyle: 'instalment', defaultBudgetHours: 2, isActive: true,
  },
  {
    code: 'ITR_NA', name: 'ITR — non-audit cases', shortName: 'ITR', serviceLine: 'direct_tax', engagementGroup: 'Income Tax',
    templateCode: 'itr', frequency: 'annual', rule: { kind: 'annual', month: 7, day: 31 },
    applicability: [{ flag: 'auditCase', value: 'false' }], periodLabelStyle: 'ay', defaultBudgetHours: 5, isActive: true,
  },
  {
    code: 'TAR', name: 'Tax audit report (3CA/3CB-3CD)', shortName: 'Tax audit report', serviceLine: 'audit', engagementGroup: 'Tax Audit',
    templateCode: 'audit', frequency: 'annual', rule: { kind: 'annual', month: 9, day: 30 },
    applicability: [{ flag: 'taxAudit', value: 'true' }], defaultBudgetHours: 30, isActive: true,
  },
  {
    code: 'STAT_AUDIT', name: 'Statutory audit report', shortName: 'Statutory audit', serviceLine: 'audit', engagementGroup: 'Statutory Audit',
    templateCode: 'audit', frequency: 'annual', rule: { kind: 'annual', month: 9, day: 1 },
    applicability: [{ flag: 'statutoryAudit', value: 'true' }], defaultBudgetHours: 60, isActive: true,
  },
  {
    code: 'ITR_A', name: 'ITR — audit cases', shortName: 'ITR (audit)', serviceLine: 'direct_tax', engagementGroup: 'Income Tax',
    templateCode: 'itr', frequency: 'annual', rule: { kind: 'annual', month: 10, day: 31 },
    applicability: [{ flag: 'auditCase', value: 'true' }], periodLabelStyle: 'ay', defaultBudgetHours: 8, isActive: true,
  },
  {
    code: 'AOC4', name: 'AOC-4 (financial statements)', shortName: 'AOC-4', serviceLine: 'company_law', engagementGroup: 'ROC Annual Filing',
    templateCode: 'roc', frequency: 'event_based', rule: { kind: 'event', event: 'agm', offsetDays: 30 },
    applicability: [{ flag: 'isCompany', value: 'true' }], defaultBudgetHours: 4, isActive: true,
  },
  {
    code: 'MGT7', name: 'MGT-7 / 7A (annual return)', shortName: 'MGT-7', serviceLine: 'company_law', engagementGroup: 'ROC Annual Filing',
    templateCode: 'roc', frequency: 'event_based', rule: { kind: 'event', event: 'agm', offsetDays: 60 },
    applicability: [{ flag: 'isCompany', value: 'true' }], defaultBudgetHours: 3, isActive: true,
  },
  {
    code: 'DIR3', name: 'DIR-3 KYC', shortName: 'DIR-3 KYC', serviceLine: 'company_law', engagementGroup: 'ROC Annual Filing',
    templateCode: 'roc', frequency: 'annual', rule: { kind: 'annual', month: 9, day: 30 },
    applicability: [{ flag: 'isCompany', value: 'true' }], defaultBudgetHours: 1, isActive: true,
  },
  {
    code: 'DPT3', name: 'DPT-3 (return of deposits)', shortName: 'DPT-3', serviceLine: 'company_law', engagementGroup: 'ROC Annual Filing',
    templateCode: 'roc', frequency: 'annual', rule: { kind: 'annual', month: 6, day: 30 },
    applicability: [{ flag: 'isCompany', value: 'true' }], defaultBudgetHours: 2, isActive: true,
  },
  {
    code: 'LLP11', name: 'LLP Form 11 (annual return)', shortName: 'LLP Form 11', serviceLine: 'company_law', engagementGroup: 'LLP Annual Filing',
    templateCode: 'roc', frequency: 'annual', rule: { kind: 'annual', month: 5, day: 30 },
    applicability: [{ flag: 'isLLP', value: 'true' }], defaultBudgetHours: 2, isActive: true,
  },
  {
    code: 'LLP8', name: 'LLP Form 8 (statement of accounts)', shortName: 'LLP Form 8', serviceLine: 'company_law', engagementGroup: 'LLP Annual Filing',
    templateCode: 'roc', frequency: 'annual', rule: { kind: 'annual', month: 10, day: 30 },
    applicability: [{ flag: 'isLLP', value: 'true' }], defaultBudgetHours: 3, isActive: true,
  },
  {
    code: 'PF', name: 'PF monthly challan & ECR', shortName: 'PF', serviceLine: 'accounting', engagementGroup: 'Payroll Compliance',
    templateCode: 'tax_payment', frequency: 'monthly', rule: { kind: 'monthly', day: 15 },
    applicability: [{ flag: 'pf', value: 'true' }], defaultBudgetHours: 1.5, isActive: true,
  },
  {
    code: 'ESI', name: 'ESI monthly contribution', shortName: 'ESI', serviceLine: 'accounting', engagementGroup: 'Payroll Compliance',
    templateCode: 'tax_payment', frequency: 'monthly', rule: { kind: 'monthly', day: 15 },
    applicability: [{ flag: 'esi', value: 'true' }], defaultBudgetHours: 1, isActive: true,
  },
];
