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

## Phase 3: Offers ✅ (03 Nov 2026)

### Done
- **Offers**: list with search, filters (status, follow-up due, expiring soon), sorting, paging and
  Excel. A form with catalogue items, sub-services, quantity, discount (% or ₹), GST, months,
  monthly package, payment milestones (must total 100%), payment terms and T&C.
- **Live GST** on the form: CGST + SGST or IGST from the client's state. Leads have no state, so
  you choose the place of supply. GST can be switched off. Clients abroad are export, with no GST.
- **Branded PDF**, with figures from the same code as the screen and the client's page.
- **Sending**: email with the PDF and link, or "Share myself" with a WhatsApp message and link. An
  offer only becomes Sent after the email really went out. A follow-up date is required.
- **Client's page** (no login): view, download PDF, Accept (name and tick box; records name, time,
  IP and version), or Request Changes (goes On Hold and notifies you). Only that one offer is
  visible. Links can't be guessed, are rate limited, and stop working on expiry, rejection,
  archiving or a new version.
- **Status flow** with full history: Draft → Sent → On Hold → Accepted / Rejected (reason) /
  Expired (automatic). Sending moves an open lead to Offer Sent.
- **Versions**: only drafts are edited. Changing a sent offer starts v2 with the same number and
  the old link stops working. Every sent version is kept. Accepted offers are locked.
- **Duplicate** and **templates**, which use no quotation number. Two starter templates are included.
- **Bell**: lists new notifications, which can be marked as read. The full centre comes in Phase 6.
- **Daily job**: `/api/cron/expire-offers`. The offers pages also expire overdue offers when opened.
- **Tests**: 257 unit + integration tests (61 new), 31 end-to-end browser tests (8 new). All passing.

### Known issues / limitations
- Totals on retainer offers are for one month. Duration is shown but isn't multiplied (D-23).
- Email templates can't be edited on screen until Phase 6. Sent emails go to the console until SMTP is set.
- Changing `AUTH_SECRET` makes existing client links stop working (D-22).
- Rate limits live in server memory, so they're per server.

## Phase 4: Onboarding, Projects, Tasks, Team ✅ (03 Nov 2026)

### Done
- **Onboarding checklist**: starts by itself when an offer is accepted, or when a lead with an
  accepted offer becomes a client. Tick, add and remove items. It moves to the project on conversion.
  Standard items are edited under Settings → Lists (every client) and on each service (D-36).
- **Convert to project**: one click on an accepted offer copies client, services, prices and terms.
  You set the manager, dates, retainer end (worked out from the offer), auto-renew, milestones and
  targets. It can't happen twice, even if clicked twice at once.
- **Projects**: list with search, filters, sorting, paging and Excel. Project page with Overview,
  Tasks, Deliverables, Milestones, Targets, Change requests and Onboarding. Progress and health are
  automatic, and you can override health if you give a reason.
- **Targets vs actual**: monthly results for each target. Entering a month again corrects it.
- **Tasks**: list, Kanban (drag on a computer, menu on a phone), calendar and My Tasks. Task page
  with checklist, comments with @mentions, time logs, revisions and file attachments. Bulk reassign
  and bulk status. The list opens on open tasks; "All tasks" shows finished and "Archived" the rest.
- **Tasks from templates**: created on conversion, on working days only, one after another. Per-unit
  items get one set per unit (D-37). Linked to a milestone when their first words match.
- **Retainers**: each month's deliverables and tasks are created automatically on the chosen day, or
  early by a button. A month is never created twice (D-33). Committed vs delivered per month.
- **Change requests**: log, estimate, billable or not, approve or reject. Adding a revision past the
  included number prompts you to log one. They can go on an invoice in Phase 7.
- **Team**: list with workload, add person (they get a link to set their own password), edit, hourly
  cost, deactivate with a choice of who takes their open tasks, reactivate. The last admin is protected.
- **Employee access**: only their tasks and department's, and those projects. No prices, sales, team
  or settings. They can change status, log time, comment and upload.
- **In-app notifications** when a task is assigned, you're mentioned, or a task is blocked or done.
- **Daily job**: `/api/cron/daily-work` (D-34). Pages also run it at most every 10 minutes.
- **Tests**: 319 unit + integration tests (62 new), 38 end-to-end browser tests (7 new). All passing.

### Known issues / limitations
- A monthly package creates a lot of tasks: 12 posts + 8 reels is about 96 a month (D-29). See the
  open question in the Phase 4 report.
- Tasks are assigned to departments, not people, until a manager assigns them (D-31).
- Assignment emails, the digest and reminders come in Phase 6. Phase 4 notifications are in-app only.
- New team members and password links need SMTP to reach them. Until it's set, the email goes to the
  server console.
- Custom offer items with no service aren't copied to the project. The convert page warns you.
- Working days know weekly offs, not public holidays.
- The Kanban board shows the first 300 tasks, and says so; filters narrow it down.
- Change request estimates are visible to Managers, as offer prices are (D-27). Payment percentages
  show to Managers, but the rupee amounts don't.
- Client "Change request → invoice" arrives in Phase 7, and auto-renew doesn't bill anything yet (D-35).

## Phase 5: Content calendar, Meta Ads, Domain & Hosting ✅ (04 Nov 2026)

### Done
- **Content calendar**: month view and list, with filters, sorting, paging and Excel. Add items by
  hand, and each retainer month adds its package items by itself. Platforms, format, topic, caption,
  creative, design status, approval status, publish date and live link.
- **Client approval link**: no login, one client and one month only. Approve or request changes on
  each item, with name, time and IP recorded. Share by copying, WhatsApp or email. Works for 30 days,
  and can be withdrawn. The team is told in the app about each answer.
- **Linked to the work**: approval finishes the approval step, changes send waiting work back and
  count a revision, and publishing needs approval and finishes the deliverable's tasks.
- **Committed vs delivered** per client and month, such as 8/12 posts and 5/8 reels.
- **Meta Ads**: campaigns with the client's budget, kept apart from your revenue. Daily or weekly
  results by hand, with CTR, CPL, ROAS and budget used worked out. Colours at the alert level and at 100%.
- **Ads Manager reports**: upload CSV or Excel, check the preview, confirm. Uploading twice adds nothing.
- **Renewals**: all domains, hosting, SSL and business email, nearest expiry first and colour coded,
  with filters, cost, price, margin, Excel and renewal history. Passwords are refused.
- **Client tabs** for Content, Ads and Renewals now open these pages, as do the dashboard's alerts.
- **Tests**: 380 unit + integration tests (61 new), 44 end-to-end browser tests (6 new). All passing.

### Known issues / limitations
- Reels and videos are shared as links rather than uploaded (D-47).
- "Create renewal invoice" is switched off until Phase 7. Automatic draft renewal invoices also come then.
- Client answers notify you in the app only. Email alerts and the digest come in Phase 6.
- The approval link email goes to the server console until SMTP is set.
- Items from a retainer package start with the deliverable's name as the topic and no platforms. The
  item page reminds you to fill them in before the client sees them.
- Sorting the campaign list by spend or CPL isn't available, because those are worked out from entries.
- Meta's own API isn't connected; the brief leaves that as an optional later phase.
- On the content calendar, about 1 filter choice in 20 needs the automatic retry, so it can take up to 4
  seconds (D-54). The cause inside Next.js is unknown. Sorting and paging on the content list aren't covered
  by the retry; they lost none in testing, and a second click would work.

## Phase 6: Reminder engine, notifications, digests, email templates ✅ (05 Nov 2026)

### Done
- **Reminder job**: every rule from the brief, stored as reminders. It can run any number of times with
  no duplicates, closes reminders by itself when the situation is resolved, and reopens them if it returns.
- **New rules**: tasks due soon, project deadlines, and content sent to a client who hasn't finished answering.
- **Reminders page**: open, snoozed and done, with search, filters, sorting, paging and Excel. Mark done,
  snooze for 1 day, 3 days or a custom time, and reopen.
- **Notification bell**: counts unread notifications and reminders that need attention. Opens the new
  page, which also lists every notification with mark read and mark all as read.
- **Daily email digest**: to admins at the digest time set in Settings, once a day, leaving out what's
  snoozed or done. Team members can opt in to a daily email of their own tasks.
- **Emails for tasks**: team members can opt in to an email when assigned or mentioned.
- **Email templates**: Settings → Email templates lists every message, with a live preview, misspelt
  placeholders refused, send-me-a-test and reset. Includes the polite, firm and final payment reminders for Phase 7.
- **Scheduled job**: `/api/cron/reminders`. Pages also start it, at most every 10 minutes.
- **Tests**: 420 unit + integration tests (40 new), 50 end-to-end browser tests (6 new). All passing.

### Known issues / limitations
- Emails only leave the computer once SMTP is set in `.env`. Until then they print in the server window.
- On this PC the database is a portable copy that stops when Windows logs off or shuts down. Run
  `C:\Users\rezon\rezonest-postgres\start-database.cmd` before starting the app. The live version won't have this.
- Without the scheduled job, the digest only goes out when someone opens the app after the digest time.
- Digests are plain text.
- Marking a reminder done hides it until you reopen it, even if the task stays overdue. A change of due date
  on a task that was due today or soon makes a new reminder.
- The dashboard's alerts panel works from live data and doesn't show "due soon" tasks, as in the brief's panel list. The reminders page does.

## Phase 7: GST invoices, payments, TDS, ledger and ageing ✅ (05 Nov 2026)

### Done
- **Invoices**: tax and proforma, from a blank form, a project's one-time work, a milestone, a retainer month,
  a renewal or approved change requests. CGST + SGST or IGST is decided from the client's state, GST rate is editable
  per line, GST can be switched off, and clients outside India are treated as export.
- **Locked once issued**: number given at issue, details frozen, edit refused. Corrections are by credit note or
  cancelling with a reason. A draft can be discarded; it never had a number, so none is lost.
- **Issue checks**: a GST tax invoice can't be issued without your GSTIN and a SAC code on every line. Drafts still save,
  and the draft says exactly what's missing.
- **Credit notes**: line by line, at each line's GST rate, with their own number and PDF.
- **Proforma**: converts to a tax invoice with its own number. An advance on a client with an open proforma
  prompts to convert it, dated the day the money came, and apply the money.
- **PDF, email, WhatsApp**: branded PDF with bank details, UPI QR for the balance and signature. Screen and PDF
  come from the same figures.
- **Payments**: split across invoices, TDS with section, advances, applying advances later, removing from an invoice,
  voiding with a reason, and a warning on a repeated reference and amount.
- **Payment reminders**: polite, firm or final, by email or WhatsApp, with a preview. Sent only when you click, and logged.
- **Statement of account** on screen and as a PDF, and an **ageing report** with Excel.
- **Daily job**: drafts each retainer's month on its day and each renewal 30 days before expiry, tells you, and
  marks invoices overdue. Always drafts: nothing is issued or sent by itself.
- **Milestones** now mean a share of the one-time work before GST, on projects, offers and PDFs.
- **Lists**: invoices and payments with search, filters, sorting, paging and Excel. Client tabs link through.
- **Tests**: 503 unit + integration tests (83 new), 59 end-to-end browser tests (9 new). All passing.

### Known issues / limitations
- Your GSTIN, bank details and SAC codes are empty until you fill them in, so GST tax invoices stay blocked until then.
- Please confirm with your CA: GST on advances (D-62), and whether the SAC and credit note formats suit your filing.
- A paid invoice can't take a credit note until its payment is removed from it. There's no record of refunds yet.
- Emails only leave the computer once SMTP is set in `.env`. Until then they print in the server window.
- Offers made before this phase show the new milestone amounts when opened. Milestones already saved on sample projects
  keep their stored amounts until edited. The invoice is always worked out fresh from the offer's items.
- The invoice lists and dashboard count sample invoices until you run the wipe command.

## Phase 8: Expenses & profitability, documents, communication log ✅ (05 Nov 2026)

### Done
- **Expenses**: date, category, description, paid to, amount before GST, GST paid, client or project link, and a bill
  (photo or PDF) you can preview and replace. List with search, filters, sorting, paging and Excel. Archive and restore.
- **Profitability** (Expenses → Profitability): revenue against expenses for the agency over the last 12 months, and
  profit per client and per project for a chosen period, with Excel. A client's Expenses tab and a project's overview show their own.
- **Documents**: a client's Documents tab has upload, preview, download and archive, up to 20 MB.
  A file's real contents are checked, whatever its name says.
- **Communication log**: on each client and lead. Calls, meetings and messages, edit and archive. A next action with a
  date becomes a reminder on that date, on the dashboard, bell and digest.
- **Tests**: 551 unit + integration tests (48 new), 67 end-to-end browser tests (8 new). All passing.

### Known issues / limitations
- Please confirm with your CA: profit counts expenses before GST, on the basis that you claim the GST paid as input credit (D-70).
- Overheads aren't shared out to clients, so client profits add up to more than the agency's actual profit (D-71).
- Sample data has no documents or bills, so those lists start empty.
- Team time only counts for people whose hourly cost is set under Team.
- A project's revenue only counts invoices linked to that project. Blank invoices with no project count for the client only.
- Files are stored on this PC in the `storage` folder until cloud storage is set for going live.

## Phase 9: Reports, GST summary, data export, backups ✅ (05 Nov 2026)

### Done
- **Agency report**: revenue by month, service, sector and lead source, offer conversion, MRR trend, outstanding and
  ageing, team workload and on-time %, renewals calendar, profit by client and by service. Choose the dates.
- **GST summary**: output tax by month for your CA, with SAC-wise totals and every tax invoice and credit note, by financial year.
- **Client report (internal)**: profile, offers and status history, projects, services, targets vs actual, deliverables,
  task timeline with delays, change requests, ad results, invoices, payments, TDS, outstanding, expenses and profit.
- **Monthly report for a client**: deliverables, KPIs, SEO rankings, ad results, content published, and your highlights and
  next month's plan. Branded, with no fees, costs or team names. Email it with the PDF attached.
- **PDF and Excel**: every report. The screen, PDF and Excel come from the same figures.
- **Data export**: Settings → Data export, any table as Excel or CSV, or everything in one Excel file. Each download is logged.
- **Backups**: one a day, keeping 30 days, with a list, Back up now and download under Settings → Backups. A failure tells you and retries.
- **Tightened**: the general file address now only serves public files and, for admins, the signature image.
- **Tests**: 606 unit + integration tests (55 new), 76 end-to-end browser tests (10 new, 1 retired with the last placeholder). A real backup was restored into a scratch database and compared.

### Known issues / limitations
- Backups on this PC are on this PC. Download a copy now and then until cloud storage is set up at go-live.
- With no scheduled job on this PC, the day's backup starts when someone opens the dashboard.
- Uploaded files aren't in the database backup. Copy the `storage` folder as well.
- Backups don't run on Vercel, which has no `pg_dump`. Use the managed database's own backups there.
- The MRR trend uses retainers active today, so one that's ended or been paused isn't counted in past months.
- Ad results count an entry in the month its period starts, so one spanning two months shows in the first.
- Reports are for admins only, for now. Phase 10 reviews what Managers should see.
- Please have your CA check the GST summary before you rely on it for filing.

## Phase 10: Employee portal, PWA, performance and security review, deployment ⏳ (not started)
