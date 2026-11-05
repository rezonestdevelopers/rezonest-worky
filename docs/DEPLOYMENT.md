# Putting Rezonest Work OS online

For the owner, and for whoever helps set it up. Nothing here has gone online yet: you still need to choose a host.

**What has and hasn't been tested.** The app itself is fully tested on a PC. The Docker files, Caddy, the jobs container and `vercel.json` have **not** been run, because the PC they were written on has no Docker and no hosting account. Expect to check them on the first setup, using the steps below.

## 1. Choose where it runs

| | Small server in Mumbai (recommended) | Vercel + managed database |
|---|---|---|
| Example | AWS Lightsail, Mumbai | Vercel (`bom1`) with Neon or Supabase, Mumbai |
| Rough cost, please check | ₹1,000–2,000 a month | ₹3,000+ a month: business use needs a paid Vercel plan |
| Daily backups | Built in, as designed | Not built in. `pg_dump` isn't there, so use the database provider's |
| Rate limits on logins and client links | Work as designed | Counted separately per running copy, so looser. Account lockout still applies |
| Uploaded files | Server disk or cloud storage | Cloud storage is required |
| Upkeep | Occasional operating system updates | Almost none |

## 2. Option A: small server (Docker)

You need a Linux server with at least 2 GB of memory, and a domain name such as `app.rezonest.com`.

1. **Point the domain.** Add a DNS `A` record from `app.rezonest.com` to the server's IP address.
2. **Open the firewall** for ports 22, 80 and 443 only.
3. **Install Docker** on the server, following Docker's own instructions.
4. **Get the code** onto the server: `git clone` your repository, then `cd` into it.
5. **Create `.env`** from `.env.example`, and set:

   ```bash
   APP_DOMAIN=app.rezonest.com
   APP_URL=https://app.rezonest.com
   AUTH_SECRET=      # paste the output of: openssl rand -base64 32
   CRON_SECRET=      # paste the output of: openssl rand -hex 32
   POSTGRES_PASSWORD= # paste the output of: openssl rand -hex 32
   SEED_ADMIN_EMAIL=yogeshwar@rezonest.com
   SEED_ADMIN_PASSWORD= # a strong password, just for your first login
   ```

   Add your SMTP details too. For cloud storage, also set `STORAGE_DRIVER="s3"` and the `S3_` values. Leave `DATABASE_URL`, `PG_DUMP_PATH` and `BACKUP_AUTO` to `docker-compose.prod.yml`.

   **Keep a safe copy of `AUTH_SECRET`.** If it changes, client links stop working.

6. **Start it:**

   ```bash
   docker compose -f docker-compose.prod.yml up -d --build
   ```

7. **Create your settings and login, without sample data:**

   ```bash
   docker compose -f docker-compose.prod.yml exec app pnpm db:seed --no-sample
   ```

8. **Check it.** Open your address and log in. Then follow the checklist in section 4.

**Updating later:**

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

New database changes apply by themselves when the app starts. Take a backup first from Settings → Backups.

**If something's wrong:** `docker compose -f docker-compose.prod.yml logs app`, or use `logs web` for the secure address, and `logs jobs` for scheduled jobs.

## 3. Option B: Vercel + managed database

1. **Create a PostgreSQL 16 database** in Mumbai, and copy its connection string.
2. **Create S3-compatible storage** (AWS S3 Mumbai or Cloudflare R2).
3. **Import your repository** into a paid Vercel plan. `vercel.json` sets the Mumbai region, the build command and scheduled jobs.
4. **Add environment variables** in Vercel: everything in `.env.example`, with `DATABASE_URL`, `APP_URL`, `AUTH_SECRET`, `CRON_SECRET`, SMTP, and `STORAGE_DRIVER="s3"` with its `S3_` values. Vercel sends `CRON_SECRET` to the jobs by itself.
5. **Deploy**, then run this once from your own computer, with `DATABASE_URL` set to the live database: `pnpm db:seed --no-sample`.
6. **Turn on the database provider's daily backups**, and check how to restore them. Settings → Backups will show a failure here if you click Back up now, because Vercel has no `pg_dump`.
7. **Check it**, using the checklist below.

Uploads and report emails can be limited by Vercel's request size, about 4.5 MB, so large documents may need a different route on this option.

## 4. Before real use: the go-live checklist

Run this on the live copy. It only reads, and it lists what's left:

```bash
pnpm go-live-check
# On Docker: docker compose -f docker-compose.prod.yml exec app pnpm go-live-check
```

It checks your secrets, https address, email, sample data, default passwords, GSTIN, bank details, SAC codes and today's backup. Then, by hand:

1. Log in and change your password under **My account**.
2. Fill in Settings: GSTIN, PAN, bank, UPI, signature, logo, terms and number formats.
3. Add SAC codes under Settings → Service catalogue.
4. Have your CA confirm: GST on advances, GST paid on expenses, and the GST summary.
5. Send yourself a test email from Settings → Email templates.
6. Click **Back up now**, then practise restoring it, following the README.
7. Add your team under Team. They each get a link to choose a password.
8. Import your clients and leads.
9. Create one real invoice as a draft, and check its PDF before issuing it.
10. Install it on your phone: see **My account**.

**If you tried a copy with sample data:** `pnpm db:wipe-sample` removes all clients, leads, offers, invoices and payments, and resets numbering. Use it once, before real data goes in, and never after.

## 5. Keeping it healthy

- **Weekly:** glance at Settings → Backups for failures.
- **Monthly:** download one backup and keep it off the server. Copy uploaded files as well if they aren't in cloud storage.
- **Every few months:** update the server's operating system, and practise a restore.
- **Dependencies:** run `pnpm audit --prod`, and update what it flags.
