# QEPEX India Work Tracker — V1 prototype

A clickable MVP of the V1 spec (CA & CS services), built to test with a few people at QEPEX India.
Everything runs in the browser: data lives in `localStorage` (one copy per browser), seeded with a
fictional firm, clients and three weeks of work relative to today's date. No backend, no passwords.

```bash
npm install
npm run dev            # http://localhost:5173
npm test               # compliance-engine and seed tests
npm run build:single   # one self-contained HTML file in dist-single/ to share
```

## What's in it (the P0 list)

| Spec | Where |
|---|---|
| Login by picking a user, role switcher | Start screen; tap your name chip (top right) to switch anyone, any time |
| Client master — constitution, PAN/TAN/GSTIN/CIN/LLPIN/Udyam, applicability flags | Clients → Add client / Edit client & flags. Live preview of the tasks the flags will create |
| Compliance calendar from an editable Due-Date Master | Flags generate tasks 120 days ahead; Due-Date Master → Edit (rule change) or Extend (publish an extension). Both move every affected open task and log it in the task history and audit trail. Filed Late becomes Filed if an extension makes it on time |
| Engagements, stage templates, client-team assignment | Engagements; Stage Templates (Admin/Partner); team set on the client and on each engagement |
| Work entry — client, task, stage, hours 0–12 in 15-min steps, description chips, location, outcome, ARN | + Add Work (Today / Yesterday / Select / Multiple dates); recently used client→task pairs are one tap |
| Multiple clients per day, day and week views | Work → Day (running total, copy entry, copy day) and Week (grid of client/task × stage across Mon–Sat) |
| Pending from Client, document checklist, reminder log | Any task → Pending from Client; checklist items Requested / Received / N/A with dates; days waiting on the client are counted separately from firm days |
| Calendar with personal and compliance layers | Calendar (logged / missing / leave / locked; due dates coloured by status). Partners see the firm, others their clients |
| Weekly lock, extendable by a Partner | Weekly Lock (lock time) and This Week → Extend lock (everyone or one person) |
| Client-team scoping | Staff and Article Assistants only ever see assigned clients; Managers their portfolio; Partners and Admin firm-wide |
| Audit trail | Audit Trail; changes by Managers/Partners/Admin are attributed by role |

Also included from P1 because the flows needed them: maker-checker submit/approve/return (a person can't
check their own work; Article Assistants are never checkers), acknowledgment capture (ARN, SRN, ITR ack,
challan, token, UDIN), and engagement budget signals using the spec §12 bands.

Wording follows spec §19 and §39: staff screens say "Hours Logged" and "Engagement Budget", never show
targets, and over-budget is shown neutrally to staff. The chargeable flag appears only to Partners and Admin.

## Try the end-to-end flow

1. **Farhan Sheikh (Practice Admin)** → Client Master → Add client. Pick a constitution, set GST Monthly
   and TDS, put Sneha on the team, and watch the preview count. Save → the client's Compliance tab lists
   the new tasks.
2. **Sneha Patil (Senior)** → Add Work a few times across different clients; Work shows the day total and
   the week grid. Open a task → Pending from Client → log a follow-up → Data received → Record filing with an ARN.
3. **CA Rajesh Iyer (Partner)** → This Week: compliance due this week by status, hours logged per person
   per day, pending-from-client list with days waiting, and Extend lock. Due-Date Master → Extend GSTR-3B to see
   tasks move across clients.
4. **Aditya Kumar** (new article, no clients) shows the "Allocations Pending" home.

More → Reset demo data restores the sample firm.

## Code map

- `src/lib/types.ts` — domain model mirroring `qepex_schema.sql` (camelCase; history tables embedded)
- `src/lib/master.ts` — seeded due-date master (spec §6, illustrative — verify before go-live) and stage templates (§9)
- `src/lib/compliance.ts` — engine: applicability, due-date rules (monthly / quarterly / annual / AGM-linked), generation, removal, extensions
- `src/lib/access.ts` — role permissions, client-team scoping, weekly lock
- `src/lib/seed.ts` — fictional firm and data relative to today
- `src/store.ts` — zustand store with every action (persisted to localStorage)
- `src/screens/*` — UI

## Not in this prototype

Real authentication and 2FA, a shared server database (each tester's browser has its own copy), offline
sync, leave, notices, DSC/UDIN registers, billing, articleship records, notifications, correction requests.
