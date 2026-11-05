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

### D-42 What the client sees on the approval link
The link shows one client's content for one month: date, format, platforms, topic, caption, creative
and their own answers. Design status, tasks, team and prices never leave the server. It works for 30
days, can be withdrawn at any time, and there's one working link per client and month. Tokens work as
in D-22. An offer's link can't open a calendar, and a calendar's link can't open an offer.

### D-43 Clients approve the calendar, not only finished designs
The Social Media template has a "Client approval of calendar" step before design starts, so the page
shows every item in the month, including those with no creative yet. Each is answered on its own, as
the brief asks. There's no "approve all" button, because the brief doesn't ask for one.

### D-44 What a client's answer changes
Approving finishes that deliverable's client approval step. Asking for changes sends any task waiting
on the client back to In Progress and counts one revision on the deliverable. Going past the included
revisions tells you to consider a change request; nothing is billed by itself. Only the first of two
answers given at the same moment counts.

### D-45 Changing approved content sends it back
If the topic, caption or creative of an approved item changes, it returns to Awaiting approval, so a
client's approval always matches what goes out. Changing only the date, format or platforms doesn't.

### D-46 Publishing needs approval, and counts as delivery
Only approved content can be marked as published. If approval came by phone or WhatsApp, a manager
records it with a note, and the history shows who recorded it. Publishing finishes that deliverable's
open tasks, so "delivered" keeps one meaning across the calendar, project page and dashboard: all of
its tasks are done. Undoing it doesn't reopen those tasks.

### D-47 Creatives: images and PDFs are uploaded, videos are linked
Images and PDFs go up to 5 MB. Reels and videos are shared as a Drive or YouTube link, because large
video uploads need direct-to-storage uploading, which is better built with production storage in
Phase 10. Images open on the page. Other files download. Either way they're served through a permission
or token check, in a sandbox, and a replaced creative is archived rather than deleted.

### D-48 Package items can't be archived
A calendar item that came from a retainer's package is something you promised, so archiving it would
quietly lower the committed count. It can be edited or moved instead. Extra items can be archived.

### D-49 Ad results can't overlap
Two entries for one campaign can't share a day, by hand or by upload, because counting a day twice
overstates the client's spend. Uploading the same report twice therefore adds nothing. Future dates
are refused. A removed entry leaves the totals but is kept, and the removal is in the activity log.

### D-50 Reading Ads Manager reports
Uploads match rows to campaigns by name, for the chosen client only, so names are unique per client.
Only rupee spend columns are read, so a dollar account can't be mistaken for rupees. "Leads" is
preferred, and "Results" is used only if there's no Leads column, with a warning, because Results can
mean purchases. Dates are read day first. Nothing is saved before you confirm the preview.

### D-51 Budget used is total spend against the campaign's budget
The budget is the client's total for the campaign, matching the Phase 1 dashboard alert. It's their
money and is never added to revenue. For a monthly budget, make one campaign per month.

### D-52 Who sees what in Phase 5
Ads are for Admin and Manager, with the client's budget visible but no fees. Renewals are Admin only,
because they show your cost and margin. A Manager still sees a client's Renewals tab, with no prices.
Employees see content for projects where they can see a task. They can update design status, add
creatives and mark content published, but can't create items or send approval links.

### D-53 Renewals only record what happened
"Mark renewed" moves the expiry date and keeps the old one in the history; it doesn't contact the
provider. The auto-renew switch is a note for you. "Create renewal invoice" is on the page, switched
off until invoices exist in Phase 7. Text like "password: abc" is refused in the credentials and notes
fields, so a slip doesn't end up stored. Writing "password manager" is fine.

### D-54 A filter always takes effect, even if Next.js drops the page change
On the content calendar, about 1 filter choice in 20 did nothing: the server's answer was complete and
identical to a working one (compared byte for byte), but the browser never switched to it, with no error.
Ruled out by measuring: fetching links ahead, nested data loading, and the transition around the
page change. Tasks, Offers, Ads and Renewals lost none in hundreds of tries. The cause inside Next.js 15.5
is still unknown (compare D-14 and D-16). So `ListToolbar` checks the address after 2 seconds, asks again,
and after 2 more does a full page load, which always works because filters live in the address (D-17). It
acts only if the address hasn't moved at all, so it can't undo a sort or page change made in the meantime.
Worst case is a 4-second wait. Remove this if a later Next.js fixes it. The calendar's own links, such as the
month arrows and cards, had the same problem, so they're plain links that load the whole page. That also
stopped them fetching ahead, which removed about 70 requests from every page load.

### D-55 One set of rules, two uses
`collectAlerts` holds every reminder rule. The dashboard runs it live, so its filters apply. The job runs it
for the whole agency and stores the results. So they can't disagree. The reminders page refreshes the stored
ones each time it opens, because finishing a task should clear its reminder straight away.

### D-56 How a reminder changes state
One row per situation, found by its dedupe key, so repeated runs change nothing. Someone's Done stays done. If
the situation just goes away it closes by itself, and comes back if the situation returns, such as a task
reopened. A snooze wakes when its time is up. The job only overwrites a row nobody has changed since it read
it, so a Done pressed at that moment isn't undone. Renewal keys include the 30/15/7/1 step, so a snooze
at 30 days alerts again at 15.

### D-57 Who sees which reminders
Admins see all. Managers see all except invoices, payments and renewals, which show money or open Admin-only
pages. Employees see reminders for tasks assigned to them. Those rules also apply when changing a reminder, and
"restore snoozed" only touches your own. Phase 1's version let anyone restore everyone's, and is replaced.

### D-58 Digest timing and once-a-day guarantee
A person's digest is claimed in `DigestRun` before sending, and the database allows only one claim per person
per day, so running the job twice can't send twice. A failed send gives the claim back, so the next run retries.
It goes on the first run at or after the digest time, so a late run still sends that day. Hourly scheduling means
a 09:00 digest goes at 09:00 if the job runs on the hour. The Settings switch stops all digests, not just yours.

### D-59 Task emails are sent after the save
A notification is marked as wanting email in the same save as the task, and sent just after it succeeds, so a
slow mail server can't slow a save or fail it, and a failed save sends nothing. Each is marked before sending, so
two runs can't send it twice; a failed send isn't retried. Older than a day is skipped, so no backlog arrives.
Status changes and comments on your task stay in the app only: the brief asks for email on assignment and mention.

### D-60 Email templates
Each message has its starting text and the placeholders it can use in `src/lib/email-templates.ts`. A saved edit
replaces the text, and Reset restores it. A placeholder it can't fill is refused, because a typo would send a client
a blank. The preview and the real email use the same code. Digests are plain text so they stay editable like the
others. WhatsApp text exists only where there's a WhatsApp action.
