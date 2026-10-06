# QEPEX Work Tracker — Data Schema Version 5

Schema version 5 is the **frozen data structure for Version 1** of the release plan. Version 2 only adds to it.

Generated from `src/lib/storage/schema.ts` by `npm run data` — the same definition creates the SQLite tables, maps records to rows, and validates records in the tests, so this document cannot drift from the code.

## How data is stored

- **Engine:** SQLite compiled to WebAssembly (sql.js), bundled inside the app. No server and no external service.
- **Persistence (E3):** the SQLite database file is saved in the browser's IndexedDB (database `qepex-work-tracker`, store `sqlite`). Attachment bodies are stored separately in the `files` store (C7).
- **Writes:** after every change only the records that changed are written, then the file is saved.
- **Migrations (E2):** on load the app runs every migration from the stored version up to version 5. Nothing is reset. Data found in the old `localStorage` key from version 4 is migrated once and left in place as a fallback copy.
- **Conventions:** field names are camelCase in the app and snake_case in SQL. Booleans are stored as 0/1. Nested values that are append-only histories or small fixed objects are JSON text columns. Arrays whose items have their own id are **child tables** with `position` for order. Every table has an `extra_json` column holding any field the schema does not list, so a newer field is never dropped by an older build.
- **Single values** (`version`, `seededOn`, `meta`, `lockSettings`, `settings`) live in the key/value table `app_meta`.
- **Audit (E5):** every action on these tables writes `audit_log`. New collections go through one save/delete hook that records field-level changes. Credential changes are logged without the values.

## Fields replaced in v5

| v4 field | Replaced by | Item |
|---|---|---|
| `clients.gstins` (list of GSTIN strings) | `clients.gstins[]` registration records → table `client_gstins` | A19 |
| `clients.profile.gstFrequency` | `client_gstins.frequency` (per GSTIN, with `frequencyHistory`) | A19 |
| `clients.profile.gstAnnualReturn` | `client_gstins.gst_annual_return` | A19 |
| `clients.profile.gst9c` | `client_gstins.gst9c` | A19 |

No other v4 field was removed or renamed. The compliance type `TDS_RET` is **retired**, not removed: it keeps its existing tasks, and 24Q, 26Q, 27Q and 27EQ replace it from the next uncovered quarter.

## Not in v5 (Version 2 items)

Holiday calendar and weekend/holiday shift policy (A24), scoped extensions by state or taxpayer class and dated rule history (A25), late-fee rates (A15), articleship records (B8), invoices and receipts (B9), archive retention settings (B14), applause (B12), helpdesk (B13), credentials vault (C4) and retention rules (C6). Each one adds new tables or fields in V2 without changing anything here.

## Settings (`app_meta`)

| Key | Item | Contents |
|---|---|---|
| `version` | E2 | Data version, kept from v4 (equals meta.schemaVersion) |
| `seededOn` | E7 | Date the demo data was generated |
| `meta` | E2 | {schemaVersion, migrationsApplied[]} |
| `lockSettings` | Spec §21 | {dayOffset, time} weekly lock |
| `settings` | B3, B7, C1 | UDIN pending window, pending-from-client alert days, session timeout, reminder timings |

`settings` defaults:

```json
{
  "udinPendingDays": 15,
  "pendingFromClientAlertDays": 10,
  "pendingFollowUpEveryDays": 3,
  "sessionTimeoutMinutes": 30,
  "reminderLeadDays": [
    7,
    3,
    1
  ],
  "escalateToManagerAfterDays": 1,
  "escalateToPartnerAfterDays": 3,
  "reviewSlaDays": 2,
  "dscExpiryAlertDays": [
    30,
    7
  ],
  "noticeReminderDays": [
    7,
    3,
    1
  ],
  "agmCeilingMonths": 6,
  "attachmentMaxBytes": 5242880,
  "pinMinLength": 4,
  "maxFailedLogins": 5
}
```

## `users` — collection `users`

Firm members. Deactivated users stay so their history remains attributed. **Items:** B1, A8, C1. **Primary key:** `id`.

| Field | Column | Type | Required | Item | Description |
|---|---|---|---|---|---|
| `id` | `id` | TEXT | Required |  | Primary key |
| `employeeCode` | `employee_code` | TEXT | Required |  | Employee code, unique |
| `name` | `name` | TEXT | Required |  | Full name |
| `role` | `role` | TEXT | Required |  | partner | manager | staff | article | admin |
| `designation` | `designation` | TEXT | Required |  | e.g. "Senior", "CS Trainee" |
| `isSenior` | `is_senior` | INTEGER (0/1) | Optional |  | Senior staff may review junior work |
| `email` | `email` | TEXT | Optional |  | Work email |
| `phone` | `phone` | TEXT | Optional |  | Mobile number |
| `defaultLocation` | `default_location` | TEXT | Required | A8 | office | client_site | wfh |
| `locationOverrideAllowed` | `location_override_allowed` | INTEGER (0/1) | Required | A8 | Whether the person may change location on an entry |
| `joiningDate` | `joining_date` | TEXT | Required |  | YYYY-MM-DD |
| `principalPartnerId` | `principal_partner_id` | TEXT | Optional |  | Article assistants: principal Partner → `users` |
| `active` | `active` | INTEGER (0/1) | Required | B1 | false once offboarded |
| `deactivatedOn` | `deactivated_on` | TEXT | Optional (null) | B1 | Offboarding date |
| `deactivatedBy` | `deactivated_by` | TEXT | Optional (null) | B1 | User who offboarded → `users` |
| `deactivationNote` | `deactivation_note` | TEXT | Optional (null) | B1 | Reason / custody notes |

Example record (long lists shortened):

```json
{
  "id": "u-sneha",
  "employeeCode": "QX-S21",
  "name": "Sneha Patil",
  "role": "staff",
  "designation": "Senior",
  "isSenior": true,
  "defaultLocation": "office",
  "locationOverrideAllowed": true,
  "joiningDate": "2021-08-02",
  "email": "sneha.patil@qepexindia.example",
  "active": true,
  "deactivatedOn": null,
  "deactivatedBy": null,
  "deactivationNote": null
}
```

## `user_auth`

Credentials and 2FA, one row per user. PIN/password hashed with PBKDF2-SHA256 (Web Crypto); plaintext never stored. **Items:** C1. **Primary key:** `user_id`.

| Field | Column | Type | Required | Item | Description |
|---|---|---|---|---|---|
| `userId` | `user_id` | TEXT | Required |  | users.id → `users` |
| `credentialKind` | `credential_kind` | TEXT | Required |  | pin | password |
| `passwordHash` | `password_hash` | TEXT | Optional (null) |  | base64 PBKDF2 hash |
| `passwordSalt` | `password_salt` | TEXT | Optional (null) |  | base64, 16 random bytes |
| `hashIterations` | `hash_iterations` | INTEGER | Required |  | PBKDF2 iterations |
| `mustChangePassword` | `must_change_password` | INTEGER (0/1) | Required |  | true while a temporary PIN issued by Admin is in use |
| `tempPinIssuedAt` | `temp_pin_issued_at` | TEXT | Optional (null) |  | When Admin issued the temporary PIN |
| `tempPinIssuedBy` | `temp_pin_issued_by` | TEXT | Optional (null) |  | Admin who issued it → `users` |
| `failedAttempts` | `failed_attempts` | INTEGER | Required |  | Consecutive failed sign-ins |
| `lockedUntil` | `locked_until` | TEXT | Optional (null) |  | Locked after too many failures |
| `lastLoginAt` | `last_login_at` | TEXT | Optional (null) |  | Last successful sign-in |
| `totpSecret` | `totp_secret` | TEXT | Optional (null) |  | Base32 TOTP secret (authenticator app) |
| `totpEnrolledAt` | `totp_enrolled_at` | TEXT | Optional (null) |  | When 2FA was enrolled |

Example record (long lists shortened):

```json
{
  "userId": "u-sneha",
  "credentialKind": "pin",
  "passwordHash": "WUD11knyoNOoa8j203M9LByPqRI/lP7OFcwTnezH+z0=",
  "passwordSalt": "9C7N/I9W9xdZ7f2C05CioQ==",
  "hashIterations": 210000,
  "mustChangePassword": true,
  "tempPinIssuedAt": "2026-07-08T10:00:00.000Z",
  "tempPinIssuedBy": "u-farhan",
  "failedAttempts": 0,
  "lockedUntil": null,
  "lastLoginAt": null,
  "totpSecret": null,
  "totpEnrolledAt": null
}
```

## `clients` — collection `clients`

Client master. **Items:** Spec §4, A19, A20, A22. **Primary key:** `id`.

| Field | Column | Type | Required | Item | Description |
|---|---|---|---|---|---|
| `id` | `id` | TEXT | Required |  | Primary key |
| `code` | `code` | TEXT | Required |  | Client code, e.g. CL-0142 |
| `name` | `name` | TEXT | Required |  | Legal name |
| `group` | `group` | TEXT | Optional |  | Family / promoter group |
| `constitution` | `constitution` | TEXT | Required |  | individual | huf | proprietorship | partnership_firm | llp | private_company | public_company | trust | society | other |
| `status` | `status` | TEXT | Required |  | active | dormant | discontinued |
| `statusEffectiveFrom` | `status_effective_from` | TEXT | Optional (null) |  | Date the current status applies from (Rules §7) |
| `pan` | `pan` | TEXT | Optional |  | PAN |
| `tan` | `tan` | TEXT | Optional |  | TAN |
| `cin` | `cin` | TEXT | Optional |  | CIN or LLPIN |
| `udyam` | `udyam` | TEXT | Optional |  | Udyam registration |
| `stateCode` | `state_code` | TEXT | Optional |  | Principal place of business (GST state code) |
| `fyEnd` | `fy_end` | TEXT | Required |  | Financial year end, "31 Mar" |
| `agmDate` | `agm_date` | TEXT | Optional |  | Latest / scheduled AGM |
| `auditorAppointmentDate` | `auditor_appointment_date` | TEXT | Optional (null) | A23 | Drives ADT-1 |
| `booksBy` | `books_by` | TEXT | Required |  | firm | client |
| `partnerId` | `partner_id` | TEXT | Required |  | Assigned Partner → `users` |
| `managerId` | `manager_id` | TEXT | Optional |  | Assigned Manager → `users` |
| `contactName` | `contact_name` | TEXT | Optional |  | Primary contact |
| `contactPhone` | `contact_phone` | TEXT | Optional |  | Contact phone |
| `contactEmail` | `contact_email` | TEXT | Optional |  | Contact email |
| `profile` | `profile` | TEXT (JSON) | Required | A22 | Applicability flags: tds, tdsSalary, tdsNonSalary, tdsNonResident, tcs, advanceTax, taxAudit, statutoryAudit, transferPricing, pf, esi |
| `complianceStartDates` | `compliance_start_dates` | TEXT (JSON) | Required |  | compliance type code → first period start that may be generated (Rules §3.3) |
| `flagHistory` | `flag_history` | TEXT (JSON) | Required |  | Append-only flag changes |
| `createdAt` | `created_at` | TEXT | Required |  | ISO timestamp |
| `createdBy` | `created_by` | TEXT | Required |  | users.id |
| `updatedAt` | `updated_at` | TEXT | Required |  | ISO timestamp |
| `updatedBy` | `updated_by` | TEXT | Required |  | users.id |

### Child table `client_gstins` (field `clients.gstins[]`)

One row per GST registration, each with its own filing frequency. Replaces v4 profile.gstFrequency / gstAnnualReturn / gst9c. **Item:** A19. Rows carry `client_id` and `position`.

| Field | Column | Type | Required | Item | Description |
|---|---|---|---|---|---|
| `id` | `id` | TEXT | Required |  | Primary key |
| `gstin` | `gstin` | TEXT | Required |  | 15-character GSTIN |
| `stateCode` | `state_code` | TEXT | Required |  | First two digits |
| `state` | `state` | TEXT | Required |  | State name |
| `frequency` | `frequency` | TEXT | Required |  | monthly | qrmp | composition | not_set |
| `effectiveFrom` | `effective_from` | TEXT | Required |  | Current frequency applies from |
| `frequencyHistory` | `frequency_history` | TEXT (JSON) | Required |  | Append-only frequency changes |
| `gstAnnualReturn` | `gst_annual_return` | INTEGER (0/1) | Required |  | GSTR-9 applicable |
| `gst9c` | `gst9c` | INTEGER (0/1) | Required |  | GSTR-9C applicable |
| `iffOpted` | `iff_opted` | INTEGER (0/1) | Required |  | IFF opted (QRMP) |
| `status` | `status` | TEXT | Required |  | active | cancelled |
| `cancelledOn` | `cancelled_on` | TEXT | Optional (null) |  | Cancellation date |

### Child table `client_directors` (field `clients.directors[]`)

Directors / designated partners. DIR-3 KYC generates per director. **Item:** A20. Rows carry `client_id` and `position`.

| Field | Column | Type | Required | Item | Description |
|---|---|---|---|---|---|
| `id` | `id` | TEXT | Required |  | Primary key |
| `name` | `name` | TEXT | Required |  | Full name |
| `din` | `din` | TEXT | Required |  | 8-digit DIN |
| `designation` | `designation` | TEXT | Required |  | director | managing_director | whole_time_director | independent_director | designated_partner | other |
| `dscId` | `dsc_id` | TEXT | Optional (null) | A16 | DSC held by the director → `dsc_register` |
| `appointedOn` | `appointed_on` | TEXT | Optional (null) |  | Appointment date |
| `ceasedOn` | `ceased_on` | TEXT | Optional (null) |  | Cessation date |
| `active` | `active` | INTEGER (0/1) | Required |  | Currently on the board |

Example record (long lists shortened):

```json
{
  "id": "c-0108",
  "code": "CL-0108",
  "name": "Vistara Softech Pvt Ltd",
  "constitution": "private_company",
  "pan": "AAGCV2290B",
  "tan": "BLRV09876A",
  "gstins": [
    {
      "id": "gst-29AAGCV2290B1Z8",
      "gstin": "29AAGCV2290B1Z8",
      "stateCode": "29",
      "state": "Karnataka",
      "frequency": "monthly",
      "effectiveFrom": "2024-04-01",
      "frequencyHistory": [
        {
          "frequency": "monthly",
          "effectiveFrom": "2024-04-01",
          "changedBy": "u-farhan",
          "changedAt": "2026-07-08T10:00:00.000Z"
        }
      ],
      "gstAnnualReturn": true,
      "gst9c": false,
      "iffOpted": false,
      "status": "active",
      "cancelledOn": null
    },
    "… 1 more"
  ],
  "cin": "U72900KA2019PTC123456",
  "agmDate": "2026-09-29",
  "booksBy": "firm",
  "partnerId": "u-rajesh",
  "managerId": "u-arjun",
  "contactName": "Kavya Rao (CFO)",
  "contactPhone": "+91 98450 11276",
  "contactEmail": "kavya@vistarasoftech.example",
  "profile": {
    "tds": true,
    "tdsSalary": true,
    "tdsNonSalary": true,
    "tdsNonResident": true,
    "tcs": false,
    "advanceTax": true,
    "taxAudit": false,
    "statutoryAudit": true,
    "transferPricing": true,
    "pf": true,
    "esi": false
  },
  "stateCode": "29",
  "directors": [
    {
      "id": "dir-vs-1",
      "name": "Suresh Rao",
      "din": "08123456",
      "designation": "managing_director",
      "dscId": "dsc-03",
      "appointedOn": "2019-03-15",
      "ceasedOn": null,
      "active": true
    },
    "… 1 more"
  ],
  "auditorAppointmentDate": "2026-09-29",
  "complianceStartDates": {
    "GSTR3B_M": "2026-06-01",
    "GSTR3B_Q": "2026-04-01",
    "TDS_24Q": "2026-04-01",
    "TDS_26Q": "2026-04-01",
    "TDS_27Q": "2026-04-01",
    "TDS_PAY": "2026-07-01",
    "GSTR1_M": "2026-07-01",
    "IFF": "2026-07-01",
    "PF": "2026-07-01",
    "STAT_AUDIT": "2025-04-01",
    "ADV_TAX": "2026-07-01",
    "DIR3": "2025-04-01",
    "GSTR1_Q": "2026-07-01",
    "ADT1": "2025-04-01",
    "AOC4": "2025-04-01",
    "TP3CEB": "2025-04-01",
    "MGT7": "2025-04-01",
    "ITR_A": "2025-04-01",
    "GSTR9": "2025-04-01"
  },
  "statusEffectiveFrom": null,
  "status": "active",
  "fyEnd": "31 Mar",
  "flagHistory": [],
  "createdAt": "2026-07-08T10:00:00.000Z",
  "createdBy": "u-farhan",
  "updatedAt": "2026-07-08T10:00:00.000Z",
  "updatedBy": "u-farhan"
}
```

## `client_team` — collection `clientTeam`

Client-team scoping. **Items:** Spec §2. **Primary key:** `client_id` + `user_id`.

| Field | Column | Type | Required | Item | Description |
|---|---|---|---|---|---|
| `clientId` | `client_id` | TEXT | Required |  | clients.id → `clients` |
| `userId` | `user_id` | TEXT | Required |  | users.id → `users` |
| `role` | `role` | TEXT | Required |  | staff | reviewer |

Example record (long lists shortened):

```json
{
  "clientId": "c-0101",
  "userId": "u-sneha",
  "role": "staff"
}
```

## `compliance_types` — collection `complianceTypes`

Due-Date Master. All dates illustrative until verified. **Items:** Spec §6, A22, A23. **Primary key:** `code`.

| Field | Column | Type | Required | Item | Description |
|---|---|---|---|---|---|
| `code` | `code` | TEXT | Required |  | Primary key |
| `name` | `name` | TEXT | Required |  | Full name |
| `shortName` | `short_name` | TEXT | Required |  | Short label |
| `serviceLine` | `service_line` | TEXT | Required |  | accounting | audit | direct_tax | gst | company_law | advisory |
| `engagementGroup` | `engagement_group` | TEXT | Required |  | Recurring engagement it rolls into |
| `templateCode` | `template_code` | TEXT | Required |  | stage_templates.code → `stage_templates` |
| `frequency` | `frequency` | TEXT | Required |  | monthly | quarterly | annual | event_based |
| `rule` | `rule` | TEXT (JSON) | Required |  | Due-date rule (monthly / quarterly / annual / event) |
| `dueVariants` | `due_variants` | TEXT (JSON) | Optional |  | Alternative due dates by flag (ITR audit → 30 Nov with 3CEB) |
| `applicability` | `applicability` | TEXT (JSON) | Required |  | Flag conditions, all must hold |
| `scope` | `scope` | TEXT | Required | A19, A20 | client | gstin | director |
| `periodLabelStyle` | `period_label_style` | TEXT | Optional |  | fy | ay | instalment |
| `defaultBudgetHours` | `default_budget_hours` | REAL | Required |  | Budget per period |
| `isActive` | `is_active` | INTEGER (0/1) | Required |  | Generates tasks |
| `isCustom` | `is_custom` | INTEGER (0/1) | Optional |  | Added by Admin |
| `retired` | `retired` | INTEGER (0/1) | Optional |  | Kept for history only |
| `replacedBy` | `replaced_by` | TEXT (JSON) | Optional |  | Codes that replace a retired type |
| `illustrative` | `illustrative` | INTEGER (0/1) | Required | A23 | "Illustrative, verify before go-live" |
| `verifiedBy` | `verified_by` | TEXT | Optional (null) | A23 | Reviewer who verified against current law |
| `verifiedAt` | `verified_at` | TEXT | Optional (null) | A23 | When verified |

Example record (long lists shortened):

```json
{
  "code": "TP3CEB",
  "name": "Transfer pricing report (Form 3CEB)",
  "shortName": "Form 3CEB",
  "serviceLine": "audit",
  "engagementGroup": "Transfer Pricing",
  "templateCode": "audit",
  "frequency": "annual",
  "rule": {
    "kind": "annual",
    "month": 10,
    "day": 31
  },
  "periodLabelStyle": "ay",
  "applicability": [
    {
      "flag": "transferPricing",
      "value": "true"
    }
  ],
  "scope": "client",
  "defaultBudgetHours": 25,
  "isActive": true,
  "illustrative": true,
  "verifiedBy": null,
  "verifiedAt": null
}
```

## `stage_templates` — collection `templates`

Stage templates; fields hold the current version, versions[] the full history. **Items:** Spec §9, A27. **Primary key:** `code`.

| Field | Column | Type | Required | Item | Description |
|---|---|---|---|---|---|
| `code` | `code` | TEXT | Required |  | Primary key |
| `name` | `name` | TEXT | Required |  | Name |
| `family` | `family` | TEXT | Optional |  | F1–F6 (Rules §2.1) |
| `stages` | `stages` | TEXT (JSON) | Required |  | Ordered stage names |
| `filingStageIndex` | `filing_stage_index` | INTEGER | Optional (null) |  | Stage that needs an acknowledgment |
| `ackType` | `ack_type` | TEXT | Optional (null) |  | arn | srn | itr_ack | challan | token | udin | other |
| `reviewLevel` | `review_level` | TEXT | Required |  | Who reviews |
| `checklist` | `checklist` | TEXT (JSON) | Required |  | Default document checklist |
| `requiresSignoff` | `requires_signoff` | INTEGER (0/1) | Required |  | Partner sign-off needed to file |
| `requiresUdin` | `requires_udin` | INTEGER (0/1) | Required |  | UDIN needed to file |
| `version` | `version` | INTEGER | Required | A27 | Current version number |
| `versions` | `versions` | TEXT (JSON) | Required | A27 | All versions, oldest first |

Example record (long lists shortened):

```json
{
  "code": "audit",
  "name": "Statutory / tax audit",
  "stages": [
    "Planning",
    "… 6 more"
  ],
  "filingStageIndex": 6,
  "ackType": "udin",
  "reviewLevel": "Partner sign-off",
  "checklist": [
    "Trial balance",
    "… 5 more"
  ],
  "family": "F4",
  "requiresSignoff": true,
  "requiresUdin": true,
  "version": 1,
  "versions": [
    {
      "version": 1,
      "name": "Statutory / tax audit",
      "stages": [
        "Planning",
        "… 6 more"
      ],
      "checklist": [
        "Trial balance",
        "… 5 more"
      ],
      "filingStageIndex": 6,
      "ackType": "udin",
      "reviewLevel": "Partner sign-off",
      "effectiveFrom": "2026-04-01T00:00:00.000Z",
      "createdBy": "system",
      "note": "Version in use before schema v5"
    }
  ]
}
```

## `engagements` — collection `engagements`

Engagements (recurring from the calendar, or one-time). **Items:** Spec §5, A29. **Primary key:** `id`.

| Field | Column | Type | Required | Item | Description |
|---|---|---|---|---|---|
| `id` | `id` | TEXT | Required |  | Primary key |
| `clientId` | `client_id` | TEXT | Required |  | clients.id → `clients` |
| `serviceLine` | `service_line` | TEXT | Required |  | Service line |
| `type` | `type` | TEXT | Required |  | recurring | one_time |
| `title` | `title` | TEXT | Required |  | Title |
| `financialYear` | `financial_year` | TEXT | Optional |  | "FY 2026-27" |
| `templateCode` | `template_code` | TEXT | Required |  | stage_templates.code → `stage_templates` |
| `status` | `status` | TEXT | Required |  | active | on_hold | completed | archived |
| `partnerId` | `partner_id` | TEXT | Required |  | users.id → `users` |
| `managerId` | `manager_id` | TEXT | Optional |  | users.id → `users` |
| `team` | `team` | TEXT (JSON) | Required |  | [{userId, role: maker | checker}] |
| `budgetHours` | `budget_hours` | REAL | Optional |  | Engagement Budget (one-time total / recurring per period) |
| `billable` | `billable` | INTEGER (0/1) | Required |  | Chargeable, set by Partner |
| `feeBasis` | `fee_basis` | TEXT (JSON) | Optional (null) | A29 | {type: fixed | recurring | time, amount, rate, retainerPeriod} or null = not set |
| `startDate` | `start_date` | TEXT | Optional |  | Start |
| `endDate` | `end_date` | TEXT | Optional |  | Target / due date |
| `createdAt` | `created_at` | TEXT | Required |  | ISO timestamp |
| `createdBy` | `created_by` | TEXT | Required |  | users.id |

Example record (long lists shortened):

```json
{
  "feeBasis": {
    "type": "time",
    "amount": null,
    "rate": 2500,
    "retainerPeriod": null
  },
  "clientId": "c-0101",
  "serviceLine": "audit",
  "title": "Stock audit for lender bank — FY 2025-26",
  "financialYear": "FY 2025-26",
  "templateCode": "audit",
  "partnerId": "u-rajesh",
  "managerId": "u-priya",
  "team": [
    {
      "userId": "u-sneha",
      "role": "maker"
    },
    "… 2 more"
  ],
  "budgetHours": 16,
  "billable": true,
  "startDate": "2026-10-02",
  "endDate": "2026-10-27",
  "id": "b203ea98-2b93-4594-9bbb-25bde4aa66dc",
  "type": "one_time",
  "status": "active",
  "createdAt": "2026-10-02T10:00:00.000Z",
  "createdBy": "u-priya"
}
```

## `tasks` — collection `tasks`

Compliance tasks and one-time engagement work items. Natural key (client, type, period, GSTIN/director). **Items:** Spec §6, §10, §11, A13, A14, A19, A20, A27. **Primary key:** `id`.

| Field | Column | Type | Required | Item | Description |
|---|---|---|---|---|---|
| `id` | `id` | TEXT | Required |  | Primary key |
| `clientId` | `client_id` | TEXT | Required |  | clients.id → `clients` |
| `engagementId` | `engagement_id` | TEXT | Required |  | engagements.id → `engagements` |
| `kind` | `kind` | TEXT | Required |  | compliance | engagement |
| `complianceTypeCode` | `compliance_type_code` | TEXT | Optional |  | compliance_types.code → `compliance_types` |
| `periodKey` | `period_key` | TEXT | Optional |  | "2026-09", "FY2026-27-Q2", "FY2025-26" |
| `periodLabel` | `period_label` | TEXT | Required |  | Display label |
| `title` | `title` | TEXT | Required |  | Display title |
| `templateCode` | `template_code` | TEXT | Required |  | stage_templates.code → `stage_templates` |
| `templateVersion` | `template_version` | INTEGER | Required | A27 | Template version the task follows |
| `gstinId` | `gstin_id` | TEXT | Optional (null) | A19 | client_gstins.id for per-GSTIN types → `client_gstins` |
| `directorId` | `director_id` | TEXT | Optional (null) | A20 | client_directors.id for per-director types → `client_directors` |
| `originalDue` | `original_due` | TEXT | Required |  | Computed due date |
| `effectiveDue` | `effective_due` | TEXT | Required |  | Due date after extensions |
| `provisional` | `provisional` | INTEGER (0/1) | Optional |  | Event date not yet known |
| `status` | `status` | TEXT | Required |  | upcoming | in_progress | pending_from_client | under_review | filed | filed_late | not_applicable |
| `stageIndex` | `stage_index` | INTEGER | Required |  | Current stage |
| `pendingPeriods` | `pending_periods` | TEXT (JSON) | Required |  | Append-only client-waiting periods |
| `ack` | `ack` | TEXT (JSON) | Optional |  | {type, number, date} — required for Filed / Filed Late |
| `signoff` | `signoff` | TEXT (JSON) | Optional (null) |  | {by, at, udinId} Partner sign-off |
| `review` | `review` | TEXT (JSON) | Optional (null) | A14 | {submittedBy, submittedAt, checkerId, decision, decidedAt} |
| `naReason` | `na_reason` | TEXT | Optional |  | Reason when Not Applicable |
| `supersededByTaskId` | `superseded_by_task_id` | TEXT | Optional (null) |  | Rules §7.3 → `tasks` |
| `assignedTo` | `assigned_to` | TEXT | Optional |  | Maker → `users` |
| `checkerId` | `checker_id` | TEXT | Optional |  | Checker → `users` |
| `budgetHours` | `budget_hours` | REAL | Optional |  | Per-period budget |
| `statusHistory` | `status_history` | TEXT (JSON) | Required |  | Append-only status changes |
| `dueHistory` | `due_history` | TEXT (JSON) | Required |  | Append-only due-date changes |
| `createdAt` | `created_at` | TEXT | Required |  | ISO timestamp |
| `updatedAt` | `updated_at` | TEXT | Required |  | ISO timestamp |
| `updatedBy` | `updated_by` | TEXT | Required |  | users.id |

### Child table `task_review_points` (field `tasks.reviewPoints[]`)

Review points raised by the checker; open until cleared. **Item:** A13. Rows carry `task_id` and `position`.

| Field | Column | Type | Required | Item | Description |
|---|---|---|---|---|---|
| `id` | `id` | TEXT | Required |  | Primary key |
| `text` | `text` | TEXT | Required |  | The point |
| `raisedBy` | `raised_by` | TEXT | Required |  | users.id |
| `raisedAt` | `raised_at` | TEXT | Required |  | ISO timestamp |
| `clearedBy` | `cleared_by` | TEXT | Optional (null) |  | users.id |
| `clearedAt` | `cleared_at` | TEXT | Optional (null) |  | ISO timestamp |

### Child table `task_checklist_items` (field `tasks.checklist[]`)

Document checklist. **Item:** Spec §10, A18. Rows carry `task_id` and `position`.

| Field | Column | Type | Required | Item | Description |
|---|---|---|---|---|---|
| `id` | `id` | TEXT | Required |  | Primary key |
| `name` | `name` | TEXT | Required |  | Document |
| `status` | `status` | TEXT | Required |  | not_requested | requested | received | not_applicable |
| `dateRequested` | `date_requested` | TEXT | Optional |  | YYYY-MM-DD |
| `dateReceived` | `date_received` | TEXT | Optional |  | YYYY-MM-DD |
| `note` | `note` | TEXT | Optional | A18 | Note per item |

### Child table `task_follow_ups` (field `tasks.followUps[]`)

Reminder log of client follow-ups. **Item:** Spec §10. Rows carry `task_id` and `position`.

| Field | Column | Type | Required | Item | Description |
|---|---|---|---|---|---|
| `id` | `id` | TEXT | Required |  | Primary key |
| `at` | `at` | TEXT | Required |  | YYYY-MM-DD |
| `by` | `by` | TEXT | Required |  | users.id |
| `channel` | `channel` | TEXT | Required |  | call | email | whatsapp | other |
| `notes` | `notes` | TEXT | Required |  | What was said |

Example record (long lists shortened):

```json
{
  "id": "c36346cf-4ff1-441d-a8e5-33044a365394",
  "clientId": "c-0105",
  "engagementId": "60b23f89-218a-4a39-a878-6540da69e21c",
  "kind": "compliance",
  "complianceTypeCode": "GSTR1_M",
  "periodKey": "2026-09",
  "periodLabel": "Sep 2026",
  "title": "GSTR-1 · Sep 2026",
  "templateCode": "gst_return",
  "templateVersion": 1,
  "gstinId": "gst-27AAXFB9087P1Z2",
  "directorId": null,
  "originalDue": "2026-10-11",
  "effectiveDue": "2026-10-11",
  "provisional": false,
  "status": "under_review",
  "stageIndex": 3,
  "pendingPeriods": [],
  "signoff": null,
  "review": {
    "submittedBy": "u-karan",
    "submittedAt": "2026-10-05T16:40:00.000Z",
    "checkerId": "u-arjun",
    "decision": null,
    "decidedAt": null
  },
  "reviewPoints": [
    {
      "id": "2562d377-e8df-4ecf-8be7-a04d0a523399",
      "text": "B2B invoices to SEZ units are shown as regular supplies — move to SEZ with payment",
      "raisedBy": "u-arjun",
      "raisedAt": "2026-10-04T15:10:00.000Z",
      "clearedBy": "u-karan",
      "clearedAt": "2026-10-05T12:30:00.000Z"
    },
    "… 1 more"
  ],
  "supersededByTaskId": null,
  "assignedTo": "u-ananya",
  "checkerId": "u-arjun",
  "budgetHours": 3,
  "checklist": [
    {
      "id": "c359fe58-48d1-4c64-8ebc-2995685679ea",
      "name": "Sales register",
      "status": "received",
      "dateRequested": "2026-09-28",
      "dateReceived": "2026-10-02"
    },
    "… 4 more"
  ],
  "followUps": [],
  "statusHistory": [
    {
      "at": "2026-10-06T12:56:13.484Z",
      "by": "u-farhan",
      "from": null,
      "to": "upcoming",
      "note": "Generated by compliance calendar"
    },
    "… 2 more"
  ],
  "dueHistory": [],
  "createdAt": "2026-10-06T12:56:13.484Z",
  "updatedAt": "2026-10-06T12:56:13.484Z",
  "updatedBy": "u-farhan"
}
```

## `work_entries` — collection `entries`

Work entries. **Items:** Spec §8, §38. **Primary key:** `id`.

| Field | Column | Type | Required | Item | Description |
|---|---|---|---|---|---|
| `id` | `id` | TEXT | Required |  | Primary key |
| `userId` | `user_id` | TEXT | Required |  | users.id → `users` |
| `date` | `date` | TEXT | Required |  | YYYY-MM-DD |
| `clientId` | `client_id` | TEXT | Optional |  | clients.id → `clients` |
| `engagementId` | `engagement_id` | TEXT | Optional |  | engagements.id → `engagements` |
| `taskId` | `task_id` | TEXT | Optional |  | tasks.id → `tasks` |
| `stage` | `stage` | TEXT | Optional |  | Stage name |
| `internalCategory` | `internal_category` | TEXT | Optional |  | Non-client category |
| `hours` | `hours` | REAL | Required |  | 0–12 in 0.25 steps |
| `description` | `description` | TEXT | Optional |  | What was done |
| `outcome` | `outcome` | TEXT | Optional |  | Outcome / acknowledgment |
| `location` | `location` | TEXT | Required |  | office | client_site | wfh |
| `clientSiteClientId` | `client_site_client_id` | TEXT | Optional |  | Client premises → `clients` |
| `createdAt` | `created_at` | TEXT | Required |  | ISO timestamp |
| `updatedAt` | `updated_at` | TEXT | Required |  | ISO timestamp |
| `modifiedBy` | `modified_by` | TEXT | Required |  | users.id |

Example record (long lists shortened):

```json
{
  "userId": "u-sneha",
  "date": "2026-09-26",
  "clientId": "c-0101",
  "engagementId": "33229a5b-e34d-4591-92a4-da23ac5a15ab",
  "taskId": "14597e74-1be3-42a9-812c-6d7599ca7924",
  "stage": "Report Signed (UDIN)",
  "hours": 0.75,
  "description": "Portal filing",
  "outcome": "Tax audit report filed — UDIN 26147004BXTFE4887",
  "id": "68f14fd6-9193-4282-84b2-242ada79c14b",
  "location": "office",
  "createdAt": "2026-09-26T19:05:00.000Z",
  "updatedAt": "2026-09-26T19:05:00.000Z",
  "modifiedBy": "u-sneha"
}
```

## `extensions` — collection `extensions`

Published due-date extensions; append-only, corrections supersede. **Items:** Spec §6, Rules §5. **Primary key:** `id`.

| Field | Column | Type | Required | Item | Description |
|---|---|---|---|---|---|
| `id` | `id` | TEXT | Required |  | Primary key |
| `complianceTypeCode` | `compliance_type_code` | TEXT | Required |  | compliance_types.code → `compliance_types` |
| `periodKeys` | `period_keys` | TEXT (JSON) | Required |  | Periods covered |
| `newDueDate` | `new_due_date` | TEXT | Required |  | YYYY-MM-DD |
| `reference` | `reference` | TEXT | Required |  | Notification / circular number |
| `reason` | `reason` | TEXT | Required |  | Reason |
| `status` | `status` | TEXT | Required |  | published | superseded |
| `supersedesId` | `supersedes_id` | TEXT | Optional (null) |  | Earlier extension this replaces → `extensions` |
| `publishedAt` | `published_at` | TEXT | Required |  | ISO timestamp |
| `publishedBy` | `published_by` | TEXT | Required |  | users.id |
| `tasksMoved` | `tasks_moved` | INTEGER | Required |  | Open tasks moved |

Example record (long lists shortened):

```json
{
  "id": "56967bff-5e16-40ac-8c21-f5ad12e4e437",
  "complianceTypeCode": "TAR",
  "periodKeys": [
    "FY2025-26"
  ],
  "newDueDate": "2026-10-31",
  "reference": "CBDT Circular No. 14/2026 (illustrative)",
  "reason": "Extension of due date for audit reports under section 44AB",
  "publishedAt": "2026-09-24T18:30:00.000Z",
  "publishedBy": "u-farhan",
  "tasksMoved": 3,
  "status": "published",
  "supersedesId": null
}
```

## `lock_extensions` — collection `lockExtensions`

Partner extensions of the weekly lock. **Items:** Spec §21. **Primary key:** `id`.

| Field | Column | Type | Required | Item | Description |
|---|---|---|---|---|---|
| `id` | `id` | TEXT | Required |  | Primary key |
| `weekStart` | `week_start` | TEXT | Required |  | Monday of the week |
| `userId` | `user_id` | TEXT | Optional (null) |  | null = everyone → `users` |
| `until` | `until` | TEXT | Required |  | ISO timestamp |
| `reason` | `reason` | TEXT | Required |  | Reason |
| `by` | `by` | TEXT | Required |  | users.id |
| `at` | `at` | TEXT | Required |  | ISO timestamp |

## `leave_requests` — collection `leaveRequests`

Leave applications and decisions. **Items:** B2. **Primary key:** `id`.

| Field | Column | Type | Required | Item | Description |
|---|---|---|---|---|---|
| `id` | `id` | TEXT | Required |  | Primary key |
| `userId` | `user_id` | TEXT | Required |  | users.id → `users` |
| `leaveType` | `leave_type` | TEXT | Required |  | full_day | half_day | multiple_days |
| `reason` | `reason` | TEXT | Required |  | personal | sick | holiday | exam_study | other |
| `note` | `note` | TEXT | Required |  | Note |
| `startDate` | `start_date` | TEXT | Required |  | YYYY-MM-DD |
| `endDate` | `end_date` | TEXT | Required |  | YYYY-MM-DD |
| `halfDaySession` | `half_day_session` | TEXT | Optional (null) |  | AM | PM |
| `days` | `days` | REAL | Required |  | Leave days (0.5 steps) |
| `status` | `status` | TEXT | Required |  | pending | approved | rejected | cancelled |
| `appliedAt` | `applied_at` | TEXT | Required |  | ISO timestamp |
| `decidedBy` | `decided_by` | TEXT | Optional (null) |  | users.id → `users` |
| `decidedAt` | `decided_at` | TEXT | Optional (null) |  | ISO timestamp |
| `decisionNote` | `decision_note` | TEXT | Optional (null) |  | Approver note |
| `conflictTaskIds` | `conflict_task_ids` | TEXT (JSON) | Required |  | Tasks due during the leave, captured at decision |
| `reassignments` | `reassignments` | TEXT (JSON) | Required |  | [{taskId, fromUserId, toUserId}] |

Example record (long lists shortened):

```json
{
  "id": "lv-2",
  "userId": "u-karan",
  "leaveType": "multiple_days",
  "reason": "personal",
  "note": "Sister's wedding in Surat",
  "startDate": "2026-10-14",
  "endDate": "2026-10-16",
  "halfDaySession": null,
  "days": 3,
  "status": "pending",
  "appliedAt": "2026-10-05T09:40:00.000Z",
  "decidedBy": null,
  "decidedAt": null,
  "decisionNote": null,
  "conflictTaskIds": [
    "a7058154-77f3-4baf-b4ab-febab5e9ce4a"
  ],
  "reassignments": []
}
```

## `udin_register` — collection `udinRegister`

UDIN register for documents signed by a Partner. **Items:** B3. **Primary key:** `id`.

| Field | Column | Type | Required | Item | Description |
|---|---|---|---|---|---|
| `id` | `id` | TEXT | Required |  | Primary key |
| `clientId` | `client_id` | TEXT | Required |  | clients.id → `clients` |
| `taskId` | `task_id` | TEXT | Optional (null) |  | tasks.id → `tasks` |
| `engagementId` | `engagement_id` | TEXT | Optional (null) |  | engagements.id → `engagements` |
| `institute` | `institute` | TEXT | Required |  | icai | icsi |
| `documentType` | `document_type` | TEXT | Required |  | e.g. "Statutory audit report" |
| `dateOfSigning` | `date_of_signing` | TEXT | Required |  | YYYY-MM-DD |
| `signingPartnerId` | `signing_partner_id` | TEXT | Required |  | users.id → `users` |
| `udin` | `udin` | TEXT | Optional (null) |  | UDIN, null while awaiting generation |
| `dateGenerated` | `date_generated` | TEXT | Optional (null) |  | YYYY-MM-DD |
| `signedCopyRef` | `signed_copy_ref` | TEXT | Optional (null) |  | attachments.id or physical reference |
| `status` | `status` | TEXT | Required |  | pending_generation | generated | reconciled |
| `reconciledAt` | `reconciled_at` | TEXT | Optional (null) |  | ISO timestamp |
| `reconciledBy` | `reconciled_by` | TEXT | Optional (null) |  | users.id → `users` |
| `notes` | `notes` | TEXT | Required |  | Notes |
| `createdAt` | `created_at` | TEXT | Required |  | ISO timestamp |
| `createdBy` | `created_by` | TEXT | Required |  | users.id |

Example record (long lists shortened):

```json
{
  "id": "udin-cert-networth",
  "clientId": "c-0103",
  "taskId": null,
  "engagementId": null,
  "institute": "icai",
  "documentType": "Net worth certificate (visa application)",
  "dateOfSigning": "2026-10-03",
  "signingPartnerId": "u-meera",
  "udin": "26118734BMKQXP2187",
  "dateGenerated": "2026-10-03",
  "signedCopyRef": "att-networth",
  "status": "generated",
  "reconciledAt": null,
  "reconciledBy": null,
  "notes": "",
  "createdAt": "2026-10-03T15:20:00.000Z",
  "createdBy": "u-divya"
}
```

## `dsc_register` — collection `dscRegister`

Digital signature certificates and their custody. PINs are never stored. **Items:** B4, A16. **Primary key:** `id`.

| Field | Column | Type | Required | Item | Description |
|---|---|---|---|---|---|
| `id` | `id` | TEXT | Required |  | Primary key |
| `holderName` | `holder_name` | TEXT | Required |  | Certificate holder |
| `holderDirectorId` | `holder_director_id` | TEXT | Optional (null) |  | client_directors.id → `client_directors` |
| `holderUserId` | `holder_user_id` | TEXT | Optional (null) |  | users.id if a firm member → `users` |
| `clientIds` | `client_ids` | TEXT (JSON) | Required |  | Linked clients |
| `dscClass` | `dsc_class` | TEXT | Required |  | class_3 | class_2 |
| `dscType` | `dsc_type` | TEXT | Required |  | signing | encryption | combined |
| `issuingAuthority` | `issuing_authority` | TEXT | Required |  | eMudhra, Capricorn, … |
| `tokenSerial` | `token_serial` | TEXT | Optional (null) |  | USB token serial |
| `issueDate` | `issue_date` | TEXT | Required |  | YYYY-MM-DD |
| `expiryDate` | `expiry_date` | TEXT | Required |  | YYYY-MM-DD |
| `custody` | `custody` | TEXT | Required |  | in_office | with_client | with_staff |
| `custodyLocation` | `custody_location` | TEXT | Optional (null) |  | Physical location |
| `custodyUserId` | `custody_user_id` | TEXT | Optional (null) |  | users.id when with staff → `users` |
| `active` | `active` | INTEGER (0/1) | Required |  | In use |
| `notes` | `notes` | TEXT | Required |  | Notes |
| `createdAt` | `created_at` | TEXT | Required |  | ISO timestamp |
| `createdBy` | `created_by` | TEXT | Required |  | users.id |

Example record (long lists shortened):

```json
{
  "id": "dsc-01",
  "holderName": "Mahesh Agarwal",
  "holderDirectorId": "dir-sg-1",
  "holderUserId": null,
  "clientIds": [
    "c-0101"
  ],
  "dscClass": "class_3",
  "dscType": "signing",
  "issuingAuthority": "eMudhra",
  "tokenSerial": "EPASS2003-7741902",
  "issueDate": "2024-10-26",
  "expiryDate": "2026-10-26",
  "custody": "in_office",
  "custodyLocation": "DSC cabinet, drawer 1",
  "custodyUserId": null,
  "active": true,
  "notes": "Renewal to be started — needed for AOC-4 this month.",
  "createdAt": "2026-07-08T10:00:00.000Z",
  "createdBy": "u-farhan"
}
```

## `dsc_movements` — collection `dscMovements`

Every DSC movement in or out. **Items:** B4. **Primary key:** `id`. **Append-only.**

| Field | Column | Type | Required | Item | Description |
|---|---|---|---|---|---|
| `id` | `id` | TEXT | Required |  | Primary key |
| `dscId` | `dsc_id` | TEXT | Required |  | dsc_register.id → `dsc_register` |
| `from` | `from` | TEXT | Required |  | Previous custody |
| `to` | `to` | TEXT | Required |  | New custody |
| `toLocation` | `to_location` | TEXT | Optional (null) |  | New location |
| `toUserId` | `to_user_id` | TEXT | Optional (null) |  | users.id → `users` |
| `movedAt` | `moved_at` | TEXT | Required |  | ISO timestamp |
| `handledBy` | `handled_by` | TEXT | Required |  | users.id → `users` |
| `relatedTaskId` | `related_task_id` | TEXT | Optional (null) |  | tasks.id → `tasks` |
| `notes` | `notes` | TEXT | Required |  | Notes |

Example record (long lists shortened):

```json
{
  "id": "dscm-1",
  "dscId": "dsc-04",
  "from": "with_client",
  "to": "in_office",
  "toLocation": "DSC cabinet, drawer 2",
  "toUserId": null,
  "movedAt": "2026-08-07T12:15:00.000Z",
  "handledBy": "u-farhan",
  "relatedTaskId": null,
  "notes": "Received from Neha Fernandes for LLP Form 11"
}
```

## `notices` — collection `notices`

Notices from tax and regulatory authorities; each is its own engagement + work item. **Items:** B5. **Primary key:** `id`.

| Field | Column | Type | Required | Item | Description |
|---|---|---|---|---|---|
| `id` | `id` | TEXT | Required |  | Primary key |
| `clientId` | `client_id` | TEXT | Required |  | clients.id → `clients` |
| `engagementId` | `engagement_id` | TEXT | Required |  | engagements.id → `engagements` |
| `taskId` | `task_id` | TEXT | Required |  | tasks.id → `tasks` |
| `authority` | `authority` | TEXT | Required |  | income_tax | gst | tds_traces | mca_roc | other |
| `period` | `period` | TEXT | Required |  | "AY 2026-27", "FY 2024-25" |
| `noticeType` | `notice_type` | TEXT | Required |  | e.g. "Scrutiny" |
| `section` | `section` | TEXT | Required |  | e.g. "143(2)" |
| `din` | `din` | TEXT | Optional (null) |  | DIN / reference number |
| `dateOfNotice` | `date_of_notice` | TEXT | Optional (null) |  | YYYY-MM-DD |
| `dateReceived` | `date_received` | TEXT | Required |  | YYYY-MM-DD |
| `responseDueDate` | `response_due_date` | TEXT | Required |  | YYYY-MM-DD |
| `status` | `status` | TEXT | Required |  | received | analysis | data_gathering | draft_response | review | submitted | hearing | adjourned | closed |
| `outcome` | `outcome` | TEXT | Optional (null) |  | favourable | partly_favourable | unfavourable | demand_dropped | pending |
| `demandRaised` | `demand_raised` | REAL | Optional (null) |  | ₹ |
| `demandDropped` | `demand_dropped` | REAL | Optional (null) |  | ₹ |
| `assignedTo` | `assigned_to` | TEXT | Optional (null) |  | users.id → `users` |
| `reviewerId` | `reviewer_id` | TEXT | Optional (null) |  | users.id → `users` |
| `createdAt` | `created_at` | TEXT | Required |  | ISO timestamp |
| `createdBy` | `created_by` | TEXT | Required |  | users.id |
| `updatedAt` | `updated_at` | TEXT | Required |  | ISO timestamp |
| `updatedBy` | `updated_by` | TEXT | Required |  | users.id |

### Child table `notice_hearings` (field `notices.hearings[]`)

Hearing and adjournment dates. **Item:** B5. Rows carry `notice_id` and `position`.

| Field | Column | Type | Required | Item | Description |
|---|---|---|---|---|---|
| `id` | `id` | TEXT | Required |  | Primary key |
| `date` | `date` | TEXT | Required |  | YYYY-MM-DD |
| `adjournedTo` | `adjourned_to` | TEXT | Optional (null) |  | YYYY-MM-DD |
| `outcomeNote` | `outcome_note` | TEXT | Required |  | What happened |
| `attendedBy` | `attended_by` | TEXT | Optional (null) |  | users.id |

Example record (long lists shortened):

```json
{
  "id": "notice-asmt10",
  "clientId": "c-0105",
  "engagementId": "64eac834-0cd2-47db-9b4b-e859d9b71585",
  "taskId": "55716f7f-d47a-4259-8a7c-d90e6949ec16",
  "authority": "gst",
  "period": "FY 2024-25",
  "noticeType": "ASMT-10 (scrutiny of returns)",
  "section": "61",
  "din": "ZD270926031457K",
  "dateOfNotice": "2026-09-08",
  "dateReceived": "2026-09-11",
  "responseDueDate": "2026-10-10",
  "hearings": [
    {
      "id": "hr-asmt-1",
      "date": "2026-10-18",
      "adjournedTo": null,
      "outcomeNote": "Personal hearing scheduled before the proper officer",
      "attendedBy": null
    }
  ],
  "status": "review",
  "outcome": "pending",
  "demandRaised": 184500,
  "demandDropped": null,
  "assignedTo": "u-karan",
  "reviewerId": "u-arjun",
  "createdAt": "2026-09-11T10:00:00.000Z",
  "createdBy": "u-arjun",
  "updatedAt": "2026-10-05T11:00:00.000Z",
  "updatedBy": "u-karan"
}
```

## `inward_outward` — collection `inwardOutward`

Physical documents received from or returned to clients. **Items:** B6. **Primary key:** `id`.

| Field | Column | Type | Required | Item | Description |
|---|---|---|---|---|---|
| `id` | `id` | TEXT | Required |  | Primary key |
| `clientId` | `client_id` | TEXT | Required |  | clients.id → `clients` |
| `direction` | `direction` | TEXT | Required |  | inward | outward |
| `date` | `date` | TEXT | Required |  | YYYY-MM-DD |
| `documentDescription` | `document_description` | TEXT | Required |  | What the document is |
| `documentType` | `document_type` | TEXT | Optional (null) |  | Original / certified copy / … |
| `counterpartyName` | `counterparty_name` | TEXT | Required |  | Who handed over / received at the client |
| `handledBy` | `handled_by` | TEXT | Required |  | users.id → `users` |
| `currentLocation` | `current_location` | TEXT | Optional (null) |  | Where it is now |
| `custodianUserId` | `custodian_user_id` | TEXT | Optional (null) |  | users.id → `users` |
| `linkedInwardId` | `linked_inward_id` | TEXT | Optional (null) |  | Inward entry an outward entry returns → `inward_outward` |
| `returned` | `returned` | INTEGER (0/1) | Required |  | Inward document returned |
| `returnDueDate` | `return_due_date` | TEXT | Optional (null) |  | YYYY-MM-DD |
| `taskId` | `task_id` | TEXT | Optional (null) |  | tasks.id → `tasks` |
| `engagementId` | `engagement_id` | TEXT | Optional (null) |  | engagements.id → `engagements` |
| `notes` | `notes` | TEXT | Required |  | Notes |
| `createdAt` | `created_at` | TEXT | Required |  | ISO timestamp |
| `createdBy` | `created_by` | TEXT | Required |  | users.id |

Example record (long lists shortened):

```json
{
  "id": "io-4",
  "clientId": "c-0107",
  "direction": "inward",
  "date": "2026-07-23",
  "documentDescription": "Donation receipt books 2025-26 (2 books)",
  "documentType": "Original",
  "counterpartyName": "Fr. Joseph Dsouza",
  "handledBy": "u-nikhil",
  "currentLocation": "Not traced since Nikhil Bhosale left",
  "custodianUserId": "u-nikhil",
  "linkedInwardId": null,
  "returned": false,
  "returnDueDate": "2026-08-27",
  "taskId": null,
  "engagementId": null,
  "notes": "Flagged at offboarding — custody not handed over",
  "createdAt": "2026-07-23T12:40:00.000Z",
  "createdBy": "u-nikhil"
}
```

## `notification_state` — collection `notificationState`

Read / dismissed state of computed in-app notifications. **Items:** B7. **Primary key:** `id`.

| Field | Column | Type | Required | Item | Description |
|---|---|---|---|---|---|
| `id` | `id` | TEXT | Required |  | `${userId}|${notificationKey}` |
| `userId` | `user_id` | TEXT | Required |  | users.id → `users` |
| `notificationKey` | `notification_key` | TEXT | Required |  | Deterministic key, e.g. "due:T-3:<taskId>" |
| `readAt` | `read_at` | TEXT | Optional (null) |  | ISO timestamp |
| `dismissedAt` | `dismissed_at` | TEXT | Optional (null) |  | ISO timestamp |

Example record (long lists shortened):

```json
{
  "id": "u-rajesh|dsc-expiry-30:dsc-01",
  "userId": "u-rajesh",
  "notificationKey": "dsc-expiry-30:dsc-01",
  "readAt": "2026-10-05T09:05:00.000Z",
  "dismissedAt": null
}
```

## `access_log` — collection `accessLog`

Every view of sensitive registers, notices, attachments and exports. **Items:** C5. **Primary key:** `id`. **Append-only.**

| Field | Column | Type | Required | Item | Description |
|---|---|---|---|---|---|
| `id` | `id` | TEXT | Required |  | Primary key |
| `at` | `at` | TEXT | Required |  | ISO timestamp |
| `userId` | `user_id` | TEXT | Required |  | users.id → `users` |
| `entity` | `entity` | TEXT | Required |  | udin_register | dsc_register | notice | inward_outward | attachment | export | backup | audit_trail |
| `entityId` | `entity_id` | TEXT | Optional (null) |  | Record viewed |
| `action` | `action` | TEXT | Required |  | view | download | export | print |
| `detail` | `detail` | TEXT | Required |  | Context |

Example record (long lists shortened):

```json
{
  "id": "acc-1",
  "at": "2026-09-29T18:20:00.000Z",
  "userId": "u-farhan",
  "entity": "backup",
  "entityId": null,
  "action": "download",
  "detail": "Full backup downloaded"
}
```

## `attachments` — collection `attachments`

File metadata; the file body is in IndexedDB (store "files", key blobKey). **Items:** C7, E3. **Primary key:** `id`.

| Field | Column | Type | Required | Item | Description |
|---|---|---|---|---|---|
| `id` | `id` | TEXT | Required |  | Primary key |
| `owner` | `owner` | TEXT (JSON) | Required |  | {entity, id} the file belongs to |
| `fileName` | `file_name` | TEXT | Required |  | Original file name |
| `mimeType` | `mime_type` | TEXT | Required |  | MIME type |
| `sizeBytes` | `size_bytes` | INTEGER | Required |  | Size |
| `sha256` | `sha256` | TEXT | Required |  | Hex digest of the body |
| `blobKey` | `blob_key` | TEXT | Required |  | IndexedDB key |
| `description` | `description` | TEXT | Required |  | Description |
| `uploadedBy` | `uploaded_by` | TEXT | Required |  | users.id → `users` |
| `uploadedAt` | `uploaded_at` | TEXT | Required |  | ISO timestamp |
| `deletedAt` | `deleted_at` | TEXT | Optional (null) |  | Soft delete |

Example record (long lists shortened):

```json
{
  "id": "att-notice-143",
  "owner": {
    "entity": "notice",
    "id": "notice-143-1a"
  },
  "fileName": "Intimation_143(1)(a)_AY2026-27.pdf",
  "mimeType": "application/pdf",
  "sizeBytes": 713,
  "sha256": "bfd2ff16a5c4d5a8f70b13e2c4fd64d046c305bb8cf2bde601e197e75e31cf0d",
  "blobKey": "blob-notice-143-1a",
  "description": "Copy of the intimation from CPC",
  "uploadedBy": "u-divya",
  "uploadedAt": "2026-09-26T14:00:00.000Z",
  "deletedAt": null
}
```

## `import_batches` — collection `importBatches`

Bulk imports with their validation results. **Items:** B15. **Primary key:** `id`.

| Field | Column | Type | Required | Item | Description |
|---|---|---|---|---|---|
| `id` | `id` | TEXT | Required |  | Primary key |
| `kind` | `kind` | TEXT | Required |  | clients | users | client_teams |
| `fileName` | `file_name` | TEXT | Required |  | Uploaded file |
| `uploadedBy` | `uploaded_by` | TEXT | Required |  | users.id → `users` |
| `uploadedAt` | `uploaded_at` | TEXT | Required |  | ISO timestamp |
| `status` | `status` | TEXT | Required |  | validated | imported | failed | cancelled |
| `rowCount` | `row_count` | INTEGER | Required |  | Rows in file |
| `importedCount` | `imported_count` | INTEGER | Required |  | Rows imported |
| `errorCount` | `error_count` | INTEGER | Required |  | Rows with errors |
| `errors` | `errors` | TEXT (JSON) | Required |  | [{row, field, message}] |
| `createdIds` | `created_ids` | TEXT (JSON) | Required |  | Records created |
| `previewTaskCount` | `preview_task_count` | INTEGER | Required |  | Tasks the import generates |
| `importedAt` | `imported_at` | TEXT | Optional (null) |  | ISO timestamp |

Example record (long lists shortened):

```json
{
  "id": "imp-1",
  "kind": "clients",
  "fileName": "client_master_import_jul2026.csv",
  "uploadedBy": "u-farhan",
  "uploadedAt": "2026-07-08T09:30:00.000Z",
  "status": "imported",
  "rowCount": 4,
  "importedCount": 3,
  "errorCount": 1,
  "errors": [
    {
      "row": 5,
      "field": "gstin",
      "message": "27AAXFB9087P1Z is 14 characters; a GSTIN has 15"
    }
  ],
  "createdIds": [
    "c-0105",
    "… 2 more"
  ],
  "previewTaskCount": 41,
  "importedAt": "2026-07-08T09:42:00.000Z"
}
```

## `audit_log` — collection `audit`

Audit trail of every change. **Items:** Spec §22, E5. **Primary key:** `id`. **Append-only.**

| Field | Column | Type | Required | Item | Description |
|---|---|---|---|---|---|
| `id` | `id` | TEXT | Required |  | Primary key |
| `at` | `at` | TEXT | Required |  | ISO timestamp |
| `by` | `by` | TEXT | Required |  | users.id |
| `entity` | `entity` | TEXT | Required |  | Record type |
| `entityId` | `entity_id` | TEXT | Required |  | Record id |
| `action` | `action` | TEXT | Required |  | What happened |
| `detail` | `detail` | TEXT | Optional |  | Context |
| `changes` | `changes` | TEXT (JSON) | Optional | E5 | [{field, from, to}] |

Example record (long lists shortened):

```json
{
  "id": "seed-audit-6",
  "at": "2026-10-05T17:30:00.000Z",
  "by": "u-farhan",
  "entity": "dsc",
  "entityId": "dsc-04",
  "action": "DSC moved",
  "detail": "with client → in office · Received from Neha Fernandes for LLP Form 11"
}
```
