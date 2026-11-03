import { expect, test, type Browser, type Page } from "@playwright/test";
import { login } from "./helpers";

const OFFER_PAGE = /\/offers\/(?!new$|templates)[a-z0-9]+$/;
const PROJECT_PAGE = /\/projects\/[a-z0-9]{20,}$/;
const unique = () => `${Date.now()}`.slice(-9);

async function pick(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

/** Draft → sent → accepted by the client in a separate browser with no login. */
async function acceptedOffer(page: Page, browser: Browser, client: string, title: string, service: string, rate = "25000") {
  await page.goto("/offers/new");
  await pick(page, "Client", client);
  await page.getByLabel("Offer title").fill(title);
  await page.getByRole("button", { name: "Add item" }).click();
  await pick(page, "Item 1 service", service);
  await page.getByLabel("Item 1 rate").fill(rate);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(OFFER_PAGE);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByRole("button", { name: "Share myself (WhatsApp)" }).click();
  const linkBox = page.getByTestId("client-link");
  await expect(linkBox).toHaveValue(/\/p\/offer\//);
  const link = new URL(await linkBox.inputValue()).pathname;
  await page.keyboard.press("Escape");

  const context = await browser.newContext();
  const visitor = await context.newPage();
  await visitor.goto(link);
  await visitor.getByRole("button", { name: "Accept this offer" }).click();
  await visitor.getByLabel("Your name").fill("Prakash Bhosale");
  await visitor.getByRole("checkbox").check();
  await visitor.getByRole("button", { name: "Confirm acceptance" }).click();
  await expect(visitor.getByText(/Accepted by Prakash Bhosale/)).toBeVisible();
  await context.close();
  await page.reload();
}

test.describe("Phase 4: projects, tasks, team", () => {
  test("accepted offer → onboarding → project → tasks → done → progress", async ({ page, browser }) => {
    test.setTimeout(120_000);
    const id = unique();
    await login(page);
    await acceptedOffer(page, browser, "Suraksha Insurance Advisors", `Website ${id}`, "Web & Software Development", "90000");
    const offerUrl = page.url();

    // Onboarding started by itself
    await expect(page.getByText("Client onboarding")).toBeVisible();
    await expect(page.getByTestId("onboarding-percent")).toHaveText("0%");
    await page.getByRole("checkbox", { name: "Advance payment received" }).click();
    await expect(page.getByTestId("onboarding-percent")).not.toHaveText("0%");

    // Convert with one click
    await page.getByRole("link", { name: "Convert to project" }).click();
    await expect(page.getByRole("heading", { name: "Convert to project" })).toBeVisible();
    await expect(page.getByLabel("Project name")).toHaveValue(`Website ${id}`);
    await expect(page.getByLabel("Milestone 1 name")).toHaveValue(/.+/);
    await page.getByLabel("Milestone 1 due date").fill("2030-01-15");
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page).toHaveURL(PROJECT_PAGE);
    const projectUrl = page.url();
    await expect(page.getByRole("heading", { name: `Website ${id}` })).toBeVisible();

    // A second visit can't convert again: it goes to the project
    await page.goto(`${offerUrl}/convert`);
    await expect(page).toHaveURL(PROJECT_PAGE);
    await page.goto(offerUrl);
    await expect(page.getByRole("link", { name: /Open project PRJ-/ })).toBeVisible();

    // Tasks from the template
    await page.goto(`${projectUrl}?tab=tasks`);
    const taskLinks = page.getByRole("main").getByRole("listitem").getByRole("link");
    await expect(taskLinks.first()).toBeVisible();
    await taskLinks.first().click();
    await expect(page).toHaveURL(/\/tasks\/[a-z0-9]{20,}$/);

    // Change status, comment and log time on the task page
    await page.getByRole("combobox", { name: /status/i }).first().click();
    await page.getByRole("option", { name: "Done", exact: true }).click();
    await expect(page.getByRole("combobox", { name: /status/i }).first()).toContainText("Done");
    await page.getByLabel("Minutes").fill("45");
    await page.getByRole("button", { name: "Log", exact: true }).click();
    await expect(page.getByText("0h 45m").first()).toBeVisible();

    await page.goto(projectUrl);
    await expect(page.getByText("Progress").first()).toBeVisible();
    await expect(page.locator("text=/^(?!0%)\\d+%$/").first()).toBeVisible();

    // Milestone and target tabs
    await page.goto(`${projectUrl}?tab=milestones`);
    await expect(page.getByRole("button", { name: "Mark done" }).first()).toBeVisible();
    await page.goto(`${projectUrl}?tab=changes`);
    await page.getByRole("button", { name: "Log request" }).click();
    await page.getByLabel("What's being asked for?").fill("Extra landing page");
    await page.getByLabel(/Estimate/).fill("8000");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Extra landing page")).toBeVisible();
    await expect(page.getByText("₹8,000.00")).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("Approved")).toBeVisible();
  });

  test("a retainer: end date from the offer, targets, committed vs delivered", async ({ page, browser }) => {
    test.setTimeout(90_000);
    const id = unique();
    await login(page);
    await acceptedOffer(page, browser, "Suraksha Insurance Advisors", `Retainer ${id}`, "Social Media Marketing");
    await page.getByRole("link", { name: "Convert to project" }).click();
    await expect(page.getByLabel("Retainer ends")).toHaveValue(/\d{4}-\d{2}-\d{2}/);
    await page.getByLabel("Followers target").fill("5000");
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page).toHaveURL(PROJECT_PAGE);
    const projectUrl = page.url();

    await page.goto(`${projectUrl}?tab=targets`);
    await expect(page.getByText("Followers")).toBeVisible();
    await page.getByRole("button", { name: "Enter result" }).first().click();
    await page.getByLabel("Actual").fill("2500");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("2,500").first()).toBeVisible();

    await page.goto(`${projectUrl}?tab=deliverables`);
    await expect(page.getByText(/created automatically/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Create .* early/ })).toBeVisible();
    await page.getByRole("button", { name: /Create .* early/ }).click();
    await expect(page.getByRole("button", { name: /Create .* early/ })).toHaveCount(0);
  });

  test("project list: search, filters, sort, export; seed projects open", async ({ page }) => {
    await login(page);
    await page.goto("/projects");
    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
    const rows = page.getByRole("row");
    await expect(rows.nth(1)).toBeVisible();

    await page.getByRole("searchbox").or(page.getByPlaceholder(/Search project/)).first().fill("zzzz-nothing");
    await expect(page.getByText("No projects match")).toBeVisible();
    await page.getByRole("button", { name: "Clear" }).click();
    await expect(rows.nth(1)).toBeVisible();

    const download = await page.request.get("/api/export/projects");
    expect(download.status()).toBe(200);
    expect(download.headers()["content-type"]).toContain("spreadsheet");

    await rows.nth(1).getByRole("link").first().click();
    await expect(page).toHaveURL(PROJECT_PAGE);
    await expect(page.getByText("Details")).toBeVisible();
    for (const tab of ["Tasks", "Deliverables", "Milestones", "Targets", "Change requests", "Onboarding"]) {
      await page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: tab, exact: true }).click();
      await expect(page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: tab, exact: true })).toHaveAttribute("aria-current", "page");
      await expect(page.getByText("Something went wrong")).toHaveCount(0);
    }
  });

  test("tasks: create, list, Kanban, calendar, bulk change, and the filter keeps the view", async ({ page }) => {
    const title = `Check artwork ${unique()}`;
    await login(page);
    await page.goto("/tasks/new");
    await page.getByRole("button", { name: /Save|Create/ }).first().click();
    await expect(page.getByText(/Give the task a title|Please fix/).first()).toBeVisible();
    await page.getByRole("textbox", { name: "Task" }).fill(title);
    await pick(page, "Department", "Design & Video");
    await page.getByRole("button", { name: /Save|Create/ }).first().click();
    await expect(page).toHaveURL(/\/tasks\/[a-z0-9]{20,}$/);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();

    await page.goto(`/tasks?q=${encodeURIComponent(title)}`);
    await expect(page.getByRole("link", { name: title })).toBeVisible();

    await page.getByRole("checkbox", { name: new RegExp(`Select ${title}`) }).check();
    await expect(page.getByText("1 selected")).toBeVisible();

    await page.getByRole("link", { name: "Kanban", exact: true }).click();
    await expect(page).toHaveURL(/layout=board/);
    await expect(page.getByRole("link", { name: title })).toBeVisible();
    await page.getByRole("combobox", { name: new RegExp(title) }).selectOption("IN_PROGRESS");
    await expect(page.getByRole("region", { name: "In Progress" }).getByRole("link", { name: title })).toBeVisible();

    // Blocked asks why, and Cancel leaves the task where it was
    await page.getByRole("combobox", { name: new RegExp(title) }).selectOption("BLOCKED");
    await expect(page.getByRole("dialog")).toContainText("What's blocking this task?");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("combobox", { name: new RegExp(title) })).toHaveValue("IN_PROGRESS");

    await page.getByRole("button", { name: "Clear" }).click();
    await expect(page).toHaveURL(/layout=board/);
    await page.goto(`/tasks?layout=board&q=${encodeURIComponent(title)}`);
    await page.getByRole("combobox", { name: new RegExp(title) }).selectOption("DONE");
    await expect(page.getByRole("region", { name: "Done" }).getByRole("link", { name: title })).toBeVisible();

    // The list opens on work still to do; finished tasks are one filter away
    await page.goto(`/tasks?q=${encodeURIComponent(title)}`);
    await expect(page.getByRole("link", { name: title })).toHaveCount(0);
    await page.goto(`/tasks?show=all&q=${encodeURIComponent(title)}`);
    await expect(page.getByRole("link", { name: title })).toBeVisible();

    await page.getByRole("link", { name: "Calendar", exact: true }).click();
    await expect(page).toHaveURL(/layout=calendar/);
    await expect(page.getByText("Mon", { exact: true }).first()).toBeVisible();

    const download = await page.request.get("/api/export/tasks");
    expect(download.status()).toBe(200);
  });

  test("employees see only their work, and no money, team or sales", async ({ page }) => {
    await login(page, "priya@rezonest.com", "Employee@123");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Tasks" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Team" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Invoices" })).toHaveCount(0);

    await page.goto("/team");
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto("/tasks/new");
    await expect(page).toHaveURL(/\/dashboard/);
    const denied = await page.request.get("/api/export/clients");
    expect(denied.status()).toBe(403);

    await page.goto("/tasks");
    await expect(page.getByRole("link", { name: "New task" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Quick add" })).toHaveCount(0);

    await page.goto("/projects");
    const first = page.getByRole("row").nth(1).getByRole("link").first();
    if (await first.count()) {
      await first.click();
      await expect(page).toHaveURL(PROJECT_PAGE);
      await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Change requests" })).toHaveCount(0);
      await expect(page.getByText("₹")).toHaveCount(0);
    }
  });

  test("team: add, restricted access, deactivate with hand-over, reactivate", async ({ page, browser }) => {
    const id = unique();
    const email = `new${id}@example.com`;
    await login(page);
    await page.goto("/team");
    await expect(page.getByRole("link", { name: /Priya/ }).first()).toBeVisible();

    await page.getByRole("link", { name: "Add person" }).click();
    await expect(page).toHaveURL(/\/team\/new$/);
    await page.getByRole("textbox", { name: "Name" }).fill(`New Person ${id}`);
    await page.getByRole("textbox", { name: "Email" }).fill(email);
    await pick(page, "Department", "Social Media");
    await page.getByRole("button", { name: "Add person" }).click();
    await expect(page).toHaveURL(/\/team\/[a-z0-9]{20,}$/);
    await expect(page.getByRole("heading", { name: `New Person ${id}` })).toBeVisible();

    await page.getByRole("button", { name: "Deactivate" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Deactivate" }).click();
    await expect(page.getByRole("button", { name: "Reactivate" })).toBeVisible();

    // They can't sign in
    const context = await browser.newContext();
    const other = await context.newPage();
    await other.goto("/login");
    await other.getByLabel(/email/i).fill(email);
    await other.getByLabel(/password/i).fill("Anything@123");
    await other.getByRole("button", { name: /sign in/i }).click();
    await expect(other).toHaveURL(/\/login/);
    await context.close();

    await page.getByRole("button", { name: "Reactivate" }).click();
    await page.getByRole("alertdialog").or(page.getByRole("dialog")).getByRole("button", { name: "Reactivate" }).click();
    await expect(page.getByRole("button", { name: "Deactivate" })).toBeVisible();

    await page.goto(`/team?q=${encodeURIComponent(email)}`);
    await expect(page.getByRole("link", { name: `New Person ${id}` })).toBeVisible();
  });

  test("onboarding settings save, and the phone layout has no sideways scroll", async ({ page }) => {
    await login(page);
    await page.goto("/settings/lists");
    await expect(page.getByText("Onboarding for every client")).toBeVisible();
    await page.getByRole("button", { name: "Save checklist" }).click();
    await expect(page.getByText(/saved/i).first()).toBeVisible();

    await page.setViewportSize({ width: 375, height: 760 });
    for (const path of ["/projects", "/tasks", "/tasks?layout=board", "/tasks?layout=calendar", "/team", "/team/new", "/tasks/new"]) {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(1);
    }
  });
});
