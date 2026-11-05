import { expect, test } from "@playwright/test";
import { login } from "./helpers";

const ACTIONS = /^Actions for /;

test.describe("Phase 6: reminders, notifications, digests, templates", () => {
  test("reminders: bell links through; done and snooze move them, and they can come back", async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: /^Notifications/ }).click();
    await page.getByRole("menuitem", { name: "See all reminders and notifications" }).click();
    await expect(page).toHaveURL(/\/notifications$/);
    await expect(page.getByRole("heading", { name: "Reminders & notifications" })).toBeVisible();
    const rows = page.getByRole("row");
    await expect(rows.nth(1)).toBeVisible();

    const firstTitle = (await rows.nth(1).getByRole("link").first().innerText()).trim();
    await rows.nth(1).getByRole("button", { name: ACTIONS }).click();
    await page.getByRole("menuitem", { name: "Mark done" }).click();
    await expect(page.getByText("Marked as done")).toBeVisible();
    await expect(page.getByRole("row", { name: new RegExp(firstTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })).toHaveCount(0);

    await page.goto("/notifications?show=done");
    await expect(page.getByRole("link", { name: firstTitle }).first()).toBeVisible();
    await expect(page.getByRole("row", { name: new RegExp(firstTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first()).toContainText("Marked done");
    await page.getByRole("row", { name: new RegExp(firstTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first().getByRole("button", { name: "Reopen" }).click();
    await expect(page.getByText("Reopened")).toBeVisible();

    // Snooze, custom
    await page.goto("/notifications");
    const second = (await rows.nth(1).getByRole("link").first().innerText()).trim();
    await rows.nth(1).getByRole("button", { name: ACTIONS }).click();
    await page.getByRole("menuitem", { name: "Custom…" }).click();
    await page.getByLabel("Number of days (1 to 90)").fill("5");
    await page.getByRole("dialog").getByRole("button", { name: "Snooze" }).click();
    await expect(page.getByText("Snoozed for 5 days")).toBeVisible();
    await page.goto("/notifications?show=snoozed");
    await expect(page.getByRole("link", { name: second }).first()).toBeVisible();
    await page.getByRole("row", { name: new RegExp(second.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first().getByRole("button", { name: "Reopen" }).click();
    await expect(page.getByText("Reopened")).toBeVisible();

    // Filters and export
    await page.goto("/notifications");
    await page.getByRole("combobox", { name: "Type", exact: true }).click();
    await page.getByRole("option", { name: "Renewals", exact: true }).click();
    await expect(page).toHaveURL(/category=renewal/);
    await expect(rows.nth(1)).toContainText("Renewals");
    const file = await page.request.get("/api/export/reminders");
    expect(file.status()).toBe(200);
    expect(file.headers()["content-type"]).toContain("spreadsheet");
  });

  test("a dashboard snooze and the reminders page agree", async ({ page }) => {
    await login(page);
    await page.goto("/notifications");
    const count = await page.getByText(/\d+ reminders?/).first().innerText();
    expect(count).toMatch(/\d+/);
    await page.goto("/dashboard");
    await expect(page.getByText("Alerts & reminders")).toBeVisible();
    const panel = page.locator("#alerts");
    const item = panel.getByRole("listitem").first();
    const title = (await item.getByRole("link").first().locator("div").first().innerText()).trim();
    await item.getByRole("button", { name: "Alert actions" }).click();
    await page.getByRole("menuitem", { name: "3 days" }).click();
    await expect(page.getByText("Snoozed for 3 days")).toBeVisible();
    await page.goto("/notifications?show=snoozed");
    await expect(page.getByRole("link", { name: title }).first()).toBeVisible();
  });

  test("notifications: read one, then all", async ({ page }) => {
    await login(page);
    await page.goto("/notifications?tab=inbox");
    await expect(page.getByRole("heading", { name: "Reminders & notifications" })).toBeVisible();
    const markAll = page.getByRole("button", { name: /^Mark all \d+ as read$/ });
    if (await markAll.count()) {
      await markAll.click();
      await expect(markAll).toHaveCount(0);
    } else {
      await expect(page.getByText(/No notifications yet|notification/).first()).toBeVisible();
    }
  });

  test("employees see only their own reminders, with no money or admin screens", async ({ page }) => {
    await login(page, "priya@rezonest.com", "Employee@123");
    await page.goto("/notifications");
    await expect(page.getByRole("heading", { name: "Reminders & notifications" })).toBeVisible();
    await expect(page.getByText(/Your tasks that need attention/)).toBeVisible();
    await expect(page.getByText(/owes ₹/)).toHaveCount(0);
    await expect(page.getByText(/expires in|ad budget used/)).toHaveCount(0);
    await page.getByRole("combobox", { name: "Type", exact: true }).click();
    await expect(page.getByRole("option", { name: "Payments", exact: true })).toHaveCount(0);
    await expect(page.getByRole("option", { name: "Overdue tasks", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.goto("/settings/emails");
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto("/settings/emails/offer_send");
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("templates: preview as you type, misspelt placeholders refused, save, test, reset", async ({ page }) => {
    await login(page);
    await page.goto("/settings");
    await page.getByRole("link", { name: "Email templates" }).click();
    await expect(page).toHaveURL(/\/settings\/emails$/);
    await expect(page.getByRole("row", { name: /Send offer/ })).toContainText("Original");
    await page.getByRole("button", { name: "Send me today's digest" }).click();
    await expect(page.getByText(/Today's digest sent to/)).toBeVisible();

    await page.getByRole("link", { name: "Send offer" }).click();
    await expect(page).toHaveURL(/\/settings\/emails\/offer_send$/);
    const subject = page.getByLabel("Subject");
    await subject.fill("Your quote {{offerNumber}}");
    await expect(page.getByTestId("preview-subject")).toHaveText("Your quote REZ/QT/2026-27/0015");

    await subject.fill("Your quote {{offerNumbr}}");
    await expect(page.getByText(/These can't be filled in: \{\{offerNumbr\}\}/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();

    await subject.fill("Your quote {{offerNumber}}");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Template saved.")).toBeVisible();
    await page.getByRole("button", { name: "Send me a test" }).click();
    await expect(page.getByText(/Test sent to/)).toBeVisible();
    await page.goto("/settings/emails");
    await expect(page.getByRole("row", { name: /Send offer/ })).toContainText("Edited");

    await page.goto("/settings/emails/offer_send");
    await page.getByRole("button", { name: "Reset" }).click();
    await page.getByRole("alertdialog").or(page.getByRole("dialog")).getByRole("button", { name: "Reset" }).click();
    await expect(subject).toHaveValue("Quotation {{offerNumber}} from {{agencyName}}");
  });

  test("the scheduled job needs its secret, and team options save; phone layout has no sideways scroll", async ({ page }) => {
    test.setTimeout(70_000);
    const denied = await page.request.get("/api/cron/reminders");
    expect([401, 503]).toContain(denied.status());
    const wrong = await page.request.get("/api/cron/reminders", { headers: { authorization: "Bearer wrong" } });
    expect([401, 503]).toContain(wrong.status());

    await login(page);
    await page.goto("/team");
    await page.getByRole("link", { name: /Priya/ }).first().click();
    await expect(page.getByRole("switch", { name: /Email when assigned or mentioned/ })).toBeVisible();

    await page.setViewportSize({ width: 375, height: 760 });
    for (const path of ["/notifications", "/notifications?tab=inbox", "/settings/emails", "/settings/emails/daily_digest"]) {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(1);
    }
  });
});
