# Rezonest Work OS — Proposal v1 (awaiting approval)

Defaults accepted on 02 Nov 2026: accent `#D7202A`, theme follows device; grand total rounded to
the nearest ₹ with a Round-off line; GST calculated per line; discount before GST; export
(no-GST) invoices supported but off by default; GST on by default; admin login
`yogeshwar@rezonest.com`; emails print to the console until SMTP is set up; separate
PI / INV / QT / CN number series in `2026-27` format; an accepted offer only notifies you and you
click "Convert to Project"; retainer tasks created on the 1st; working days Mon–Sat; extra libraries
(bcryptjs, date-fns(-tz), qrcode, cmdk, @aws-sdk/client-s3) approved.

---

## 1. Folder structure

```
rezonest-work-os/
├─ prisma/
│  ├─ schema.prisma            ← full schema (all 50+ models)
│  ├─ migrations/
│  └─ seed/
│     ├─ index.ts              ← `npm run db:seed`
│     ├─ master-data.ts        ← departments, sectors, sources, 8 services, templates
│     ├─ sample-data.ts        ← Pune sample clients, leads, offers, invoices…
│     └─ wipe-sample.ts        ← `npm run db:wipe-sample` (keeps settings + master data)
├─ public/  logo.png, icons/ (PWA icons later)
├─ src/
│  ├─ app/
│  │  ├─ (auth)/login, forgot-password, reset-password
│  │  ├─ (app)/                ← logged-in area, shared sidebar layout
│  │  │  ├─ dashboard/         ← Phase 1
│  │  │  ├─ settings/          ← Phase 1 (agency details, numbering, GST, reminders)
│  │  │  └─ leads/ clients/ offers/ projects/ tasks/ content/ ads/ renewals/
│  │  │     invoices/ payments/ expenses/ reports/ team/   ← "Coming in Phase N" placeholders
│  │  ├─ p/                    ← public no-login pages (offer accept, content approval)
│  │  └─ api/ auth/[...nextauth], search, cron/*
│  ├─ components/
│  │  ├─ ui/                   ← shadcn/ui
│  │  ├─ layout/               ← sidebar, topbar, command palette (Ctrl+K), quick-add "+"
│  │  ├─ data-table/           ← reusable TanStack table (search, filter, sort, paging, Excel)
│  │  ├─ charts/               ← Recharts wrappers
│  │  ├─ dashboard/            ← Today strip, KPI cards, pipeline, alerts, client table…
│  │  └─ shared/               ← StatusBadge, Money, DateText, EmptyState, skeletons
│  ├─ lib/
│  │  ├─ db.ts  auth.ts  permissions.ts  env.ts
│  │  ├─ money/   gst.ts  totals.ts  rounding.ts  words.ts (Indian)  format.ts (₹1,25,000.00)
│  │  ├─ dates.ts              ← IST helpers, financial year, DD MMM YYYY
│  │  ├─ numbering.ts          ← transaction-safe REZ/INV/2026-27/0001
│  │  ├─ status.ts             ← single colour map for every badge
│  │  └─ validators/           ← Zod schemas (shared by forms + server)
│  ├─ server/
│  │  ├─ queries/              ← read-only aggregated queries (dashboard.ts, search.ts…)
│  │  ├─ actions/              ← server actions (all Zod-validated + role-checked)
│  │  └─ jobs/                 ← reminder engine, retainer generator, overdue updater
│  └─ styles/globals.css       ← --accent CSS variable lives here
├─ tests/  unit/ (Vitest)   e2e/ (Playwright)
├─ docs/   PROPOSAL.md  PROGRESS.md  DECISIONS.md
├─ docker-compose.yml          ← local PostgreSQL
├─ .env.example
└─ README.md
```

## 2. Schema — summary

The full file is `prisma/schema.prisma`. It has already been checked with `prisma validate`.

| Group | Models |
|---|---|
| People | User, PasswordResetToken, Department, EmployeeProfile |
| Master data | Sector, LeadSource, Service, SubService, TaskTemplate, TaskTemplateStep, OnboardingTemplateItem |
| Sales | Lead, Client, ClientContact, Offer, OfferItem, OfferMilestone, OfferVersion, OfferStatusHistory, PublicLink |
| Delivery | OnboardingChecklist, OnboardingItem, Project, ProjectService, Milestone, Target, TargetProgress, Deliverable, RetainerRun, Task, TaskChecklistItem, TaskComment, TimeLog, ChangeRequest |
| Marketing | ContentCalendarItem, ContentApproval, AdCampaign, AdSpendEntry, DomainHostingAsset |
| Money | Invoice, InvoiceItem, CreditNote, Payment, PaymentAllocation, Expense |
| Records | Document, CommunicationLog, Reminder, Notification, EmailTemplate, EmailLog, ActivityLog, Settings, NumberSequence |

Key design choices (these go into DECISIONS.md once you approve):
1. **Money = `Decimal(14,2)` in rupees**, never floating point. All calculations go through one
   tested utility in `src/lib/money`, which the screen, PDF and database totals all use.
2. **Invoice number is assigned only when you click "Issue"**, inside a database transaction
   that locks that year's counter. Drafts have no number, so numbers are never skipped or reused.
   After issuing, the invoice is locked, and the client's and agency details are frozen in a snapshot.
3. **Deliverable** (added beyond your list) is one unit of committed work, e.g. "Reel 3 –
   Nov 2026". It powers "committed vs delivered" and revision counting.
4. **RetainerRun** and **Reminder.dedupeKey** make the monthly retainer job and the daily reminder
   job safe to run twice: they never create duplicates.
5. **Ad spend sits only in AdCampaign/AdSpendEntry**. It never counts toward revenue.
6. **Payments**: one Payment can be split across invoices through PaymentAllocation. Any amount
   left unallocated counts as an advance. Balance = total − paid − TDS − credit notes.
7. Domain assets have a `credentialsLocation` note only. **No passwords are stored anywhere.**
8. Public link tokens are stored as hashes, so a database leak doesn't reveal working links.

## 3. Dashboard number definitions (please check, these involve money)

| KPI | How it's calculated |
|---|---|
| Revenue (all charts) | Taxable value of **issued tax invoices**, **excluding GST**, minus credit notes. Proforma and cancelled invoices are excluded. |
| Invoiced this month | Same as above, for invoices dated this month |
| Received this month | Payments dated this month (cash received; TDS shown separately) |
| Total outstanding | Total balance due on issued, non-cancelled tax invoices |
| MRR | Sum of monthly value (excl. GST) of active retainer services on active projects |
| Offers pending | Count and ₹ value (excl. GST) of offers in Sent + On Hold |
| Conversion rate | Accepted ÷ (Accepted + Rejected + Expired), within the selected date range |
| Avg days to close | From offer date to accepted date |
| Profit (top clients) | Revenue − linked expenses − (logged hours × employee hourly cost) |
| % change | This month vs last month, for the same metric |

## 4. Phase 1 plan: Setup + Dashboard

1. **Project setup**: Next.js (App Router, TS strict), Tailwind, shadcn/ui, ESLint, Prettier,
   Vitest, Playwright, docker-compose PostgreSQL, `.env.example`.
2. **Database**: migrate the full schema; seed the master data (7 departments, 11 sectors,
   10 lead sources, 8 services with sub-services, task templates and onboarding items, and the
   default email templates) plus realistic Pune sample data (§11 of the brief). Includes
   `db:wipe-sample` to clear the sample data before go-live.
3. **Money & date core** (with tests): GST intra/inter-state, line totals, round-off, Indian
   number format, amount in words, financial year, invoice numbering (including a
   concurrency test), overdue detection, project health.
4. **Auth**: email/password login (bcrypt), login rate-limit and lockout, session timeout, password
   reset (the email prints to the console until SMTP is set up), and role checks wired in
   from day one.
5. **App shell**: sidebar with all 15 sections (unbuilt ones show "Coming in Phase N"), light and
   dark mode, mobile drawer, Ctrl/Cmd+K search (clients, offers, projects, tasks, invoices),
   quick-add "+" menu, status badge colour system.
6. **Settings page**: agency details, GST/bank/UPI, logo and signature upload (local disk in
   development), number formats, default GST and payment terms, reminder thresholds, digest
   time, working days.
7. **Complete Dashboard**: Today strip, 12 KPI cards with % change, pipeline (leads by stage,
   offers by status with ₹, conversion rate, average days to close), 8 charts, alerts panel (worked out
   live from the data for now; the stored and snoozable reminder engine arrives in Phase 6, though
   snooze will already work through the Reminder table), client work table (search, filter,
   sort, Excel export), upcoming deadlines (7 and 30 days), and global filters (date range, sector,
   service, department, employee). Every number comes from aggregated server queries, so no raw
   records are sent to the browser.
8. **Finish**: lint, type-check, tests, production build; then PROGRESS.md, DECISIONS.md, README
   (setup steps), a git commit `feat(phase-1): setup, schema, auth, settings, dashboard`, and simple
   steps for you to test it.

**Phase 1 won't include**: the forms to create and edit leads, clients, offers and so on
(Phases 2–8). Until then, the Dashboard shows the seeded sample data.

## 5. Phases 2–10

Unchanged from §14 of the brief.
