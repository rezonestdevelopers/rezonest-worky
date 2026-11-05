# Rezonest Work OS

Internal agency management system for **Rezonest Digital & Services**, Bhosari, Pune.
Leads → offers → projects → tasks → GST invoices → payments, all in one place.

> Status: **Phase 8 done** (expenses and bills, profit per client and project, client documents, communication log).
> See [`docs/PROGRESS.md`](docs/PROGRESS.md) for what's built and what's next.

---

## 1. Run it on your computer

You need: **Node.js 20+**, **pnpm** (`npm i -g pnpm`), and **PostgreSQL 15+** (the easiest
way to get it is Docker Desktop).

```bash
pnpm install
```

```bash
cp .env.example .env
```

Open `.env` and set `AUTH_SECRET` (generate one with `openssl rand -base64 32`).

Start the database (if you use Docker):

```bash
docker compose up -d
```

Create the tables and load the sample data:

```bash
pnpm db:deploy
```

```bash
pnpm db:seed
```

Start the app:

```bash
pnpm dev
```

Open http://localhost:3000 and sign in:

| Who | Email | Password |
|---|---|---|
| Admin (you) | `yogeshwar@rezonest.com` | `ChangeMe@123` (change it, see below) |
| Sample employees | `priya@`, `rohan@`, `sneha@`, `amit@`, `kunal@rezonest.com` | `Employee@123` |

**Change the admin password**: sign out → "Forgot password?" → the reset link is printed in
the terminal where `pnpm dev` runs (until email/SMTP is set up).

## 2. Environment variables (`.env`)

| Variable | What it is |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `AUTH_SECRET` | Random secret for login sessions (required) |
| `APP_URL` | Public address of the app, used in email links |
| `SESSION_MAX_AGE_HOURS` | Auto sign-out after this many hours (default 12) |
| `LOGIN_RATE_LIMIT` | Max sign-in attempts per IP address per 15 minutes (default 10) |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | First admin login created by the seed |
| `SMTP_*` | Email sending (Google Workspace / Zoho). Empty `SMTP_HOST` = print emails to the console |
| `STORAGE_DRIVER` | `local` (files in `./storage`) or `s3` (AWS S3 Mumbai / Cloudflare R2) |
| `S3_*` | Bucket details when `STORAGE_DRIVER=s3` |
| `CRON_SECRET` | Protects the scheduled job URLs |

## 3. Useful commands

| Command | Does |
|---|---|
| `pnpm dev` | Run locally with live reload |
| `pnpm check` | Lint + type-check + all tests + production build (run before every release) |
| `pnpm test` | Unit tests + database integration tests (needs the `rezonest_workos_test` DB) |
| `pnpm test:e2e` | Browser tests (builds and starts the app on port 3100). The first time, run `pnpm exec playwright install chromium`. Point `DATABASE_URL` at a seeded test database, because these tests add records |
| `pnpm db:migrate` | Create a new migration after changing `prisma/schema.prisma` (developers) |
| `pnpm db:deploy` | Apply migrations (use on the server) |
| `pnpm db:seed` | Master data + admin + sample data (sample only if there are no clients yet) |
| `pnpm db:seed --no-sample` | Master data + admin only (for go-live) |
| `pnpm db:wipe-sample` | **Delete all sample business data before go-live** (asks you to type WIPE) |
| `pnpm db:studio` | Browse the database in a web UI |

The integration tests use a separate database called `rezonest_workos_test`. Create it once:

```bash
createdb -U rezonest rezonest_workos_test
```

### Scheduled jobs

Call these once a day, with `CRON_SECRET` from `.env`:

```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" https://your-app/api/cron/expire-offers
curl -H "Authorization: Bearer YOUR_CRON_SECRET" https://your-app/api/cron/daily-work
```

Call this one every hour:

```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" https://your-app/api/cron/reminders
```

On Vercel, add them under Cron Jobs. On a VPS, add them to cron. The first moves offers past their validity to Expired. The second creates each retainer's monthly deliverables and tasks once their day has come, renews retainers set to auto-renew, refreshes project health, drafts retainer and renewal invoices for your review, and marks unpaid invoices overdue. The hourly one updates reminders, then sends the daily digest on its first run after the digest time set in Settings. Running any of them twice is safe, and a digest goes only once a day.

**Keep `AUTH_SECRET` and `APP_URL` correct when going live.** Client offer links are built from them, so changing `AUTH_SECRET` later stops existing links working.

## 4. Going live (summary, full guide in Phase 10)

**Option A: Vercel + managed PostgreSQL in Mumbai** (Neon / Supabase / AWS RDS `ap-south-1`)
1. Create the database, copy its connection string into Vercel → Settings → Environment Variables as `DATABASE_URL`, plus all other variables from `.env.example`.
2. Build command: `pnpm db:deploy && pnpm build`.
3. Run once: `pnpm db:seed --no-sample` (creates settings, services and your admin login).

**Option B: VPS with Docker** (e.g. AWS Lightsail Mumbai). A Dockerfile and backup cron arrive in Phase 9/10.

Before going live: `pnpm db:wipe-sample`, then set your real GSTIN, bank and UPI details in **Settings**.

## 5. Backups & restore

Automated daily backups (pg_dump → storage, 30 days kept) are built in Phase 9. Until then, a manual backup:

```bash
pg_dump "$DATABASE_URL" --format=custom --file=rezonest-$(date +%F).dump
```

Restore into an empty database:

```bash
pg_restore --clean --no-owner --dbname "$DATABASE_URL" rezonest-2026-11-02.dump
```

## 6. How do I…

- **Change GST rate, payment terms or reminder rules?** Settings → *Defaults & Reminders*.
- **Before your first GST invoice:** fill in GSTIN, bank and UPI under Settings → *GST & Bank*, and SAC codes under Settings → *Service catalogue*. Each GST tax invoice needs a SAC code on every line.
- **Change invoice / quotation number format?** Settings → *Numbering*. Use `{FY}` and `{SEQ}`.
  Numbers restart each 1 April and are never reused. Changes affect future documents only.
- **Change the brand colour?** Settings → *Branding*, or edit `--brand` in `src/app/globals.css`.
- **Add a new employee?** Go to Team → Add person. Enter their name, email, department and access level. They get an email with a link to choose their own password; it lasts 3 days, and "Send password link" on their page sends a new one. To remove someone, open their page and choose Deactivate. Their history stays, and you decide who takes their open tasks.
- **Bring in my existing clients or leads?** Clients (or Leads) → *Import* → *Download template*, fill it in, upload it.
  You see a preview with errors and possible duplicates first. Nothing is saved until you click Import.
- **Change a service's price, GST rate, SAC code or task steps?** Settings → *Service catalogue*.
- **Add a sector, lead source or department?** Settings → *Sectors, sources & departments*. Items are switched off, never deleted.

## 7. Project layout

```
prisma/          schema.prisma, migrations, seed (master + sample data, wipe script)
src/app/         pages: (auth) login & password reset, (app) dashboard & settings, api routes
src/components/  ui (buttons, dialogs…), layout (sidebar, search), dashboard widgets
src/lib/         money (GST, totals, words, ₹ format), dates (IST, FY), numbering, permissions
src/server/      queries (dashboard data) and actions (all server-validated & permission-checked)
tests/           unit, integration (real PostgreSQL), e2e (Playwright)
docs/            PROPOSAL, PROGRESS, DECISIONS
```
