import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

const OFFER_PAGE = /\/offers\/(?!new$|templates)[a-z0-9]+$/;
const unique = () => `${Date.now()}`.slice(-9);

async function pick(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

/** Creates a draft offer for a client through the real form. */
async function draftOffer(page: Page, client: string, title: string) {
  await page.goto("/offers/new");
  await pick(page, "Client", client);
  await page.getByLabel("Offer title").fill(title);
  await page.getByRole("button", { name: "Add item" }).click();
  await pick(page, "Item 1 service", "Social Media Marketing");
  await page.getByLabel("Item 1 rate").fill("25000");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(OFFER_PAGE);
  await expect(page.getByTestId("offer-total")).toBeVisible();
}

test.describe("Phase 3: offers", () => {
  test("form checks, live GST, and the Karnataka client gets IGST", async ({ page }) => {
    await login(page);
    await page.goto("/offers/new");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Choose who this offer is for").or(page.getByText("Please fix the highlighted fields.")).first()).toBeVisible();

    await pick(page, "Client", "Vertex Industrial Supplies");
    await page.getByRole("button", { name: "Add item" }).click();
    await pick(page, "Item 1 service", "SEO Services");
    await expect(page.getByLabel("Item 1 description")).toHaveValue("SEO Services");
    await page.getByLabel("Item 1 rate").fill("10000");
    const totals = page.getByTestId("form-totals");
    await expect(totals).toContainText("IGST");
    await expect(totals).toContainText("₹1,800.00");
    await expect(totals).toContainText("₹11,800.00");

    await pick(page, "Client", "Kalyani Auto Components Pvt Ltd");
    await expect(totals).toContainText("CGST");
    await expect(totals).toContainText("₹900.00");
    await expect(totals).toContainText("₹11,800.00");

    await page.getByRole("switch", { name: "Charge GST" }).click();
    await expect(totals).not.toContainText("CGST");
    await expect(totals).toContainText("₹10,000.00");

    await page.getByRole("button", { name: "Use 50 / 30 / 20" }).click();
    await page.getByLabel("Milestone 3 percent").fill("10");
    await page.getByLabel("Offer title").fill("Milestones must total");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText(/must add up to 100%/).first()).toBeVisible();
  });

  test("the whole journey: draft → send → client accepts with no login → recorded", async ({ page, browser }) => {
    const title = `Journey ${unique()}`;
    await login(page);
    await draftOffer(page, "Suraksha Insurance Advisors", title);
    await expect(page.getByTestId("offer-total")).toHaveText("₹29,500.00");
    const offerUrl = page.url();

    // Draft PDF opens
    const pdf = await page.request.get(`${offerUrl.replace(/.*\/offers\//, "/api/offers/")}/pdf`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

    // Send by hand, get the link
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.getByRole("button", { name: "Share myself (WhatsApp)" }).click();
    const linkBox = page.getByTestId("client-link");
    await expect(linkBox).toHaveValue(/\/p\/offer\/[\w-]{43}$/);
    const link = new URL(await linkBox.inputValue()).pathname;
    await expect(page.getByRole("link", { name: "Open WhatsApp" })).toHaveAttribute("href", /^https:\/\/wa\.me\/91\d{10}\?text=.*p%2Foffer/);
    await page.keyboard.press("Escape");
    await expect(page.getByText("Sent").first()).toBeVisible();

    // The client: a brand-new browser with no login
    const clientContext = await browser.newContext();
    const client = await clientContext.newPage();
    await client.goto(link);
    await expect(client.getByRole("heading", { name: /Quotation from/ })).toBeVisible();
    await expect(client.getByTestId("offer-total")).toHaveText("₹29,500.00");
    await expect(client.getByRole("navigation", { name: "Main" })).toHaveCount(0);

    const clientPdf = await client.request.get(`${link}/pdf`);
    expect(clientPdf.status()).toBe(200);
    expect((await clientPdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

    // A logged-out browser can't reach anything else
    await client.goto(offerUrl);
    await expect(client).toHaveURL(/\/login/);
    await client.goto(link);

    await client.getByRole("button", { name: "Accept this offer" }).click();
    await client.getByRole("button", { name: "Confirm acceptance" }).click();
    await expect(client.getByRole("alert").filter({ hasText: /enter your name|valid/i })).toBeVisible();
    await client.getByLabel("Your name").fill("Prakash Bhosale");
    await client.getByRole("button", { name: "Confirm acceptance" }).click();
    await expect(client.getByRole("alert").filter({ hasText: /tick the box/ })).toBeVisible();
    await client.getByRole("checkbox").check();
    await client.getByRole("button", { name: "Confirm acceptance" }).click();
    await expect(client.getByText(/Accepted by Prakash Bhosale/)).toBeVisible();
    await expect(client.getByRole("button", { name: "Accept this offer" })).toHaveCount(0);
    await clientContext.close();

    // Back at the agency
    await page.goto(offerUrl);
    await expect(page.getByRole("status").filter({ hasText: "Accepted by Prakash Bhosale" })).toBeVisible();
    await expect(page.getByText("Client, through the link").first()).toBeVisible();
    await expect(page.getByText(/Client opened the link/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Share" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);

    // The bell tells you
    await page.getByRole("button", { name: /^Notifications/ }).click();
    await expect(page.getByRole("menuitem", { name: /accepted/ }).first()).toBeVisible();
  });

  test("client asks for changes; a new version kills the old link", async ({ page, browser }) => {
    const title = `Changes ${unique()}`;
    await login(page);
    await draftOffer(page, "Sahyadri Smile Dental Clinic", title);
    const offerUrl = page.url();
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.getByRole("button", { name: "Share myself (WhatsApp)" }).click();
    const link = new URL(await page.getByTestId("client-link").inputValue()).pathname;
    await page.keyboard.press("Escape");

    const ctx = await browser.newContext();
    const client = await ctx.newPage();
    await client.goto(link);
    await client.getByRole("button", { name: "Request changes" }).click();
    await client.getByLabel("Your name").fill("Dr. Mahesh");
    await client.getByLabel("What would you like changed?").fill("Please add two more reels each month");
    await client.getByRole("button", { name: "Send request" }).click();
    await expect(client.getByText(/received your message/)).toBeVisible();

    await page.goto(offerUrl);
    await expect(page.getByText(/Please add two more reels each month/)).toBeVisible();
    await expect(page.getByText("On Hold").first()).toBeVisible();

    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: /New version \(v2\)/ }).click();
    await expect(page).toHaveURL(/\/edit$/);
    await expect(page.getByRole("heading", { name: /\(v2\)/ })).toBeVisible();

    await client.goto(link);
    await expect(client.getByRole("heading", { name: "This link is not valid" })).toBeVisible();
    await expect(client.getByRole("button", { name: "Accept this offer" })).toHaveCount(0);
    await ctx.close();
  });

  test("email send uses the console mailer, and needs a follow-up date", async ({ page }) => {
    await login(page);
    await draftOffer(page, "Nexora Infotech Solutions Pvt Ltd", `Email ${unique()}`);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByLabel("Email address")).toHaveValue(/@/);
    await page.getByLabel("Follow-up date").fill("");
    await page.getByRole("button", { name: "Send email" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /valid date/ })).toBeVisible();
    await page.getByLabel("Follow-up date").fill("2099-01-01");
    await page.getByRole("button", { name: "Send email" }).click();
    await expect(page.getByText(/Emailed to/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Share" })).toBeVisible();
  });

  test("a made-up link shows nothing", async ({ browser }) => {
    const ctx = await browser.newContext();
    const client = await ctx.newPage();
    await client.goto(`/p/offer/${"A".repeat(43)}`);
    await expect(client.getByRole("heading", { name: "This link is not valid" })).toBeVisible();
    expect((await client.request.get(`/p/offer/${"A".repeat(43)}/pdf`)).status()).toBe(404);
    await client.goto("/p/offer/short");
    await expect(client.getByRole("heading", { name: "This link is not valid" })).toBeVisible();
    await ctx.close();
  });

  test("list: filters, search, Excel; duplicate; templates", async ({ page }) => {
    await login(page);
    await page.goto("/offers");
    await pick(page, "Status", "Accepted");
    await expect(page).toHaveURL(/status=ACCEPTED/);
    await expect(page.getByRole("link", { name: /REZ\/QT/ }).first()).toBeVisible();
    await page.getByRole("button", { name: "Clear" }).click();
    await expect(page).not.toHaveURL(/status=/);

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Excel" }).click()]);
    expect(download.suggestedFilename()).toMatch(/^offers-.*\.xlsx$/);

    await page.goto("/offers/templates");
    await expect(page.getByRole("link", { name: "Starter Social Media Package" })).toBeVisible();
    await page.getByRole("row", { name: /Starter Social Media Package/ }).getByRole("link", { name: "Use" }).click();
    await expect(page).toHaveURL(/template=/);
    await expect(page.getByLabel("Item 1 description")).toHaveValue(/Social media/);
    await expect(page.getByLabel("Item 1 Reels per month")).toHaveValue("4");
    await pick(page, "Client", "Suraksha Insurance Advisors");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page).toHaveURL(OFFER_PAGE);
    const original = await page.getByRole("heading", { level: 1 }).innerText();

    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
    await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(original);
  });

  test("an employee can't reach offers", async ({ page }) => {
    await login(page, "priya@rezonest.com", "Employee@123");
    for (const path of ["/offers", "/offers/new", "/offers/templates"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/dashboard/);
    }
    expect((await page.request.get("/api/export/offers")).status()).toBe(403);
    expect((await page.request.get("/api/offers/anything/pdf")).status()).toBe(403);
  });
});
