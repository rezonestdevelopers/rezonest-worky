import { expect, test } from "@playwright/test";
import { ADMIN, login } from "./helpers";

test.describe("Phase 1 — auth, dashboard, settings, search", () => {
  test("redirects to login when signed out", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("wrong password shows an error", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(ADMIN.email);
    await page.getByLabel("Password").fill("definitely-wrong");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Wrong email or password.")).toBeVisible();
  });

  test("dashboard shows all sections with seeded data", async ({ page }) => {
    await login(page);
    await expect(page.getByText("Tasks due today")).toBeVisible();
    for (const label of ["Total clients", "MRR (retainers)", "Total outstanding", "Projects at risk"]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByText("Sales pipeline")).toBeVisible();
    await expect(page.getByText("Alerts & reminders")).toBeVisible();
    await expect(page.getByText("Upcoming deadlines")).toBeVisible();
    await expect(page.getByText("Client work")).toBeVisible();
    await expect(page.getByRole("link", { name: "Kalyani Auto Components Pvt Ltd", exact: true })).toBeVisible();
    await expect(page.getByText("Invoiced vs received")).toBeVisible();
    await expect(page.getByText("Outstanding ageing")).toBeVisible();
  });

  test("filters update the URL and the data", async ({ page }) => {
    await login(page);
    await page.getByRole("combobox", { name: "Date range" }).click();
    await page.getByRole("option", { name: "Last 12 months" }).click();
    await expect(page).toHaveURL(/range=last_12_months/);
    await page.getByRole("combobox", { name: "Sectors" }).click();
    await page.getByRole("option", { name: "Healthcare & Clinics" }).click();
    await expect(page).toHaveURL(/sector=/);
    await expect(page.getByRole("link", { name: "Sahyadri Smile Dental Clinic", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Kalyani Auto Components Pvt Ltd", exact: true })).toHaveCount(0);
  });

  test("snooze an alert hides it", async ({ page }) => {
    await login(page);
    const panel = page.locator("#alerts");
    const first = panel.locator("li").first();
    const title = (await first.locator("a div").first().innerText()).trim();
    await first.getByRole("button", { name: "Alert actions" }).click();
    await page.getByRole("menuitem", { name: "1 day" }).click();
    await expect(page.getByText(/Snoozed for 1 day/)).toBeVisible();
    await page.reload();
    await expect(panel.getByText(title, { exact: true })).toHaveCount(0);
    // restore so the test is repeatable
    await panel.getByRole("button", { name: "Restore snoozed" }).click();
    await expect(panel.getByText(title, { exact: true }).first()).toBeVisible();
  });

  test("Excel export downloads a file", async ({ page }) => {
    await login(page);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Excel" }).click()]);
    expect(download.suggestedFilename()).toMatch(/^client-work-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  test("global search finds a client with Ctrl+K", async ({ page }) => {
    await login(page);
    await page.keyboard.press("Control+k");
    await page.getByPlaceholder(/Type a client/).fill("Pristine");
    await expect(page.getByRole("option", { name: /Pristine Heights Realty LLP/ }).first()).toBeVisible();
  });

  test("settings: validation and save", async ({ page }) => {
    await login(page);
    await page.goto("/settings");
    await page.getByRole("tab", { name: /GST/ }).click();
    await page.getByLabel("GSTIN").fill("12345");
    await page.getByLabel("GSTIN").blur();
    await expect(page.getByText(/Invalid GSTIN format/)).toBeVisible();
    await page.getByLabel("GSTIN").fill("");
    const branch = `Bhosari ${Date.now()}`;
    await page.getByLabel("Branch").fill(branch);
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText(/Saved \d+ change/)).toBeVisible();
    await page.reload();
    await page.getByRole("tab", { name: /GST/ }).click();
    await expect(page.getByLabel("Branch")).toHaveValue(branch);
    await page.getByLabel("Branch").fill("");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText(/Saved \d+ change/)).toBeVisible();
  });

  test("unbuilt sections show a phase placeholder", async ({ page }) => {
    await login(page);
    await page.goto("/invoices");
    await expect(page.getByText(/coming in Phase 7/)).toBeVisible();
  });
});
