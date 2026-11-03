# Progress

## Phase 1: Setup, schema, auth, settings, dashboard ✅ (02 Nov 2026)

### Done
- **Project setup**: Next.js 15 (App Router, TypeScript strict), Tailwind 4, shadcn-style UI
  components, ESLint, Prettier, Vitest, Playwright, docker-compose PostgreSQL, `.env.example`.
- **Database**: full schema (54 tables) migrated, including every model from the brief plus
  `Deliverable`, `RetainerRun`, `OfferMilestone`, `OnboardingTemplateItem`, `EmailLog` and
  `PasswordResetToken`.
- **Seed**:
  - Master data: 7 departments, 11 sectors, 10 lead sources, 8 services with sub-services,
    task templates, onboarding checklists and 6 email templates.
  - Pune sample data, generated relative to today: 12 clients, 15 leads, 22 offers in every
    status, 14 projects (retainers, 2 websites with milestones, one IGST client in Bengaluru),
    290 tasks, 188 content calendar items, Meta Ads spend, 8 domains/hosting assets expiring
    in 1/7/15/30+ days, 83 invoices (paid, partial, overdue, TDS, one credit note, drafts,
    one proforma), 63 payments, 63 expenses and 5 employees.
  - `pnpm db:wipe-sample` clears it all before go-live.
- **Money & dates core** (tested): GST intra/inter-state/no-GST/export, per-line tax,
  discount before GST, rupee round-off, Indian ₹ format, amount in words (Lakh/Crore), IST
  dates, financial year, transaction-safe numbering (concurrency tested), balance with TDS
  and credit notes, payment status/overdue, ageing buckets, project health.
- **Auth**: email/password (bcrypt), account lock after 5 wrong passwords (15 min), IP rate
  limit, 12-hour session timeout, password reset by email (1-hour single-use link), role
  checks on every page, action and API route.
- **App shell**: sidebar with all 15 sections (unbuilt ones show "Coming in Phase N"), mobile
  menu, light/dark/system theme, Ctrl/Cmd+K global search (clients, offers, projects, tasks,
  invoices, filtered by role), quick-add "+" menu, bell with today's attention count,
  consistent status colours, error pages.
- **Settings**: agency details, GSTIN/PAN/bank/IFSC/UPI (format-checked, GSTIN↔state↔PAN
  cross-checked), number formats with live preview, GST/payment/offer defaults, reminder
  thresholds, digest time, working days, quotation and invoice terms, brand colour, logo and
  signature upload (file type checked by content). Every change goes to the activity log.
- **Dashboard** (all from aggregated server queries, streamed section by section):
  - Today strip (each item opens the matching alerts).
  - 12 KPI cards with % change.
  - Pipeline with conversion rate and average days to close.
  - Alerts panel with 11 categories, snooze 1/3/custom days or mark done.
  - Upcoming deadlines (7/30 days).
  - Client work table: search, filters, sort, pagination, column picker, Excel export.
  - 8 charts/panels, each chart with a "view as table" option.
  - Global filters: date range presets, custom dates, sector, service, department, employee.
  - Employees see an "own tasks" view.
- **Tests**: 83 unit + integration tests, 10 end-to-end browser tests (desktop + phone). All passing.

### How each dashboard number is calculated
See `docs/DECISIONS.md` → D-09.

### Known issues / limitations
- Links from the dashboard to tasks, invoices etc. open "Coming in Phase N" pages until those
  screens are built.
- The alerts list is calculated live. The stored daily reminder job, notification bell list
  and email digest come in Phase 6. Snoozes made now carry over (same keys).
- The IP rate limit lives in server memory (per server). The database account lock works everywhere.
- The `prisma` seed config in package.json shows a deprecation notice (harmless until Prisma 7).

## Phase 2: Leads, Clients, master data, Excel import ✅ (03 Nov 2026)

### Done
- **Leads**: list with search (phone numbers match however they were typed), filters, sort,
  paging, column picker and Excel export. Add and edit forms. Detail page with one-tap call,
  WhatsApp and email, stage history and offers. Lost needs a reason, a Lost lead can be reopened,
  and archive/restore is available.
- **Convert lead to client**: details are carried across and GST is checked. It warns if the
  phone, email or GSTIN already exists, and offers "Link to this client". The lead becomes Won,
  and its offers and notes move to the client. A lead can only be converted once, even if
  clicked several times at the same moment.
- **Clients**: list, forms, one primary contact plus any number of others. All 14 tabs exist.
  Overview, contacts and Activity work fully. The others show recorded data read-only until their
  own phase. Invoices, Payments, Expenses and outstanding amounts are hidden from non-finance roles.
- **Archive safety**: a client with unpaid invoices or a running project can't be archived,
  because the outstanding total on the dashboard would quietly become wrong.
- **Excel/CSV import** for leads and clients: template download, preview with errors, warnings and
  duplicates, tick to import a duplicate anyway. All-or-nothing save, 5 MB / 2,000 rows.
- **Service catalogue** (Settings): price, GST, SAC, billing type, revisions, default KPIs and
  deliverables, sub-services, and task templates with reorderable steps.
- **Lists** (Settings): sectors, lead sources and departments. Add, rename, switch off.
- **Dashboard**: Won/Lost "in period" now uses real stage history. Follow-up alerts open the client.
- **Fixed from Phase 1**: logo upload failed above 1 MB although 2 MB was promised. The dashboard's
  "Clear" sometimes did nothing. The sidebar no longer pre-fetches all 15 sections on each page load.
- **Database**: added `LeadStageHistory` and `ClientContact.archivedAt`. One client can now have
  several leads. Additive only; existing leads got a starting history row.
- **Tests**: 196 unit + integration tests (113 new), 23 end-to-end browser tests (13 new). All passing.

### Known issues / limitations
- Import matches columns by heading name. There is no screen to map unusual headings by hand;
  unrecognised columns are listed in the preview and ignored.
- If a client's state is blank and there is no GSTIN, import assumes Maharashtra and shows a
  warning on that row.
- Settings → Agency & rules still checks fields when you leave them, so the Save bar can move
  under the mouse in rare cases (see D-15). The Phase 2 forms don't do this.
- Client tabs show the latest 50 records, without paging, until each section's own phase.
- Editing a record that already has a known duplicate shows the warning on each save.
- Duplicate lookup loads all clients and leads into memory. Fine for thousands of records.
- Not yet on GitHub: this copy has no remote configured.

## Phase 3: Offers ⏳ (not started)
