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
