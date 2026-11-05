import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

const SPREADSHEET = "spreadsheet";
const shared = async (page: Page, path: string, type: string) => {
  const res = await page.request.get(path);
  expect(res.status(), path).toBe(200);
  expect(res.headers()["content-type"], path).toContain(type);
  return res;
};

test.describe("Phase 9: reports, GST summary, data export, backups", () => {
  test("agency report: sections, dates and downloads", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page);
    await page.getByRole("link", { name: "Reports" }).first().click();
    await expect(page).toHaveURL(/\/reports$/);
    await page.getByRole("link", { name: /Agency report/ }).click();
    for (const title of ["Revenue by month", "Revenue by service", "Revenue by sector", "Revenue by lead source", "Offer conversion", "MRR trend", "Outstanding and ageing", "Team workload and on-time delivery", "Renewals calendar", "Profit by client", "Profit by service"]) {
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    }
    const pdf = await page.getByRole("link", { name: "PDF" }).getAttribute("href");
    expect((await (await shared(page, pdf!, "application/pdf")).body()).subarray(0, 4).toString()).toBe("%PDF");
    const excel = await page.getByRole("link", { name: "Excel" }).getAttribute("href");
    await shared(page, excel!, SPREADSHEET);

    // A period with nothing in it says so
    await page.getByLabel("From").fill("2001-01-01");
    await page.getByLabel("To").fill("2001-01-31");
    await page.getByRole("button", { name: "Show" }).click();
    await expect(page.getByText("No revenue in this period.").first()).toBeVisible();
  });

  test("GST summary: by month, with invoices and credit notes", async ({ page }) => {
    await login(page);
    await page.goto("/reports/gst");
    await expect(page.getByText("Output tax by month")).toBeVisible();
    await expect(page.getByTestId("report-summary")).toContainText("Net output tax");
    await expect(page.getByRole("row", { name: /^REZ\/INV\// }).first()).toBeVisible();
    await expect(page.getByRole("row", { name: /^REZ\/CN\// }).first()).toBeVisible();
    await shared(page, "/api/reports/gst?format=pdf", "application/pdf");
    await shared(page, "/api/reports/gst?format=xlsx", SPREADSHEET);
    await page.goto("/reports/gst?fy=2025-26");
    await expect(page.getByRole("row", { name: /^Mar 2026/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /^Apr 2026/ })).toHaveCount(0);
  });

  test("internal client report has money and team; the client's monthly report doesn't", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page);
    await page.goto("/reports/client");
    await expect(page.getByText("Choose a client")).toHaveCount(2);
    await page.getByLabel("Client").selectOption({ label: "Pristine Heights Realty LLP" });
    await page.getByRole("button", { name: "Show" }).click();
    await expect(page.getByText("Task timeline")).toBeVisible();
    await expect(page.getByTestId("report-summary")).toContainText("Profit");
    await expect(page.getByText("Assigned to")).toBeVisible();
    const internalPdf = await page.getByRole("link", { name: "PDF" }).getAttribute("href");
    await shared(page, internalPdf!, "application/pdf");

    await page.goto("/reports/monthly");
    await page.getByLabel("Client").selectOption({ label: "Pristine Heights Realty LLP" });
    await page.getByRole("button", { name: "Show" }).click();
    await expect(page.getByText("Ads results")).toBeVisible();

    const main = page.getByRole("main");
    await expect(main.getByText("Profit", { exact: true })).toHaveCount(0);
    await expect(main.getByText("Assigned to")).toHaveCount(0);
    await expect(main.getByText("Invoices", { exact: true })).toHaveCount(0);

    await page.getByLabel("Highlights").fill("Leads up by a third this month.");
    await page.getByLabel("Plan for next month").fill("Two new creatives for the festive offer.");
    await page.getByRole("button", { name: "Save words" }).click();
    await expect(main.getByText("Leads up by a third this month.").last()).toBeVisible();
    await expect(main.getByRole("heading", { name: "Plan for next month" })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Highlights")).toHaveValue("Leads up by a third this month.");

    await page.getByRole("button", { name: "Email to client" }).click();
    await page.getByRole("dialog").getByLabel("Send to").fill("client@example.com");
    await page.getByRole("dialog").getByRole("button", { name: "Send email" }).click();
    await expect(page.getByText("Sent to client@example.com.")).toBeVisible();

    const href = await page.getByRole("link", { name: "PDF" }).getAttribute("href");
    await shared(page, href!, "application/pdf");
  });

  test("a client's Reports tab links straight to their reports", async ({ page }) => {
    await login(page);
    await page.goto("/clients");
    await page.getByRole("main").getByRole("table").getByRole("link").first().click();
    await expect(page).toHaveURL(/\/clients\/[a-z0-9]{20,}/);
    const client = page.url().split("?")[0];
    await page.goto(`${client}?tab=reports`);
    await page.getByRole("link", { name: /Monthly report for the client/ }).click();
    await expect(page).toHaveURL(/\/reports\/monthly\?client=/);
    await expect(page.getByLabel("Highlights")).toBeVisible();
  });

  test("data export: any table, no password hashes, formulas made safe", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page);
    await page.goto("/settings/data");
    await expect(page.getByRole("row", { name: /Invoices/ })).toBeVisible();

    const users = await shared(page, "/api/export/data/user?format=csv", "text/csv");
    const text = await users.text();
    expect(text).toContain("yogeshwar@rezonest.com");
    expect(text).not.toContain("passwordHash");
    expect(text).not.toMatch(/\$2[aby]\$/);

    await shared(page, "/api/export/data/invoice", SPREADSHEET);
    await shared(page, "/api/export/data/all", SPREADSHEET);
    expect((await page.request.get("/api/export/data/passwordResetToken")).status()).toBe(404);
    expect((await page.request.get("/api/export/data/publicLink")).status()).toBe(404);
  });

  test("backups: back up now, once a day, download", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page);
    await page.goto("/settings/backups");
    await expect(page.getByTestId("backup-warning")).toBeVisible();
    await page.getByRole("button", { name: "Back up now" }).click();
    await expect(page.getByRole("row").nth(1)).toContainText("Done", { timeout: 60_000 });
    const download = page.getByRole("link", { name: /^Download backup of/ }).first();
    const href = await download.getAttribute("href");
    const file = await page.request.get(href!);
    expect(file.status()).toBe(200);
    expect(file.headers()["content-disposition"]).toContain("attachment");
    expect((await file.body()).subarray(0, 5).toString()).toBe("PGDMP");

    await page.getByRole("button", { name: "Back up now" }).click();
    await expect(page.getByText("Today's backup is already done.")).toBeVisible();
    await expect(page.getByRole("row")).toHaveCount(2);

    // The daily job needs its secret
    expect((await page.request.get("/api/cron/backup", { headers: { authorization: "Bearer wrong" } })).status()).toBeGreaterThanOrEqual(401);
  });

  test("private files can't be reached through the general file address", async ({ page }) => {
    await login(page, "kunal@rezonest.com", "Employee@123");
    for (const key of ["private/backups/2026-11-05.dump", "private/bills/x.pdf", "private/documents/x.pdf", "private/signature.png"]) {
      expect((await page.request.get(`/api/files/${key}`)).status(), key).toBe(404);
    }
  });

  test("an employee can't reach reports, exports or backups", async ({ page }) => {
    await login(page, "kunal@rezonest.com", "Employee@123");
    for (const path of ["/reports", "/reports/agency", "/reports/gst", "/reports/client", "/reports/monthly", "/settings/data", "/settings/backups"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/dashboard/);
    }
    for (const path of ["/api/reports/agency", "/api/reports/gst", "/api/reports/monthly?client=x", "/api/export/data/client", "/api/export/data/all", "/api/backups/x"]) {
      expect((await page.request.get(path)).status(), path).toBe(403);
    }
  });

  test("a manager can't reach reports or backups either", async ({ page, request }) => {
    const anonymous = await request.get("/api/reports/agency", { maxRedirects: 0 });
    expect([302, 303, 307, 401, 403]).toContain(anonymous.status());
    await login(page, "kunal@rezonest.com", "Employee@123");
    expect((await page.request.get("/api/reports/client?client=x&format=xlsx")).status()).toBe(403);
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 } });
    test("reports and settings pages don't scroll sideways", async ({ page }) => {
      test.setTimeout(90_000);
      await login(page);
      for (const path of ["/reports", "/reports/agency", "/reports/gst", "/reports/client", "/reports/monthly", "/settings/data", "/settings/backups"]) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), path).toBe(false);
      }
    });
  });
});
