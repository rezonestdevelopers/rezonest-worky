import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

const unique = () => `${Date.now()}`.slice(-9);
const EXPENSE_PAGE = /\/expenses\/[a-z0-9]{20,}$/;
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");

async function pick(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function newClient(page: Page, name: string) {
  await page.goto("/clients/new");
  await page.getByLabel("Company name").fill(name);
  await page.getByLabel("Main contact person").fill("Meera Joshi");
  await page.getByLabel("Phone").fill(`97${unique().slice(-8)}`);
  await pick(page, "State", "Maharashtra (27)");
  await page.getByRole("button", { name: "Create client" }).click();
  await expect(page).toHaveURL(/\/clients\/[a-z0-9]{20,}/);
  return page.url().split("?")[0];
}

test.describe("Phase 8: expenses, profit, documents, communication", () => {
  test("add an expense, attach a bill, see it in lists and on the client's profit", async ({ page }) => {
    test.setTimeout(90_000);
    const id = unique();
    await login(page);
    const company = `Costs ${id}`;
    const clientUrl = await newClient(page, company);

    await page.goto("/expenses/new");
    await page.getByLabel("Description").fill(`Freelance editor ${id}`);
    await page.getByLabel("Amount before GST").fill("12,500");
    await page.getByLabel("GST paid").fill("2250");
    await pick(page, "Category", "Freelancer");
    await pick(page, "Client", company);
    await page.getByRole("button", { name: "Save expense" }).click();
    await expect(page).toHaveURL(EXPENSE_PAGE);
    const url = page.url();

    // A file that isn't really a document is refused, whatever its name
    await page.getByLabel("Attach the bill").setInputFiles({ name: "bill.pdf", mimeType: "application/pdf", buffer: Buffer.from("<script>alert(1)</script>") });
    await page.getByRole("button", { name: "Upload" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Only images, PDF" })).toBeVisible();

    await page.getByLabel("Attach the bill").setInputFiles({ name: "bill.pdf", mimeType: "application/pdf", buffer: PDF });
    await page.getByRole("button", { name: "Upload" }).click();
    await expect(page.getByTestId("bill")).toContainText("bill.pdf");
    const preview = await page.getByTestId("bill").getByRole("link", { name: "Preview" }).getAttribute("href");
    const res = await page.request.get(preview!);
    expect(res.headers()["content-type"]).toBe("application/pdf");
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");

    await page.goto(`/expenses?q=${id}`);
    await expect(page.getByRole("link", { name: `Freelance editor ${id}` })).toBeVisible();
    await expect(page.getByRole("main").getByText("₹12,500.00")).toBeVisible();
    await expect(page.getByLabel("Bill attached")).toBeVisible();

    await page.goto(`${clientUrl}?tab=expenses`);
    await expect(page.getByTestId("client-profit")).toHaveText("-₹12,500");

    await page.goto("/expenses/profit?period=month");
    await expect(page.getByRole("heading", { name: "Agency revenue vs expenses" })).toBeVisible();
    await expect(page.getByRole("row", { name: new RegExp(company) })).toContainText("₹12,500");

    // Archiving takes it out of profit, and it can come back
    await page.goto(url);
    await page.getByRole("button", { name: "Archive" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Archive" }).click();
    await expect(page.getByText("Archived", { exact: true })).toBeVisible();
    await page.goto(`${clientUrl}?tab=expenses`);
    await expect(page.getByTestId("client-profit")).toHaveText("₹0");
  });

  test("a form that's wrong says so, and nothing saves", async ({ page }) => {
    await login(page);
    await page.goto("/expenses/new");
    await page.getByRole("button", { name: "Save expense" }).click();
    await expect(page.getByText("Describe this expense")).toBeVisible();
    await expect(page).toHaveURL(/\/expenses\/new$/);
  });

  test("documents: upload, preview, download, archive", async ({ page }) => {
    test.setTimeout(60_000);
    const id = unique();
    await login(page);
    const clientUrl = await newClient(page, `Docs ${id}`);
    await page.goto(`${clientUrl}?tab=documents`);
    await expect(page.getByText("No documents yet.")).toBeVisible();

    await page.getByLabel("Kind").selectOption("NDA");
    await page.getByLabel("File").setInputFiles({ name: "signed-nda.pdf", mimeType: "application/pdf", buffer: PDF });
    await page.getByRole("button", { name: "Upload" }).click();
    const list = page.getByTestId("document-list");
    await expect(list).toContainText("signed-nda.pdf");
    await expect(list).toContainText("NDA");

    const preview = await page.getByRole("link", { name: "Preview signed-nda.pdf" }).getAttribute("href");
    expect((await page.request.get(preview!)).headers()["content-disposition"]).toContain("inline");
    const download = await page.getByRole("link", { name: "Download signed-nda.pdf" }).getAttribute("href");
    expect((await page.request.get(download!)).headers()["content-disposition"]).toContain("attachment");

    await page.getByRole("button", { name: "Archive signed-nda.pdf" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Archive" }).click();
    await expect(page.getByText("No documents yet.")).toBeVisible();
    expect((await page.request.get(download!)).status()).toBe(404);
  });

  test("communication log: next action becomes a reminder; edit and archive; on a lead too", async ({ page }) => {
    test.setTimeout(90_000);
    const id = unique();
    await login(page);
    const clientUrl = await newClient(page, `Talks ${id}`);
    await page.goto(`${clientUrl}?tab=communication`);
    await page.getByRole("button", { name: "Log", exact: true }).click();
    const dialog = page.getByRole("dialog");

    // A next action needs a date, so a reminder can fire
    await dialog.getByLabel("What was said").fill("Talked about the renewal");
    await dialog.getByLabel("Next action").fill(`Send renewal quote ${id}`);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByText("Choose when, so you get a reminder")).toBeVisible();
    const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
    await dialog.getByLabel("Remind me on").fill(today);
    await dialog.getByRole("button", { name: "Save" }).click();
    const list = page.getByTestId("communication-list");
    await expect(list).toContainText(`Next: Send renewal quote ${id}`);

    await page.goto("/dashboard?alerts=follow_up#alerts");
    await expect(page.getByText(`Send renewal quote ${id}`).first()).toBeVisible();

    await page.goto(`${clientUrl}?tab=communication`);
    await list.getByRole("button", { name: /^Edit entry/ }).click();
    await dialog.getByLabel("What was said").fill("Talked about renewal and pricing");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(list).toContainText("renewal and pricing");
    await list.getByRole("button", { name: /^Archive entry/ }).click();
    await dialog.getByRole("button", { name: "Archive" }).click();
    await expect(page.getByText("Nothing logged yet.")).toBeVisible();

    await page.goto("/leads");
    await page.getByRole("main").getByRole("table").getByRole("link").first().click();
    await expect(page).toHaveURL(/\/leads\/[a-z0-9]{20,}$/);
    await page.getByRole("button", { name: "Log", exact: true }).click();
    await dialog.getByLabel("What was said").fill(`Lead call ${id}`);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("communication-list")).toContainText(`Lead call ${id}`);
  });

  test("project overview shows its profit", async ({ page }) => {
    await login(page);
    await page.goto("/projects");
    await page.getByRole("main").getByRole("table").getByRole("link").first().click();
    await expect(page).toHaveURL(/\/projects\/[a-z0-9]{20,}/);
    await expect(page.getByTestId("project-profit")).toContainText("Profit");
    await expect(page.getByRole("link", { name: "Add expense" })).toBeVisible();
  });

  test("filters, sorting and exports", async ({ page }) => {
    await login(page);
    await page.goto("/expenses?category=SOFTWARE_TOOLS");
    await expect(page.getByRole("row").nth(1)).toContainText("Software & tools");
    await page.goto("/expenses?link=overhead");
    await expect(page.getByRole("row").nth(1)).toContainText("Agency overhead");
    for (const path of ["/api/export/expenses", "/api/export/profit?period=fy"]) {
      const res = await page.request.get(path);
      expect(res.status(), path).toBe(200);
      expect(res.headers()["content-type"]).toContain("spreadsheet");
    }
  });

  test("an employee can't reach expenses, profit, or a client's documents", async ({ page }) => {
    await login(page, "kunal@rezonest.com", "Employee@123");
    for (const path of ["/expenses", "/expenses/new", "/expenses/profit"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/dashboard/);
    }
    for (const path of ["/api/export/expenses", "/api/export/profit"]) {
      expect((await page.request.get(path)).status(), path).toBe(403);
    }
    expect((await page.request.get("/api/documents/nothing-here")).status()).toBe(404);
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 } });
    test("the new screens don't scroll sideways", async ({ page }) => {
      test.setTimeout(60_000);
      await login(page);
      const flat = async () => {
        await page.waitForLoadState("networkidle");
        expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), page.url()).toBe(false);
      };
      for (const path of ["/expenses", "/expenses/new", "/expenses/profit"]) {
        await page.goto(path);
        await flat();
      }
      await page.goto("/clients");
      await page.getByRole("main").getByRole("table").getByRole("link").first().click();
      await expect(page).toHaveURL(/\/clients\/[a-z0-9]{20,}/);
      const client = page.url().split("?")[0];
      for (const tab of ["expenses", "documents", "communication"]) {
        await page.goto(`${client}?tab=${tab}`);
        await flat();
      }
    });
  });
});
