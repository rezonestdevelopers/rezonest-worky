import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("dashboard works on a phone without sideways scrolling", async ({ page }) => {
  await login(page);
  await expect(page.getByText("Tasks due today")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings/);
});

test("Phase 2 screens work on a phone without sideways scrolling", async ({ page }) => {
  await login(page);
  const noOverflow = async () => {
    await page.waitForLoadState("networkidle");
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), page.url()).toBe(false);
  };
  await page.goto("/clients?q=BrightPath");
  await noOverflow();
  await page.getByRole("link", { name: "BrightPath Coaching Academy" }).click();
  await expect(page).toHaveURL(/\/clients\/[a-z0-9]+/);
  await noOverflow();
  await expect(page.getByRole("link", { name: "WhatsApp" }).first()).toHaveAttribute("href", /^https:\/\/wa\.me\/91\d{10}$/);

  for (const path of ["/leads", "/leads/new", "/leads/import", "/clients/new", "/settings/services", "/settings/lists"]) {
    await page.goto(path);
    await noOverflow();
  }
  await page.goto("/settings/services");
  await page.getByRole("link", { name: "Reels & Posts" }).click();
  await expect(page.getByRole("heading", { name: "Task templates" }).or(page.getByText("Task templates")).first()).toBeVisible();
  await noOverflow();
});
