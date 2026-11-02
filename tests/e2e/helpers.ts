import { expect, type Page } from "@playwright/test";

export const ADMIN = {
  email: process.env.SEED_ADMIN_EMAIL ?? "yogeshwar@rezonest.com",
  password: process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe@123",
};

export async function login(page: Page, email = ADMIN.email, password = ADMIN.password) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}
