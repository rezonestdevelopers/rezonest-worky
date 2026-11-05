import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { login } from "./helpers";

const unique = () => `${Date.now()}`.slice(-9);
const ITEM_PAGE = /\/content\/[a-z0-9_]{20,}$/;
const LOGO = path.join(process.cwd(), "public", "logo.png");

async function pick(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() + 5.5 * 3_600_000 - n * 86_400_000).toISOString().slice(0, 10);

/** Adds an item through the real form, for a client with no sample content. */
async function addContent(page: Page, client: string, topic: string) {
  await page.goto("/content/new");
  await pick(page, "Client", client);
  await page.getByRole("textbox", { name: "Topic" }).fill(topic);
  await page.getByRole("textbox", { name: "Caption" }).fill(`Caption for ${topic}`);
  await page.getByRole("button", { name: "Add content" }).click();
  await expect(page).toHaveURL(ITEM_PAGE);
  await expect(page.getByRole("heading", { name: topic })).toBeVisible();
  return page.url();
}

test.describe("Phase 5: content, ads, renewals", () => {
  test("content → client approves and asks for changes with no login → publish", async ({ page, browser }) => {
    test.setTimeout(120_000);
    const id = unique();
    const client = "Vertex Industrial Supplies";
    await login(page);
    const first = await addContent(page, client, `Approve me ${id}`);
    const second = await addContent(page, client, `Change me ${id}`);

    // A creative: an image upload, and the rule on what can be uploaded
    await page.goto(first);
    await page.getByTestId("creative-file").setInputFiles(LOGO);
    await expect(page.getByRole("img", { name: "Creative" })).toBeVisible();

    // Can't publish before approval
    await expect(page.getByText(/once the client has approved/)).toBeVisible();

    // Send for approval
    const clientRow = await page.getByRole("link", { name: client }).first().getAttribute("href");
    const clientId = clientRow!.match(/\/clients\/([^?]+)/)![1];
    await page.goto(`/content?client=${clientId}`);
    await expect(page.getByTestId("approval-link-state")).toContainText("No link shared yet");
    await page.getByRole("button", { name: "Send for approval" }).click();
    const box = page.getByTestId("content-link");
    await expect(box).toHaveValue(/\/p\/content\/[\w-]{43}$/);
    const link = new URL(await box.inputValue()).pathname;
    await expect(page.getByRole("link", { name: "Open WhatsApp" })).toHaveAttribute("href", /^https:\/\/wa\.me\/.*p%2Fcontent/);
    await page.keyboard.press("Escape");

    // The client: a new browser with no login, seeing only this client's month
    const context = await browser.newContext();
    const visitor = await context.newPage();
    await visitor.goto(link);
    await expect(visitor.getByRole("heading", { name: new RegExp(`content for ${client}`) })).toBeVisible();
    await expect(visitor.getByRole("navigation", { name: "Main" })).toHaveCount(0);
    const approve = visitor.getByRole("article", { name: `Approve me ${id}` });
    const change = visitor.getByRole("article", { name: `Change me ${id}` });
    await expect(approve.getByText(`Caption for Approve me ${id}`)).toBeVisible();
    await expect(approve.getByRole("img")).toBeVisible();
    await expect(visitor.getByText(/design status/i)).toHaveCount(0);

    // A name is needed
    await approve.getByRole("button", { name: "Approve" }).click();
    await expect(approve.getByRole("alert")).toContainText("your name");
    await visitor.getByLabel("Your name").fill("Prakash Bhosale");
    await approve.getByRole("button", { name: "Approve" }).click();
    await expect(approve.getByText("Approved", { exact: true })).toBeVisible();
    await expect(approve.getByRole("button", { name: "Approve" })).toHaveCount(0);

    // Asking for changes needs a comment
    await change.getByRole("button", { name: "Request changes" }).click();
    await change.getByRole("button", { name: "Send request" }).click();
    await expect(change.getByRole("alert")).toContainText("what you'd like changed");
    await change.getByLabel("What would you like changed?").fill("Use the new logo");
    await change.getByRole("button", { name: "Send request" }).click();
    await expect(change.getByText("We're making your changes")).toBeVisible();
    await expect(change.getByText("Use the new logo")).toBeVisible();

    // The creative is reachable through the link, but a logged-out browser can't see the app
    const internal = await context.request.get(`/api/content/${first.split("/").pop()}/creative`, { maxRedirects: 0 });
    expect(internal.status()).not.toBe(200);
    await visitor.goto(first);
    await expect(visitor).toHaveURL(/\/login/);
    await context.close();

    // Back in the app: the answers are there
    await page.goto(second);
    await expect(page.getByText("Use the new logo")).toBeVisible();
    await expect(page.getByText("Prakash Bhosale")).toBeVisible();
    await page.getByRole("button", { name: "Ready for the client again" }).click();
    await expect(page.getByRole("button", { name: "Ready for the client again" })).toHaveCount(0);

    // Approved, so it can be published
    await page.goto(first);
    await page.getByLabel("Link to the live post").fill("instagram.com/p/abc");
    await page.getByRole("button", { name: "Mark as published" }).click();
    await expect(page.getByRole("link", { name: "See it live" })).toHaveAttribute("href", "https://instagram.com/p/abc");
    await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);

    // Withdraw the link: it stops working
    await page.goto(`/content?client=${clientId}`);
    await page.getByRole("button", { name: "Withdraw" }).click();
    await page.getByRole("alertdialog").or(page.getByRole("dialog")).getByRole("button", { name: "Withdraw link" }).click();
    await expect(page.getByTestId("approval-link-state")).toContainText("No link shared yet");
    const gone = await browser.newContext();
    const again = await gone.newPage();
    await again.goto(link);
    await expect(again.getByText(/no longer works/)).toBeVisible();
    await expect(again.getByRole("article")).toHaveCount(0);
    await gone.close();
  });

  test("calendar and list: filters, month changes, committed vs delivered, export", async ({ page }) => {
    await login(page);
    await page.goto("/content");
    await expect(page.getByRole("heading", { name: "Content Calendar" })).toBeVisible();
    await expect(page.getByText("Mon", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Committed vs delivered")).toBeVisible();
    await expect(page.getByTestId("delivery-counts").first()).toContainText(/\d+\/\d+/);

    const heading = await page.getByRole("heading", { level: 2 }).first().innerText();
    await page.getByRole("link", { name: "Next month" }).click();
    await expect(page).toHaveURL(/month=/);
    await expect(page.getByRole("heading", { level: 2 }).first()).not.toHaveText(heading);
    await page.getByRole("link", { name: "Previous month" }).click();
    await expect(page.getByRole("heading", { level: 2 }).first()).toHaveText(heading);

    await page.getByRole("link", { name: "List", exact: true }).click();
    await expect(page).toHaveURL(/layout=list/);
    await expect(page.getByRole("row").nth(1)).toBeVisible();
    await pick(page, "Approval", "Approved");
    await expect(page).toHaveURL(/approval=APPROVED/);
    await page.getByRole("button", { name: "Clear" }).click();
    await expect(page).toHaveURL(/layout=list/);
    await expect(page).not.toHaveURL(/approval=/);

    const download = await page.request.get("/api/export/content");
    expect(download.status()).toBe(200);
    expect(download.headers()["content-type"]).toContain("spreadsheet");
  });

  test("ads: campaign, results, overlap refused, metrics, report upload", async ({ page }) => {
    test.setTimeout(90_000);
    const name = `Campaign ${unique()}`;
    await login(page);
    await page.goto("/ads");
    await expect(page.getByText(/never counts as your revenue/)).toBeVisible();
    await expect(page.getByRole("row").nth(1)).toBeVisible();

    await page.getByRole("link", { name: "New campaign" }).click();
    await expect(page).toHaveURL(/\/ads\/new$/);
    await page.getByRole("button", { name: "Add campaign" }).click();
    await expect(page.getByText(/Choose a client|Please fix/).first()).toBeVisible();
    await pick(page, "Client", "Vertex Industrial Supplies");
    await page.getByRole("textbox", { name: "Campaign name" }).fill(name);
    await page.getByRole("textbox", { name: /Client's budget/ }).fill("10,000");
    await page.getByRole("textbox", { name: "Start date" }).fill(daysAgo(40));
    await page.getByRole("button", { name: "Add campaign" }).click();
    await expect(page).toHaveURL(/\/ads\/[a-z0-9]{20,}$/);
    await expect(page.getByTestId("budget-line")).toContainText("₹0.00 of ₹10,000.00");
    const campaignUrl = page.url();

    // By hand, with worked-out figures
    await page.getByRole("button", { name: "Add results" }).click();
    await page.getByLabel("From", { exact: true }).fill(daysAgo(20));
    await page.getByLabel("To", { exact: true }).fill(daysAgo(14));
    await page.getByLabel(/Amount spent/).fill("8,500");
    await page.getByLabel("Impressions").fill("100000");
    await page.getByLabel("Clicks").fill("1500");
    await page.getByLabel("Leads").fill("34");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("budget-line")).toContainText("₹8,500.00 of ₹10,000.00");
    await expect(page.getByText("85%").first()).toBeVisible();
    await expect(page.getByText("1.5%").first()).toBeVisible();
    await expect(page.getByText("₹250.00").first()).toBeVisible();

    // The same dates again are refused
    await page.getByRole("button", { name: "Add results" }).click();
    await page.getByLabel("From", { exact: true }).fill(daysAgo(14));
    await page.getByLabel("To", { exact: true }).fill(daysAgo(10));
    await page.getByLabel(/Amount spent/).fill("100");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(/overlap/);
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

    // A report from Ads Manager: preview, then add. Uploading again adds nothing.
    const report = {
      name: "report.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(`Campaign name,Reporting starts,Reporting ends,Amount spent (INR),Impressions,Link clicks,Leads\n${name},${daysAgo(9)},${daysAgo(3)},"1,000.00",20000,300,6\nNo Such Campaign,${daysAgo(9)},${daysAgo(3)},500,1000,10,1\n`),
    };
    await page.goto("/ads/import");
    await pick(page, "Client", "Vertex Industrial Supplies");
    await page.getByTestId("ad-report-file").setInputFiles(report);
    await expect(page.getByText("1 ready")).toBeVisible();
    await expect(page.getByText(/No campaign called/)).toBeVisible();
    await page.getByRole("button", { name: "Add 1 row" }).click();
    await expect(page).toHaveURL(/\/ads$/);
    await page.goto(campaignUrl);
    await expect(page.getByTestId("budget-line")).toContainText("₹9,500.00 of ₹10,000.00");
    await expect(page.getByText("Uploaded")).toBeVisible();

    await page.goto("/ads/import");
    await pick(page, "Client", "Vertex Industrial Supplies");
    await page.getByTestId("ad-report-file").setInputFiles(report);
    await expect(page.getByText(/already been entered/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Add 0 rows" })).toBeDisabled();

    // Removing takes it out of the totals
    await page.goto(campaignUrl);
    await page.getByRole("row", { name: /Uploaded/ }).getByRole("button", { name: "Remove" }).click();
    await page.getByRole("alertdialog").or(page.getByRole("dialog")).getByRole("button", { name: "Remove" }).click();
    await expect(page.getByTestId("budget-line")).toContainText("₹8,500.00 of ₹10,000.00");
    expect((await page.request.get("/api/export/ads")).status()).toBe(200);
  });

  test("renewals: nearest first, colours, margin, renew, passwords refused", async ({ page }) => {
    const domain = `test${unique()}.in`;
    await login(page);
    await page.goto("/renewals");
    const rows = page.getByRole("row");
    await expect(rows.nth(1)).toBeVisible();
    await expect(page.getByText("Within 7 days")).toBeVisible();

    // Sample data has a domain with 1 day left, which sorts to the top
    await expect(rows.nth(1)).toContainText(/1 day left|Expires today|Expired/);

    await pick(page, "Expiry", "Within 7 days");
    await expect(page).toHaveURL(/within=7/);
    await page.getByRole("button", { name: "Clear" }).click();

    await page.getByRole("link", { name: "Add item" }).click();
    await expect(page).toHaveURL(/\/renewals\/new$/);
    await pick(page, "Client", "Vertex Industrial Supplies");
    await page.getByRole("textbox", { name: "Domain" }).fill("not a domain");
    await page.getByRole("textbox", { name: "Expiry date" }).fill(today());
    await page.getByRole("textbox", { name: /Our cost/ }).fill("799");
    await page.getByRole("textbox", { name: /Renewal price/ }).fill("1,200");
    await page.getByRole("textbox", { name: /Where the login details/ }).fill("password: abc123");
    await page.getByRole("button", { name: "Add item" }).click();
    await expect(page.getByText("Enter a domain like example.com")).toBeVisible();
    await expect(page.getByText(/Don't write passwords here/)).toBeVisible();

    await page.getByRole("textbox", { name: "Domain" }).fill(domain);
    await page.getByRole("textbox", { name: /Where the login details/ }).fill("Agency password manager");
    await page.getByRole("button", { name: "Add item" }).click();
    await expect(page).toHaveURL(/\/renewals\/[a-z0-9]{20,}$/);
    await expect(page.getByText("Expires today")).toBeVisible();
    await expect(page.getByTestId("asset-margin")).toContainText("₹401.00 (33.4%)");
    await expect(page.getByRole("button", { name: "Create renewal invoice" })).toBeEnabled();

    await page.getByRole("button", { name: "Mark renewed" }).click();
    await page.getByRole("button", { name: "Save new date" }).click();
    await expect(page.getByText("Expires today")).toHaveCount(0);
    await expect(page.getByText("Renewal history")).toBeVisible();

    expect((await page.request.get("/api/export/renewals")).status()).toBe(200);
  });

  test("permissions: employees get scoped content and no ads or renewals", async ({ page }) => {
    await login(page, "priya@rezonest.com", "Employee@123");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: /Content Calendar/ })).toBeVisible();
    await expect(nav.getByRole("link", { name: /^Ads/ })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: /Renewals/ })).toHaveCount(0);
    for (const path of ["/ads", "/ads/new", "/ads/import", "/renewals", "/renewals/new", "/content/new"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/dashboard/);
    }
    expect((await page.request.get("/api/export/ads")).status()).toBe(403);
    expect((await page.request.get("/api/export/renewals")).status()).toBe(403);

    await page.goto("/content");
    await expect(page.getByRole("link", { name: "Add content" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Send for approval" })).toHaveCount(0);
    await expect(page.getByText(/Choose a client above/)).toHaveCount(0);
  });

  test("the client tabs open the new pages, and the phone layout has no sideways scroll", async ({ page }) => {
    test.setTimeout(70_000);
    await login(page);
    await page.goto("/clients");
    const client = await page.getByRole("link", { name: "UrbanThreads Boutique" }).first().getAttribute("href");
    await page.goto(`${client}?tab=ads`);
    await expect(page.getByRole("link", { name: /Phase 2|Catalogue/ }).first()).toBeVisible();
    await page.goto(`${client}?tab=renewals`);
    await page.getByRole("link", { name: "urbanthreads.in" }).click();
    await expect(page).toHaveURL(/\/renewals\/[a-z0-9]{20,}$/);

    await page.setViewportSize({ width: 375, height: 760 });
    for (const path of ["/content", "/content?layout=list", "/content/new", "/ads", "/ads/new", "/ads/import", "/renewals", "/renewals/new"]) {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(1);
    }
  });
});
