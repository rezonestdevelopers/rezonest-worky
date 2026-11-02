# Rezonest Work OS — Agency Management System
### Project brief for Claude Code (keep this file in the project root as CLAUDE.md)

You are a senior full-stack engineer and product designer building an internal web
application for my digital marketing agency, **Rezonest Digital & Services**
(https://rezonest.com), based in Bhosari, Pune, Maharashtra, India.

I am the owner and the **Admin**. I receive enquiries, send offers (quotations), assign work
to employees/departments, track deliverables and deadlines, raise GST invoices, and track
payments. This app must become the single place where I run the whole agency, every day.

---

## 0. How to work with me (read first, follow always)

1. Read this entire file before doing anything.
2. Ask your clarifying questions first — short, grouped, numbered.
3. Propose: folder structure, full Prisma schema, and the phase plan. Wait for my approval.
4. Build **one phase at a time**. Never start the next phase without my "go ahead".
5. After each phase:
   - Run lint, type-check, tests and a production build. Fix everything before reporting.
   - Make a git commit with a clear message (e.g., `feat(phase-1): dashboard`).
   - Update `docs/PROGRESS.md` (what's done, what's pending, known issues).
   - Record important technical decisions in `docs/DECISIONS.md`.
   - Tell me exactly how to run and test it, step by step, in simple language.
6. Never break features from earlier phases. If a change affects earlier work, tell me first.
7. Ask before adding a major dependency, changing the schema in a breaking way, or adding
   features not in this brief.
8. Explain in simple English — I am the business owner, not a full-time developer.
9. If something in this brief is unclear or conflicts, ask — don't guess on money, GST,
   invoices or data deletion.

**Definition of Done for any feature**: works on desktop and mobile, validated on server,
permission-checked, has loading/empty/error states, covered by tests where it involves
money, dates or status logic, and documented in PROGRESS.md.

---

## 1. Tech stack

- **Next.js (App Router) + TypeScript** (strict mode)
- **PostgreSQL + Prisma ORM** — migrations + seed script. Relational DB is required because
  offers, projects, tasks, invoices and payments are tightly linked.
- **Tailwind CSS + shadcn/ui**, **Recharts** for charts, **lucide-react** icons
- **TanStack Table** for data tables (sorting, filtering, pagination, column visibility)
- **Auth.js (NextAuth)** — email/password, password reset by email, role-based access
- **Zod** + **React Hook Form** for validation and forms
- **Nodemailer** (SMTP via .env — works with Google Workspace / Zoho for @rezonest.com)
- **@react-pdf/renderer** for offer, invoice and report PDFs
- **exceljs** for Excel export; CSV/Excel import for existing clients
- **File storage**: S3-compatible (AWS S3 Mumbai region or Cloudflare R2), local disk in dev
- **Scheduled jobs**: protected cron API routes (works on Vercel Cron or a VPS cron);
  node-cron acceptable for local dev
- **PWA**: installable on my phone home screen
- Timezone **Asia/Kolkata** everywhere; dates displayed as DD MMM YYYY
- Currency **INR (₹)** with Indian number format (₹1,25,000.00) and amount in words in the
  Indian system ("Rupees One Lakh Twenty-Five Thousand Only")
- All secrets/config in `.env`, with a documented `.env.example`
- Testing: **Vitest** (unit) + **Playwright** (key end-to-end flows)

---

## 2. Branding & UI

- App name: **Rezonest Work OS**. Logo placeholder at `/public/logo.png` (I will provide the
  file). Brand colours: ask me; until then use one accent colour defined as a CSS variable
  so it can be changed in one place.
- Style: minimal, premium, modern. Subtle glassmorphism on cards is welcome, readability
  first. Light and dark mode. Fully responsive — I often use it on my phone.
- Sidebar: Dashboard, Leads, Clients, Offers, Projects, Tasks, Content Calendar, Ads,
  Renewals, Invoices, Payments, Expenses, Reports, Team, Settings.
- **Global search** (Ctrl/Cmd + K) across clients, offers, projects, tasks, invoices.
- **Quick-add "+" button** everywhere: New Lead, Client, Offer, Task, Invoice, Payment.
- Status badges with consistent colours across the app (e.g., green = done/paid,
  amber = pending/due soon, red = overdue/rejected, grey = draft/archived).
- Every list: search, filters, sort, pagination, export to Excel.

---

## 3. Agency settings (stored in DB, editable in Settings — never hard-coded)

- Name: Rezonest Digital & Services
- Address: Gera's Imperium Gateway, C Tower, C-340, Nashik Phata Metro, behind Bhosari
  Metro Station, Bhosari, Pune, Maharashtra 411034, India
- Email: yogeshwar@rezonest.com | Phone/WhatsApp: +91 9730258208 | Website: rezonest.com
- State for GST: Maharashtra (state code 27)
- Empty fields I will fill: GSTIN, PAN, bank name, account no., IFSC, UPI ID, signature
  image, invoice/quotation terms & conditions
- Number formats (configurable): `REZ/QT/2026-27/0001`, `REZ/PI/2026-27/0001`,
  `REZ/INV/2026-27/0001`, `REZ/CN/2026-27/0001` — reset each financial year (Apr–Mar),
  never reused, generated safely inside a DB transaction
- Daily digest time (default 9:00 AM IST), reminder thresholds, default GST rate (18%),
  default payment terms (e.g., 7/15/30 days), working days

---

## 4. Users, roles & permissions

| Area | Admin | Manager (optional, later) | Employee |
|---|---|---|---|
| Dashboard (full, with money) | ✅ | ✅ without profit | Own tasks only |
| Leads, Clients, Offers | ✅ | ✅ | ❌ |
| Projects & Tasks | ✅ | ✅ | Assigned / own department only |
| Prices, Invoices, Payments, Expenses, Profit | ✅ | ❌ | ❌ |
| Team & Settings | ✅ | ❌ | ❌ |

- Employee can: view assigned tasks, change status, log time, comment, upload files.
- Employee profile: name, email, phone, department, designation, joining date, active flag.
- Deactivating an employee keeps their history and asks me to reassign open tasks.

---

## 5. Service catalogue (seed this; admin can add/edit/deactivate)

Each service has: name, department, billing type, default price, unit, GST rate (default
18%), SAC code (editable, blank in seed), default task template, default KPIs, default
deliverables, revisions included per deliverable (default 2).

**Billing types**: `ONE_TIME`, `MONTHLY_RETAINER`, `PER_UNIT`, `MILESTONE`, `ANNUAL_RENEWAL`

1. **Digital Marketing** (strategy & campaigns) — MONTHLY_RETAINER
   Strategy, campaign planning, lead generation, Google Ads, email/WhatsApp marketing,
   monthly performance report.
2. **Social Media Marketing** — MONTHLY_RETAINER
   Account setup & optimisation, content calendar, posting & scheduling, community
   management. Platforms: Instagram, Facebook, LinkedIn, YouTube, X.
3. **Reels & Posts** (content production) — PER_UNIT or monthly package
   Units: static post, carousel, reel, story. Package example: "12 posts + 8 reels/month".
4. **Meta Ads** (Facebook & Instagram) — MONTHLY_RETAINER (management fee)
   **Client's ad budget is tracked separately from our management fee — ad spend is NOT our
   revenue.** Track planned budget, actual spend, impressions, clicks, CTR, leads, CPL, ROAS.
5. **Graphic Design & Video Creation / Editing** — PER_UNIT or ONE_TIME
   Logo & brand identity, creatives, brochures/catalogues, video shoot, video editing,
   motion graphics, YouTube videos.
6. **SEO Services** — MONTHLY_RETAINER
   SEO audit, keyword research, on-page, technical SEO, off-page/backlinks, local SEO /
   Google Business Profile, monthly ranking report.
7. **Web & Software Development** — MILESTONE
   WordPress website, WooCommerce store, Next.js/MERN web app, custom ERP/CRM, UI/UX design,
   website maintenance (MONTHLY_RETAINER).
   Default milestones: Requirements & Specs → UI/UX Design → Development → Testing →
   Launch → Maintenance. Default payment split 50% / 30% / 20% (editable per offer).
8. **Domain & Hosting** — ANNUAL_RENEWAL
   Per client: domain, registrar, purchase date, expiry, hosting provider, plan, hosting
   expiry, SSL expiry, business email accounts, our cost price, renewal selling price,
   auto-renew flag. **Never store passwords** — only a "where credentials are kept" note.

---

## 6. Departments, sectors, lead sources (seed; admin-editable)

- **Departments**: Strategy & Digital Marketing, Social Media, Design & Video,
  Performance Ads (Meta/Google), SEO, Web & Software Development, Accounts.
- **Sectors**: Manufacturing & Industrial (MIDC), Automobile & Auto Components,
  Real Estate & Construction, Healthcare & Clinics, Education & Coaching,
  Retail & E-commerce, Hospitality & Restaurants, IT & Services, Finance & Insurance,
  Personal Brand, Other.
- **Lead sources**: Instagram, Facebook, LinkedIn, Website, Google, Referral, WhatsApp,
  Walk-in, Cold call, Other.

---

## 7. Business workflow (the app must follow this exactly)

### 7.1 Lead / enquiry
Capture: contact person, company, phone, WhatsApp, email, sector, city, lead source,
services interested in, approximate budget, requirement notes, next follow-up date.
Lead stages: **New → Contacted → Requirement Discussed → Offer Sent → Won / Lost**
(with lost reason). Converting a lead creates a Client (avoid duplicates — warn if the same
phone/email/GSTIN already exists).

### 7.2 Client
Company name, contact persons (multiple, one primary), phone, WhatsApp, email, website,
sector, city, state (for GST), billing address, GSTIN (optional, format-validated), PAN
(optional), lead source, account manager, tags, notes, status (Active / Inactive /
Archived). Client detail page tabs: **Overview, Offers, Projects, Tasks, Content Calendar,
Ads, Renewals, Invoices, Payments, Expenses, Documents, Communication Log, Reports,
Activity**.

### 7.3 Offer / quotation
- Line items from the service catalogue: service, sub-service, description, qty, unit,
  rate, discount (% or ₹), GST; billing type; duration (e.g., 6-month retainer);
  payment terms/milestones; validity date; terms & conditions; notes.
- Branded PDF; send by email from the app; **"Share on WhatsApp"** button (wa.me link with
  pre-filled message and the offer link — no WhatsApp API needed).
- **Public offer link** (secure random token, expiry, no login): client can view the offer
  and click **Accept** or **Request Changes**. On accept, capture name, date-time and IP,
  update status automatically and notify me.
- Status flow: **Draft → Sent → On Hold → Accepted / Rejected (reason) / Expired**
  (auto after validity). Full status history with dates and who changed it.
- **Follow-up date** required on Sent/On Hold offers; reminders until resolved.
- Revisions (v1, v2…) with history; duplicate an offer; offer templates for common
  packages (e.g., "Starter Social Media Package").

### 7.4 Client onboarding (auto-created when an offer is accepted)
Checklist per client, customisable per service, e.g.: logo & brand guidelines received,
Meta Business Manager / ad account access, Instagram/Facebook page access, Google Business
Profile access, website/hosting access, Google Analytics & Search Console access,
advance payment received, kick-off meeting done. Show onboarding % on the project.

### 7.5 Project
One click converts an accepted offer into a Project (copies client, services, prices,
payment terms). I set: start date, deadline or retainer period (start/end, auto-renew
flag), project manager, and **targets/KPIs per service**, e.g.:
- Social Media: posts & reels per month, followers, reach, engagement rate
- Meta Ads: monthly budget, leads, CPL, ROAS
- SEO: target keywords & positions, organic traffic
- Web Dev: milestones and launch date
- Design/Video: number of deliverables
Project page: targets vs actual (monthly entries), milestones, progress %, health status
(On Track / At Risk / Delayed — auto-calculated from overdue tasks and missed milestones,
manually overridable).

### 7.6 Tasks & work assignment
- Auto-generate tasks from each service's **task template** (editable), e.g.:
  - Reel: Concept/Script → Shoot → Edit → Internal Review → Client Approval → Post
  - Post: Caption & Design → Internal Review → Client Approval → Schedule/Post
  - Meta Ads: Audience research → Creatives → Campaign setup → Launch → Optimisation →
    Weekly report
  - SEO: Audit → Keyword research → On-page → Off-page → Monthly report
  - Website: per milestone
  - Domain & Hosting: Purchase/Setup → DNS & SSL → Email setup → Renewal
- Task fields: title, description, project, client, service, assignee and/or department,
  priority (Low/Medium/High/Urgent), start date, due date, status (**To Do / In Progress /
  In Review / Waiting for Client Approval / Done / Blocked**), checklist, comments,
  attachments, time logged, revision count, blocked reason.
- **Revisions & scope control**: track revisions per deliverable; when a deliverable exceeds
  included revisions, or a client asks for work outside the offer, log a **Change Request**
  (description, estimate, billable yes/no, approved/rejected) that can be added to the
  next invoice.
- **Retainers auto-create next month's deliverables and tasks** on a chosen day (default
  the 1st), based on the package (e.g., 12 posts + 8 reels).
- Views: list, **Kanban**, calendar, "My Tasks". Bulk reassign and bulk status change.
- Employees get an in-app notification (and optional email) when assigned or mentioned.

### 7.7 Content calendar (Social Media / Reels & Posts)
Per client, monthly calendar of posts/reels/stories: platform, format, topic, caption,
creative file, design status, approval status, publish date, published link.
- **Client approval link** (secure token, no login): client sees the month's content and
  clicks Approve or Request Changes with a comment on each item.
- Show **committed vs delivered** per month (e.g., 8/12 posts, 5/8 reels).

### 7.8 Meta Ads tracking
Per client: campaigns (name, objective, start/end, budget), daily/weekly spend entries and
results (manual entry or CSV upload from Ads Manager), auto-calculated CTR, CPL, ROAS,
budget utilisation %. (Meta API integration only as a later optional phase.)

### 7.9 Domain & hosting renewals
Renewals page listing all assets sorted by nearest expiry, with colour coding and
"Create renewal invoice" action. Tracks our cost vs renewal price (margin).

### 7.10 Daily reminders & alerts
Every day, generate and show:
- Tasks due today, due in next 3 days, and overdue (by employee and client)
- Items **waiting for client approval** for more than 2 days
- Project deadlines and milestones approaching; onboarding items pending
- Leads and offers needing follow-up; offers about to expire
- Invoices due and overdue payments
- **Domain, hosting and SSL renewals due in 30 / 15 / 7 / 1 days**
- Retainers ending in the next 30 days
- Meta Ads budget > 85% used
- Retainer months where delivered < committed with less than 5 days left in the month

Delivery: dashboard alerts panel, notification bell, **daily email digest to me at
9:00 AM IST** (configurable), and an optional daily task digest for each employee.
Reminders can be marked done or snoozed (1 day / 3 days / custom). The job must be
idempotent (no duplicate reminders if it runs twice).

### 7.11 Invoices (Indian GST format)
- Create from: a project, a milestone, a retainer month, a renewal, change requests, or
  blank.
- Types: **Proforma Invoice** (advance / before work) and **Tax Invoice**; a proforma can be
  converted to a tax invoice.
- Contents: agency details + logo + GSTIN, client details + GSTIN + state, invoice date,
  due date, **place of supply**, line items with SAC code, qty, rate, discount, taxable
  value, **CGST 9% + SGST 9% when client state = Maharashtra, IGST 18% otherwise**
  (auto-decided, rates editable, GST can be switched off for non-GST invoices), round-off,
  grand total, amount in words, bank details, UPI ID + **UPI QR code**, terms, authorised
  signatory.
- Branded PDF; email; WhatsApp share.
- **Once issued, an invoice is locked.** Corrections are done through a **Credit Note**
  (linked to the original invoice) or by cancelling (with reason). Never edit or delete an
  issued invoice.
- Retainers: auto-create a **draft** invoice each month for my review (never auto-sent).
- Renewals: auto-create a draft renewal invoice 30 days before expiry.

### 7.12 Payments
- Invoice payment status: **Unpaid / Partially Paid / Paid / Overdue** (auto after due
  date) / **Cancelled**.
- Record payments: date, amount, mode (UPI, NEFT/RTGS/IMPS, Cheque, Cash, Card), reference
  no., **TDS deducted by client** (amount + section, optional), notes. One payment can be
  split across multiple invoices; advance payments can be adjusted against later invoices.
- Balance = total − payments − TDS − credit notes.
- **Payment reminder** to the client: one-click email/WhatsApp using an editable template
  (polite, firm, final). Sent only when I click — never automatically.
- **Client ledger / statement of account** (downloadable PDF) and **ageing report**
  (0–30, 31–60, 61–90, 90+ days).

### 7.13 Expenses & profitability
Record expenses: date, category (freelancer, stock assets, software/tools, domain/hosting
cost, travel, printing, other), amount, GST paid, client/project link (optional), bill
attachment. Show **profit per project and per client** (revenue − linked expenses −
optional employee time cost at an hourly rate I set per employee). Monthly agency
revenue vs expenses.

### 7.14 Documents & communication log
- Per client documents: agreements/NDAs, brand assets, briefs, reports, invoices — with
  upload, preview and download.
- Communication log: calls, meetings, WhatsApp/email notes with date, summary, next action
  (next action can create a reminder).

### 7.15 Reports (download as PDF + Excel)
- **Client report (internal)**: profile, offers & status history, projects, services,
  targets vs actual, deliverables committed vs delivered, task timeline (planned vs actual,
  delays), change requests, ad spend & results, invoices, payments, TDS, outstanding,
  expenses and profit. Filter by date range or month.
- **Monthly performance report (for the client)** — branded, no internal prices, costs or
  employee details: deliverables, KPIs, ads results, SEO rankings, highlights, next month
  plan. Can be emailed from the app.
- **Agency reports**: revenue by month/service/sector/lead source, offer conversion rate,
  MRR trend, outstanding & ageing, employee workload and on-time %, renewals calendar,
  profit by client/service, GST summary (output tax by month for my CA).

### 7.16 Data, history & safety
- Everything stored permanently with created/updated timestamps and created-by.
- **Soft delete / archive only** for business records; issued invoices are immutable.
- **Activity log** for every important action (who, what, when, old → new value).
- **Import** existing clients/leads from Excel/CSV (with preview and duplicate check).
- **Full data export** (Excel/CSV per table) from Settings.
- Automated **daily database backup** (pg_dump to storage, keep 30 days) + restore steps
  in the README.

---

## 8. DASHBOARD (Home) — BUILD THIS FIRST

**Top: "Today" strip** — today's date, tasks due today, approvals pending, follow-ups due,
payments due, renewals this week (each clickable).

**KPI cards** (with % change vs last month):
Total clients, Active clients, Active projects, Open leads, Offers pending (Sent + On Hold)
with ₹ value, Offers accepted this month, **MRR** from retainers, Invoiced this month,
Received this month, Total outstanding, Overdue tasks, Projects at risk.

**Pipeline**: leads by stage and offers by status (Draft, Sent, On Hold, Accepted,
Rejected, Expired) with count and ₹ value; conversion rate; average days to close.

**Charts**:
- Revenue invoiced vs received — last 12 months
- Revenue by service (8 services)
- **Sector-wise**: clients, revenue and active projects per sector
- Lead source: leads, conversions and revenue by source
- Team workload: open tasks per employee/department; on-time vs late completion
- Deliverables this month: committed vs delivered (posts, reels, videos)
- Top 5 clients by revenue and by profit
- Outstanding ageing (0–30, 31–60, 61–90, 90+)

**Alerts & reminders panel** (colour-coded, clickable, snoozable): overdue tasks, due
today, waiting for client approval, lead/offer follow-ups, overdue payments, upcoming
renewals, ad budget alerts, retainer delivery shortfall, retainers ending.

**Client work table**: client, sector, services, active project, target, deadline,
progress %, health (On Track / At Risk / Delayed), assigned team, payment status,
outstanding ₹, next action. Searchable, filterable, sortable, exportable.

**Upcoming deadlines**: timeline/calendar for next 7 and 30 days.

**Global filters**: date range (this month default), sector, service, department, employee.

Dashboard must load fast: use aggregated queries, not loading every record into the
browser.

---

## 9. Data model (suggested — refine and show me before migrating)

User, Department, Employee profile, Lead, Client, ClientContact, Sector, LeadSource,
Service, SubService, TaskTemplate, TaskTemplateStep, Offer, OfferItem, OfferVersion,
OfferStatusHistory, PublicLink (token, type, expiry), OnboardingChecklist + Item, Project,
ProjectService, Milestone, Target + TargetProgress, Task, TaskChecklistItem, TaskComment,
TimeLog, ChangeRequest, Attachment/Document, ContentCalendarItem, ContentApproval,
AdCampaign, AdSpendEntry, DomainHostingAsset, Invoice, InvoiceItem, CreditNote, Payment,
PaymentAllocation, Expense, CommunicationLog, Reminder, Notification, EmailTemplate,
ActivityLog, Settings, NumberSequence.

---

## 10. Security & quality rules

- Money: integer paise or Prisma Decimal — **never floating point**.
- One tested utility for all GST/totals/rounding; PDF and screen must always match.
- Server-side Zod validation on every mutation; role check on every route/server action.
- Public links (offer accept, content approval): long random tokens, expiry, rate-limited,
  show only that one record, revocable.
- Passwords hashed (bcrypt/argon2); session timeout; login rate limiting.
- No secrets in code or git. No credentials of client accounts stored in the app.
- Confirmation dialogs before archive/cancel; nothing important hard-deleted.
- Empty states, loading skeletons, error boundaries and toast messages throughout.
- Pagination on all lists; DB indexes on foreign keys, status and date fields.
- Accessible UI (labels, keyboard navigation, sufficient contrast).

## 11. Seed data
Realistic Pune-area sample data: ~15 leads across stages, ~12 clients across sectors and
lead sources, offers in every status, active retainers (social, reels, Meta ads, SEO), one
website project with milestones, content calendar items with approvals, ad spend entries,
domains expiring within 7/15/30 days, invoices (paid, partial, overdue, with TDS, one
credit note), expenses, and 5 employees across departments — so the dashboard looks real on
first run. Include a command to wipe seed data before going live.

## 12. Tests
- Unit (Vitest): GST intra/inter-state, rounding, amount in words (Indian), invoice
  numbering per financial year (and concurrency), overdue detection, payment allocation &
  balance with TDS and credit notes, offer → project conversion, retainer task generation,
  reminder generation (idempotent), renewal alerts, project health calculation.
- End-to-end (Playwright): login → create client → create offer → accept via public link →
  project & tasks created → mark tasks done → create invoice → record payment → dashboard
  updates.

## 13. Deployment & docs
README with: local setup, `.env` variables, migrations & seed, running cron jobs,
deployment (Vercel + managed PostgreSQL in Mumbai region, or a VPS with Docker), backups &
restore, how to add a new employee, how to change GST/number settings.

---

## 14. Build phases

- **Phase 1** — Setup, full schema, auth (Admin), Settings (agency details), seed data, app
  layout/sidebar/global search shell, and the **complete Dashboard** (Today strip, KPIs,
  pipeline, charts, alerts, client table, deadlines, filters).
- **Phase 2** — Leads, Clients (all tabs scaffolded), sectors, lead sources, service
  catalogue & task templates, Excel import.
- **Phase 3** — Offers: create, versions, templates, PDF, email/WhatsApp share, public
  accept link, status flow, follow-ups.
- **Phase 4** — Onboarding checklist, Projects, milestones, targets/KPIs, health status,
  Tasks (list/Kanban/calendar), change requests, Team & departments, retainer auto-tasks.
- **Phase 5** — Content calendar with client approval link, Meta Ads tracking,
  Domain & Hosting renewals.
- **Phase 6** — Reminder engine, notification bell, daily email digests, email templates.
- **Phase 7** — GST invoices (proforma, tax, credit notes, UPI QR), payments, TDS,
  allocation, payment reminders, ledger & ageing.
- **Phase 8** — Expenses & profitability, documents, communication log.
- **Phase 9** — Reports (internal + client-facing, PDF + Excel), GST summary, data export,
  backups.
- **Phase 10** — Employee portal & permissions polish, PWA, performance and security
  review, production deployment.

**Start now**: ask your clarifying questions, then propose the folder structure, full
schema and the Phase 1 plan.
