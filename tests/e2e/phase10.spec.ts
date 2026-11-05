import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { login } from "./helpers";

const MANAGER = { email: "manager-e2e@example.com", password: "Manager@123" };
const SWAP = { email: "swap-e2e@example.com", password: "Original@123" };

test.beforeAll(async () => {
  const url = process.env.DATABASE_URL ?? "";
  if (!/e2e/.test(url)) throw new Error("Refusing to set up test logins outside the e2e database");
  const db = new PrismaClient({ datasources: { db: { url } } });
  const hash = (p: string) => bcrypt.hash(p, 4);
  await db.user.upsert({ where: { email: MANAGER.email }, update: { passwordHash: await hash(MANAGER.password), isActive: true, role: "MANAGER" }, create: { name: "Mina Manager", email: MANAGER.email, passwordHash: await hash(MANAGER.password), role: "MANAGER" } });
  await db.user.upsert({ where: { email: SWAP.email }, update: { passwordHash: await hash(SWAP.password), isActive: true }, create: { name: "Sam Swap", email: SWAP.email, passwordHash: await hash(SWAP.password), role: "EMPLOYEE" } });
  await db.$disconnect();
});

const EMPLOYEE = ["kunal@rezonest.com", "Employee@123"] as const;

const denied = async (page: Page, paths: string[]) => {
  for (const path of paths) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/dashboard/);
  }
};
const allowed = async (page: Page, paths: string[]) => {
  for (const path of paths) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    await expect(page, path).not.toHaveURL(/\/dashboard\?denied/);
    await expect(page.getByRole("heading", { name: "Something went wrong" }), path).toHaveCount(0);
  }
};

const MONEY = ["/invoices", "/invoices/new", "/payments", "/payments/new", "/payments/ageing", "/expenses", "/expenses/new", "/expenses/profit", "/renewals", "/renewals/new"];
const ADMIN_ONLY = ["/team", "/settings", "/settings/services", "/settings/emails", "/settings/data", "/settings/backups"];
const FINANCE_REPORTS = ["/reports/agency", "/reports/gst", "/reports/client"];
const SALES = ["/leads", "/leads/new", "/clients", "/clients/new", "/offers", "/offers/new"];

test.describe("Phase 10: who can reach what", () => {
  test("an employee sees only their own work", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, ...EMPLOYEE);
    await expect(page.getByTestId("my-week")).toContainText("Logged this week");
    await expect(page.getByTestId("my-week")).toContainText("On time this month");
    await expect(page.getByRole("link", { name: "See all my tasks" })).toBeVisible();

    const nav = page.getByRole("navigation", { name: "Main" });
    for (const name of ["Dashboard", "Projects", "Tasks", "Content Calendar"]) await expect(nav.getByRole("link", { name })).toBeVisible();
    for (const name of ["Leads", "Clients", "Offers", "Ads", "Renewals", "Invoices", "Payments", "Expenses", "Reports", "Team", "Settings"]) await expect(nav.getByRole("link", { name, exact: true })).toHaveCount(0);

    await denied(page, [...SALES, ...MONEY, ...ADMIN_ONLY, ...FINANCE_REPORTS, "/reports", "/reports/monthly", "/ads"]);
    await allowed(page, ["/tasks", "/tasks?mine=1", "/projects", "/content", "/account", "/notifications"]);

    // No money words on their own pages
    await page.goto("/dashboard");
    await expect(page.getByRole("main")).not.toContainText("₹");
    await page.goto("/projects");
    await expect(page.getByRole("main")).not.toContainText("₹");
    const first = page.getByRole("main").getByRole("table").getByRole("link").first();
    if (await first.count()) {
      await first.click();
      await expect(page).toHaveURL(/\/projects\/[a-z0-9]{20,}/);
      await expect(page.getByRole("main")).not.toContainText("₹");
    }

    for (const path of ["/api/export/clients", "/api/export/invoices", "/api/export/expenses", "/api/reports/gst", "/api/reports/monthly?client=x", "/api/export/data/all", "/api/backups/x"]) {
      expect((await page.request.get(path)).status(), path).toBe(403);
    }
  });

  test("a manager runs sales and work, sees no money, and has only the monthly report", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, MANAGER.email, MANAGER.password);
    const nav = page.getByRole("navigation", { name: "Main" });
    for (const name of ["Dashboard", "Leads", "Clients", "Offers", "Projects", "Tasks", "Reports"]) await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
    for (const name of ["Renewals", "Invoices", "Payments", "Expenses", "Team", "Settings"]) await expect(nav.getByRole("link", { name, exact: true })).toHaveCount(0);

    await denied(page, [...MONEY, ...ADMIN_ONLY, ...FINANCE_REPORTS]);
    await allowed(page, [...SALES, "/projects", "/tasks", "/ads", "/reports", "/account"]);

    await page.goto("/reports");
    await expect(page.getByRole("link", { name: /Monthly report for a client/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Agency report/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /GST summary/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Client report \(internal\)/ })).toHaveCount(0);

    await page.goto("/reports/monthly");
    await page.getByLabel("Client").selectOption({ label: "Pristine Heights Realty LLP" });
    await page.getByRole("button", { name: "Show" }).click();
    await expect(page.getByText("Ads results")).toBeVisible();
    await page.getByLabel("Highlights").fill("A manager wrote this.");
    await page.getByRole("button", { name: "Save words" }).click();
    await expect(page.getByRole("main").getByText("A manager wrote this.").last()).toBeVisible();
    const pdf = await page.getByRole("link", { name: "PDF" }).getAttribute("href");
    expect((await page.request.get(pdf!)).status()).toBe(200);
    await page.getByRole("button", { name: "Email to client" }).click();
    await page.getByRole("dialog").getByLabel("Send to").fill("client@example.com");
    await page.getByRole("dialog").getByRole("button", { name: "Send email" }).click();
    await expect(page.getByText("Sent to client@example.com.")).toBeVisible();

    // A client's page: no money tabs, and only the monthly report
    await page.goto("/clients");
    await page.getByRole("main").getByRole("table").getByRole("link").first().click();
    await expect(page).toHaveURL(/\/clients\/[a-z0-9]{20,}/);
    const client = page.url().split("?")[0];
    const tabs = page.getByRole("navigation", { name: "Client sections" });
    for (const name of ["Invoices", "Payments", "Expenses"]) await expect(tabs.getByRole("link", { name, exact: true })).toHaveCount(0);
    await page.goto(`${client}?tab=reports`);
    await expect(page.getByRole("link", { name: /Monthly report for the client/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Client report \(internal\)/ })).toHaveCount(0);

    for (const path of ["/api/reports/agency", "/api/reports/gst", "/api/reports/client?client=x", "/api/export/invoices", "/api/export/payments", "/api/export/expenses", "/api/export/profit", "/api/export/data/user", "/api/backups/x"]) {
      expect((await page.request.get(path)).status(), path).toBe(403);
    }
    // Bills can't be added to a client's documents
    await page.goto(`${client}?tab=documents`);
    await expect(page.getByLabel("Kind").locator("option", { hasText: "Bill" })).toHaveCount(0);
    await expect(page.getByLabel("Kind").locator("option", { hasText: "Invoice" })).toHaveCount(0);
  });

  test("the owner can reach everything", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page);
    await allowed(page, [...SALES, ...MONEY, ...ADMIN_ONLY, ...FINANCE_REPORTS, "/reports", "/reports/monthly", "/projects", "/tasks", "/content", "/ads", "/account"]);
  });

  test("signed out, everything private goes to login or is refused", async ({ page, request }) => {
    for (const path of ["/dashboard", "/invoices", "/account", "/settings/backups", "/reports/gst"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/login/);
    }
    for (const path of ["/api/export/clients", "/api/reports/gst", "/api/backups/x", "/api/documents/x", "/api/export/data/all"]) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect([302, 303, 307, 401, 403], path).toContain(res.status());
    }
  });
});

test.describe("Phase 10: my account", () => {
  test("change my password, with the old one needed; my details save", async ({ page }) => {
    test.setTimeout(60_000);
    await login(page, SWAP.email, SWAP.password);
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "My account" }).click();
    await expect(page).toHaveURL(/\/account$/);

    await page.getByLabel("Current password").fill("wrong-pass-1");
    await page.getByLabel("New password", { exact: true }).fill("Changed@456");
    await page.getByLabel("New password again").fill("Changed@456");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("Your current password isn't right.")).toBeVisible();

    await page.getByLabel("Current password").fill(SWAP.password);
    await page.getByLabel("New password again").fill("Different@456");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("The two passwords don't match")).toBeVisible();

    await page.getByLabel("New password again").fill("Changed@456");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("Password changed.")).toBeVisible();

    await page.getByLabel("Name").fill("Sam Swapped");
    await page.getByLabel("Phone").fill("9876501234");
    await page.getByRole("button", { name: "Save details" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Name")).toHaveValue("Sam Swapped");
    await expect(page.getByLabel("Phone")).toHaveValue("9876501234");

    // The new password works, and the old one doesn't
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.getByLabel("Email").fill(SWAP.email);
    await page.getByLabel("Password").fill(SWAP.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Wrong email or password.")).toBeVisible();
    await login(page, SWAP.email, "Changed@456");
  });
});

test.describe("Phase 10: installable app", () => {
  test("has what a phone needs, open without logging in", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.status()).toBe(200);
    const m = await res.json();
    expect(m).toMatchObject({ name: "Rezonest Work OS", short_name: "Work OS", start_url: "/dashboard", display: "standalone" });
    expect(m.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(m.icons.some((i: { purpose: string }) => i.purpose === "maskable")).toBe(true);
    for (const icon of m.icons) {
      const file = await request.get(icon.src);
      expect(file.status(), icon.src).toBe(200);
      expect(file.headers()["content-type"]).toContain("image/png");
    }
    const sw = await request.get("/sw.js");
    expect(sw.status()).toBe(200);
    expect(sw.headers()["content-type"]).toContain("javascript");
    expect(sw.headers()["cache-control"]).toContain("no-cache");
    expect((await request.get("/offline.html")).status()).toBe(200);
    expect((await request.get("/apple-icon.png", { maxRedirects: 0 })).status()).toBe(200);
  });

  test("works offline politely, and stores no pages or data", async ({ page, context }) => {
    test.setTimeout(60_000);
    await login(page);
    await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active?.state === "activated", undefined, { timeout: 20_000 });
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.goto("/invoices");
    await page.waitForLoadState("networkidle");

    const stored = await page.evaluate(async () => {
      const out: string[] = [];
      for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) out.push(new URL(req.url).pathname);
      return out;
    });
    expect(stored).toContain("/offline.html");
    expect(stored.filter((p) => !p.startsWith("/_next/static/") && !p.startsWith("/icons/") && p !== "/offline.html")).toEqual([]);

    await context.setOffline(true);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
    await context.setOffline(false);
    await page.getByRole("link", { name: "Try again" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText("Tasks due today")).toBeVisible();
  });

  test("the account page explains installing", async ({ page }) => {
    await login(page, ...EMPLOYEE);
    await page.goto("/account");
    await expect(page.getByTestId("install-card")).toContainText("Add to Home Screen");
  });
});

test.describe("Phase 10: security headers", () => {
  test("pages can't be framed, and browsers won't guess file types", async ({ request }) => {
    const res = await request.get("/login");
    const h = res.headers();
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["strict-transport-security"]).toContain("max-age");
    expect(h["x-powered-by"]).toBeUndefined();
  });
  test("cron jobs refuse without their secret", async ({ request }) => {
    for (const job of ["reminders", "daily-work", "expire-offers", "backup"]) {
      const res = await request.get(`/api/cron/${job}`, { headers: { authorization: "Bearer wrong" } });
      expect([401, 503], job).toContain(res.status());
    }
  });
  test("a client link that doesn't exist shows nothing", async ({ page }) => {
    await page.goto("/p/offer/not-a-real-token");
    await expect(page.locator("body")).not.toContainText("₹");
  });
});

test.describe("Phase 10: on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("an employee's day works without sideways scrolling", async ({ page }) => {
    test.setTimeout(60_000);
    await login(page, ...EMPLOYEE);
    for (const path of ["/dashboard", "/tasks?mine=1", "/projects", "/content", "/account", "/notifications"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), path).toBe(false);
    }
  });
});
