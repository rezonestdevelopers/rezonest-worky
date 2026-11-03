# Technical decisions

Each entry: what we decided and why. Newest last.

### D-01 Money is `Decimal(14,2)` rupees, maths via decimal.js
Never floating point. One utility (`src/lib/money`) does all GST, discount, rounding and totals,
so the screen, PDFs and stored totals always match. Values are rounded half-up to paise.

### D-02 GST rules
- GST is calculated **per line** (services can have different rates), then summed.
- Discount (% or ₹) is applied **before** GST and reduces the taxable value.
- Intra-state (client state code = agency's, default 27): CGST = SGST = rate/2 on each line, each
  rounded to paise, so they are always equal. Other Indian states → IGST. Client outside India →
  "EXPORT" (zero-rated). GST switched off → "NO_GST".
- Grand total is rounded to the nearest rupee (half-up). The difference is shown as **Round-off**.

### D-03 Document numbers
The format comes from Settings (`REZ/INV/{FY}/{SEQ}`). The next value comes from a single
`INSERT … ON CONFLICT DO UPDATE … RETURNING` on `NumberSequence (type, financialYear)` inside the
same transaction that saves the document. The row lock makes it safe when two people issue at
once, and a failed save rolls the number back: no gaps, never reused. The counter resets
automatically each financial year (April–March, IST). Invoice numbers are assigned only when
an invoice is **issued**. Drafts have no number. Tested with 25 concurrent issues.

### D-04 Dates
Asia/Kolkata everywhere. Calendar dates (due date, expiry…) are `@db.Date` stored as UTC
midnight of the IST day and handled as `"YYYY-MM-DD"` keys, so there are no timezone off-by-one
bugs. Timestamps are shown in IST. Display format: DD MMM YYYY.

### D-05 Auth
Auth.js v5 (Credentials + JWT sessions, 12 h max age). The edge middleware only checks that a
session exists. Every page/action/API re-checks the user **in the database** (active flag +
role), so deactivating someone locks them out on their next click. 5 wrong passwords lock the
account for 15 min. There is also a per-IP limit (in-memory; per server instance). Password reset
tokens are random 32-byte values stored as SHA-256 hashes, valid 1 h, single use. "Forgot
password" never reveals whether an email exists.

### D-06 UI components written in-repo
The shadcn registry website is blocked in the build environment, so the shadcn-style
components (Radix + Tailwind) are written directly in `src/components/ui`. The result is the same
code you'd get from shadcn. Geist font is self-hosted via the `geist` package (no Google Fonts
call at build time).

### D-07 Brand colour
One CSS variable `--brand` (default `#D7202A`, from the logo), overridable from Settings
(validated hex, injected on `<html>`). Chart series use a separate, colour-blind-safe palette
so data colours never clash with status colours (green/amber/red/grey).

### D-08 Extra models beyond the brief
- `Deliverable`: one unit of committed work (e.g. "Reel 3 – Nov 2026"); powers committed vs
  delivered and revision counts.
- `RetainerRun`: unique (project, month), so monthly generation can safely run twice.
- `OfferMilestone`: payment split per offer (50/30/20).
- `OnboardingTemplateItem`: per-service onboarding checklist templates.
- `EmailLog`, `PasswordResetToken`.
- `Reminder.dedupeKey` (unique): idempotent reminders, and how snooze/done is remembered.

### D-09 Dashboard number definitions (approved in the proposal)
| Number | Definition |
|---|---|
| Revenue (service/sector/source/top clients) | Taxable value **excl. GST** of ISSUED **tax** invoices dated in the period, minus credit notes dated in the period. Proforma, draft and cancelled invoices never count. With a service/department filter, only matching line items count, and credit notes are applied in proportion. |
| Invoiced (KPI) | Same as revenue (excl. GST). The subtitle also shows the amount incl. GST. |
| Invoiced vs received chart | **Both incl. GST**: invoiced = tax invoice grand totals − credit notes; received = cash + TDS deducted. Like-for-like, since payments are not split into GST/non-GST. |
| Received (KPI) | Cash received in the period (payments, excluding voided). TDS shown separately. |
| Outstanding | Balance due on issued, non-cancelled tax invoices = total − paid − TDS − credit notes. |
| MRR | Monthly value (excl. GST) of active `MONTHLY_RETAINER` services on ACTIVE retainer projects whose retainer period includes today. |
| Offers pending | Count and taxable value of offers in Sent + On Hold. |
| Conversion rate | Accepted ÷ (Accepted + Rejected + Expired), for offers that reached that status in the period. |
| Avg days to close | Offer date → accepted date, for offers accepted in the period. |
| Profit | Revenue − linked expenses (excl. GST paid) − logged hours × employee hourly cost. |
| % change | "This month" / "Last month" compare with the same days one month earlier. Other ranges compare with the preceding period of equal length. Shown only where history is reliable (some KPIs have no %). |
| Overdue tasks | Open tasks past due date, **excluding "Waiting for client approval"** (that is the client's delay; it has its own alert). |
| Project health (auto) | DELAYED: missed milestone, or deadline passed, or ≥3 overdue tasks, or ≥25% of open tasks overdue. AT RISK: any overdue task, or deadline ≤7 days with <80% progress, or milestone ≤7 days with <50% progress. Otherwise ON TRACK. A manual override wins. |
| Progress % | Retainers: % of tasks due in the last 30 days that are done. Other projects: % of all tasks done. |
| Ageing | Unpaid tax invoice balances by days past due date: Not yet due / 1–30 / 31–60 / 61–90 / 90+. |

### D-10 Dashboard aggregation
Counts and sums use database aggregates. Revenue facts (invoice lines + credit notes for the
period) are combined on the server, because service-level credit-note allocation needs line
detail. Only summary numbers are sent to the browser. Fine for thousands of invoices a year. If it
ever gets slow, this can move to SQL `GROUP BY` without changing the screen.

### D-11 Alerts in Phase 1
Alerts are built live from current data on each dashboard load. Each has a stable `dedupeKey`
(e.g. `TASK_OVERDUE:<taskId>`, `RENEWAL_DUE:<assetId>:<expiry>:<threshold>`). Snooze/done are
stored in `Reminder` against that key. Renewal keys include the 30/15/7/1 threshold, so a snooze
at "30 days" re-alerts at 15. Phase 6 moves generation into the daily job with the same keys.

### D-12 File storage
`STORAGE_DRIVER=local` writes to `./storage` (git-ignored); `s3` uses AWS S3/R2. Keys under
`public/` (logo) are served without login; everything else requires a session. Uploads are
checked by magic bytes, not just the file extension.

### D-13 Dependencies added beyond the brief's list (approved)
`bcryptjs`, `date-fns` + `@date-fns/tz` (the date-fns v4 timezone package, instead of
`date-fns-tz`), `decimal.js`, `cmdk`, `radix-ui`, `class-variance-authority`, `clsx`,
`tailwind-merge`, `tw-animate-css`, `next-themes`, `sonner` (toasts), `geist` (font),
`@aws-sdk/client-s3`, `server-only`, `tsx` (seed runner). `qrcode` will be added in Phase 7.

### D-14 Don't use route `loading.tsx`; use `<Suspense>` inside the page
With a route `loading.tsx`, in-page navigation sometimes never finished: the server answered but the
page stayed as it was. Measured on client tabs: 7 of 60 clicks lost with the file, 0 of 60 without it.
It also would have replaced the search box while typing. Loading states use `<Suspense>` around the
data instead. The exact cause inside Next.js 15.5 was not identified.

### D-15 Validate forms on submit, then as you type (not on blur)
With "validate on blur", clicking Save first removes the error text, the button moves about 38 px
and the click misses. New forms use the default mode. Settings (Phase 1) still uses blur.

### D-16 All list navigation goes through one path
A list's "Clear" going to the bare address (`/leads`) was ignored in up to 4 of 75 actions, even
though the server had answered. Sending it the same way as searches and filters (`/leads?`) gave
0 of 225. The mechanism inside Next.js was not identified, so keep using `navigate()` in
`ListToolbar`, and the same form in the dashboard's filters.

### D-17 Lists are server-driven, with the view in the URL
Searching, sorting and paging happen in the database, so only one page reaches the browser, and
links and the back button keep the view. Sort columns are a fixed allow-list.

### D-18 Duplicate checks warn rather than block
Same phone (last 10 digits), email (ignoring case) or GSTIN gives a warning you can override, since
one company can have two branches. The import preview and final save run the same check, and the
server repeats it at save time.

### D-19 Won only through conversion
A lead can't be set to Won by hand, so every Won lead has a client. Converted leads stay Won.

### D-20 GST details are rejected rather than guessed
A GSTIN must match the selected state, and a PAN must match the GSTIN. Clients abroad use state
code 96 and can't have a GSTIN. In import, a blank state is taken from the GSTIN, otherwise
Maharashtra with a visible warning. An unknown state is an error. Dates are always read day first.

### D-21 pnpm 11 settings
Allowed build scripts moved to `pnpm-workspace.yaml`. pnpm's 24-hour new-package safety rule stays
on. The one package it flagged, `@vitejs/plugin-react`, was unused and was removed.

### D-22 Client links
A link's token is an HMAC of its id with `AUTH_SECRET`, and only a SHA-256 of the token is stored.
That means a database copy alone can't produce a working link, and the same link can be shared
again later. Changing `AUTH_SECRET` stops existing links working. A link shows one offer only, is
rate limited, and stops on expiry, rejection, archiving or a new version.

### D-23 Offer totals are per month for retainers
A retainer line is quantity × rate for one month. Duration is shown but not multiplied, so a
6-month ₹25,000 retainer totals ₹25,000 + GST, and the offer says so. This matches how MRR and
monthly invoices work. Revisit if you'd rather quote the whole contract value.

### D-24 Drafts only are editable; a change to a sent offer is a new version
A new version keeps the quotation number and revokes old links first, so a client can never accept
terms that have since changed. Each sent version is frozen in `OfferVersion`, and the accepted
version is recorded. Accepted offers can't be revised or archived.

### D-25 Sent means actually sent
The email goes first, and the status changes only if it succeeded. Tax is re-worked out from the
client's current state just before sending.

### D-26 Quotation numbers are given at creation
Offers are archived, never deleted, so a number is never lost. Templates use a `TPL-` code and
consume no number. (Invoices differ: they get a number only when issued, per D-03.)

### D-27 Managers and offer prices
The brief gives Managers access to Offers but not to Prices. An offer can't be written without
prices, so Managers can see and set them on offers. The price catalogue stays Admin only. Manager
logins aren't in use yet, so this can be revisited.

### D-28 PDF library and font
`@react-pdf/renderer`, as named in the brief. Built-in PDF fonts lack the ₹ sign, so Geist is
embedded from `src/lib/pdf/fonts`.

### D-29 Monthly package tasks: one set per deliverable
The brief says retainers create "deliverables and tasks" from the package, using the Reel and Post
templates. So "12 posts + 8 reels" makes 20 deliverables and about 96 tasks a month. This gives exact
committed vs delivered figures, but it's a lot of tasks. The owner has been asked whether one task
per deliverable would suit them better. That would be a small change.

### D-30 What an employee can see
The brief says "Assigned / own department only". An employee sees tasks assigned to them, plus tasks
for their department. They see a project only if they can see one of its tasks. If it isn't theirs,
the page answers the same as if it doesn't exist, so nothing is revealed. They never see prices,
change requests or onboarding, and can't create tasks.

### D-31 Tasks start with a department, not a person
Templates name a department, and nobody is chosen automatically, because the app can't know who is
free. A manager assigns from the list or Kanban. Employees see their department's unassigned work.

### D-32 Projects only start from an accepted offer
The brief describes one way in: converting an accepted offer. There's no "blank project" button, so
every project has a client, price and acceptance on record. Tasks without a project are allowed.

### D-33 A retainer month can't be created twice
`RetainerRun` has one row per project and month, and only the first attempt to add it goes on to
create work. The migration backfills rows for months that already have deliverables, so sample and
existing data can't be doubled. Months before the retainer starts or after it ends are skipped.

### D-34 The daily job
`/api/cron/daily-work` creates retainer months once their day has come, renews auto-renew retainers
and refreshes health. The dashboard and Projects pages also start it, at most once every 10 minutes,
so figures stay right if the schedule is late. It runs after the page is sent, so nobody waits for it.
Running it any number of times is safe.

### D-35 Auto-renew only extends the dates
A renewal adds the same length as the period that just ended. It sends and invoices nothing. Monthly
draft invoices arrive in Phase 7.

### D-36 Onboarding starts at acceptance
The brief says the checklist is created "when an offer is accepted", so it doesn't wait for the
project. It starts on the offer and moves to the project on conversion, keeping ticks. An offer still
on a lead gets its checklist when the lead becomes a client. Changing the standard checklist affects
future clients only.

### D-37 Per-unit items
A per-unit item gets one set of tasks per unit, for example 4 reels gives Reel #1 to #4, up to 100
sets. A larger quantity still creates only 100, so bulk work like that should be split or managed by hand.

### D-38 Task statuses move freely
Real work goes back and forth, so any status can follow any other. Only Blocked needs a reason, which
is why bulk changes can't set it. Every change is in the activity log. Reopening a task also
un-delivers its deliverable.

### D-39 "Waiting for client" isn't a delay
Overdue tasks waiting for client approval don't count against project health, since the delay isn't
the agency's. The Phase 6 reminders will chase them after 2 days. The other health rules are in
`src/lib/health.ts`.

### D-40 New team members choose their own password
Adding a person emails them a single-use link that lasts 3 days. Only its hash is stored, and nobody
ever sees or sets their password for them. An admin can't change their own role or deactivate
themselves, and the last active admin can't be removed.

### D-41 Attachments always download
Task files are served through a permission check and always as downloads, never opened inside the
app, so an uploaded file can't run in a logged-in session.
