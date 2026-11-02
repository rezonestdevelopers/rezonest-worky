import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests. Run against a seeded database:
 *   pnpm db:seed && pnpm test:e2e
 * Starts the app automatically unless E2E_BASE_URL is set.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3100";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "pnpm build && pnpm start -p 3100",
        env: { LOGIN_RATE_LIMIT: "1000" }, url: `${baseURL}/login`, timeout: 300_000, reuseExistingServer: true },
});
