import { expect, test, type Browser, type Page } from "@playwright/test";
import { login } from "./helpers";

const INVOICE_PAGE = /\/invoices\/[a-z0-9]{20,}$/;
const PAYMENT_PAGE = /\/payments\/[a-z0-9]{20,}$/;
const unique = () => `${Date.now()}`.slice(-9);
const SAC = "998361";

async function pick(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function setGstin(page: Page, value: string) {
  await page.goto("/settings");
  await page.getByRole("tab", { name: /GST/ }).click();
  await page.getByLabel("GSTIN").fill(value);
  await page.getByLabel("UPI ID").fill(value ? "rezonest@okhdfcbank" : "");
  const save = page.getByRole("button", { name: "Save settings" });
  // Saving is only offered when something changed.
  if (await save.isEnabled()) {
    await save.click();
    await expect(page.getByText(/saved/i).first()).toBeVisible();
  }
}

async function newClient(page: Page, name: string, state = "Maharashtra (27)") {
  await page.goto("/clients/new");
  await page.getByLabel("Company name").fill(name);
  await page.getByLabel("Main contact person").fill("Meera Joshi");
  await page.getByLabel("Phone").fill(`98${unique().slice(-8)}`);
  await page.getByLabel(/^Email/).fill(`m${unique()}@example.com`);
  await pick(page, "State", state);
  await page.getByRole("button", { name: "Create client" }).click();
  await expect(page).toHaveURL(/\/clients\/[a-z0-9]{20,}/);
  return page.url().split("?")[0];
}

/** A new invoice's first line, ready to save. */
async function fillInvoice(page: Page, client: string, rate: string, sac = SAC) {
  await page.goto("/invoices/new");
  await pick(page, "Client", client);
  await page.getByLabel("Description").fill("Campaign work");
  await page.getByLabel("SAC code").fill(sac);
  await page.getByLabel("Rate (₹)").fill(rate);
}

async function saveAndIssue(page: Page) {
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(INVOICE_PAGE);
  await page.getByRole("button", { name: "Issue", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Issue invoice" }).click();
  await expect(page.getByRole("heading", { name: /^REZ\/INV\// })).toBeVisible();
}

async function acceptOffer(page: Page, browser: Browser, client: string, title: string, rate: string) {
  await page.goto("/offers/new");
  await pick(page, "Client", client);
  await page.getByLabel("Offer title").fill(title);
  await page.getByRole("button", { name: "Add item" }).click();
  await pick(page, "Item 1 service", "Web & Software Development");
  await page.getByLabel("Item 1 rate").fill(rate);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(/\/offers\/(?!new$|templates)[a-z0-9]+$/);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByRole("button", { name: "Share myself (WhatsApp)" }).click();
  const link = new URL(await page.getByTestId("client-link").inputValue()).pathname;
  await page.keyboard.press("Escape");
  const context = await browser.newContext();
  const visitor = await context.newPage();
  await visitor.goto(link);
  await visitor.getByRole("button", { name: "Accept this offer" }).click();
  await visitor.getByLabel("Your name").fill("Meera Joshi");
  await visitor.getByRole("checkbox").check();
  await visitor.getByRole("button", { name: "Confirm acceptance" }).click();
  await expect(visitor.getByText(/Accepted by Meera Joshi/)).toBeVisible();
  await context.close();
  await page.reload();
}

const outstanding = (page: Page) => page.locator('[data-slot="card"]', { hasText: "Total outstanding" }).first();

test.describe("Phase 7: invoices and payments", () => {

  test("a GST invoice is blocked until GSTIN and SAC are in; once issued it's locked", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page);
    await setGstin(page, "");
    const company = `Blocked ${unique()}`;
    await newClient(page, company);

    await fillInvoice(page, company, "1000", "");
    await expect(page.getByTestId("invoice-total")).toHaveText("₹1,180.00");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page).toHaveURL(INVOICE_PAGE);
    const problems = page.getByTestId("issue-problems");
    await expect(problems).toContainText("GSTIN");
    await expect(problems).toContainText("SAC code");
    await expect(page.getByRole("button", { name: "Issue", exact: true })).toHaveCount(0);
    const url = page.url();

    await setGstin(page, "27ABCDE1234F1Z5");
    await page.goto(url);
    await expect(page.getByTestId("issue-problems")).not.toContainText("GSTIN");
    await page.getByRole("link", { name: "Edit", exact: true }).click();
    await page.getByLabel("SAC code").fill(SAC);
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page).toHaveURL(url);
    await page.getByRole("button", { name: "Issue", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Issue invoice" }).click();
    await expect(page.getByRole("heading", { name: /^REZ\/INV\// })).toBeVisible();
    await expect(page.getByTestId("grand-total")).toHaveText("₹1,180.00");
    await expect(page.getByTestId("invoice-summary")).toContainText("CGST 9%");

    // Locked: no edit, and the edit address goes back to the invoice
    await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
    await page.goto(`${url}/edit`);
    await expect(page).toHaveURL(url);

    // The PDF opens
    const pdf = await page.request.get(`/api/invoices/${url.split("/").pop()}/pdf`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
  });

  test("another state pays IGST; line discounts and live totals match the saved invoice", async ({ page }) => {
    test.setTimeout(60_000);
    await login(page);
    const company = `Bengaluru ${unique()}`;
    await newClient(page, company, "Karnataka (29)");
    await fillInvoice(page, company, "10000");
    await page.getByLabel("Discount in").selectOption("PERCENT");
    await page.getByLabel("Discount", { exact: true }).fill("10");
    await expect(page.getByTestId("invoice-totals")).toContainText("IGST");
    await expect(page.getByTestId("invoice-total")).toHaveText("₹10,620.00");
    await saveAndIssue(page);
    await expect(page.getByTestId("grand-total")).toHaveText("₹10,620.00");
    await expect(page.getByTestId("invoice-summary")).toContainText("IGST 18%");
    await expect(page.getByText("Karnataka (29)").first()).toBeVisible();
  });

  test("full journey: new client → offer accepted → project → tasks done → invoice → payment → dashboard", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const id = unique();
    const company = `Journey ${id}`;
    await login(page);
    await setGstin(page, "27ABCDE1234F1Z5");
    await expect(outstanding(await page.goto("/dashboard").then(() => page))).toBeVisible();
    const before = await outstanding(page).innerText();

    const clientUrl = await newClient(page, company);
    await acceptOffer(page, browser, company, `Website ${id}`, "100000");

    await page.getByRole("link", { name: "Convert to project" }).click();
    await page.getByLabel("Milestone 1 due date").fill("2030-01-15");
    await page.getByLabel("Milestone 1 payment percent").fill("50");
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page).toHaveURL(/\/projects\/[a-z0-9]{20,}$/);
    const projectUrl = page.url();

    await page.goto(`${projectUrl}?tab=tasks`);
    const taskLink = page.getByRole("main").getByRole("listitem").getByRole("link").first();
    await taskLink.click();
    await expect(page).toHaveURL(/\/tasks\/[a-z0-9]{20,}$/);
    await page.getByRole("combobox", { name: /status/i }).first().click();
    await page.getByRole("option", { name: "Done", exact: true }).click();
    await expect(page.getByRole("combobox", { name: /status/i }).first()).toContainText("Done");

    // Invoice the first milestone: 50% of the work, GST on top
    await page.goto(`${projectUrl}?tab=milestones`);
    await expect(page.getByText(/₹50,000\.00 before GST/).first()).toBeVisible();
    await page.getByRole("button", { name: "Invoice", exact: true }).first().click();
    await expect(page).toHaveURL(INVOICE_PAGE);
    await expect(page.getByTestId("grand-total")).toHaveText("₹59,000.00");
    const draftUrl = page.url();

    // Service SAC is blank in the seed, so the draft says so and you fill it in
    await expect(page.getByTestId("issue-problems")).toContainText("SAC code");
    await page.getByRole("link", { name: "Edit", exact: true }).click();
    await page.getByLabel("SAC code").fill(SAC);
    await saveAndIssue(page);
    expect(page.url()).toBe(draftUrl);
    await expect(page.getByText("Unpaid").first()).toBeVisible();

    // The milestone now points at the invoice and can't be billed twice
    await page.goto(`${projectUrl}?tab=milestones`);
    await expect(page.getByRole("link", { name: /^REZ\/INV\// })).toBeVisible();

    // Part payment with TDS
    await page.goto(draftUrl);
    await page.getByRole("link", { name: "Record payment" }).click();
    await page.getByLabel(/Amount received/).fill("50000");
    await page.getByRole("button", { name: "Fill oldest first" }).click();
    await page.getByLabel("TDS (₹)").fill("5000");
    await page.getByLabel("TDS section").fill("194J");
    await page.getByLabel("Reference no.").fill(`UTR${id}`);
    await page.getByRole("button", { name: "Save payment" }).click();
    await expect(page).toHaveURL(PAYMENT_PAGE);

    await page.goto(draftUrl);
    await expect(page.getByText("Partially Paid").first()).toBeVisible();
    await expect(page.getByTestId("balance-due")).toHaveText("₹4,000.00");

    // Dashboard moved
    await page.goto("/dashboard");
    await expect(outstanding(page)).not.toHaveText(before);
    await expect(outstanding(page)).toBeVisible();

    // Client tabs and statement
    await page.goto(`${clientUrl}?tab=invoices`);
    await expect(page.getByRole("link", { name: /^REZ\/INV\// })).toBeVisible();
    await page.getByRole("link", { name: "Statement of account" }).click();
    await expect(page.getByTestId("closing-balance")).toHaveText("₹4,000.00");
    const statement = await page.request.get(page.url().replace("/clients/", "/api/clients/").split("?")[0]);
    expect(statement.headers()["content-type"]).toBe("application/pdf");

    // Finish paying
    await page.goto(draftUrl);
    await page.getByRole("link", { name: "Record payment" }).click();
    await page.getByLabel(/Amount received/).fill("4000");
    await page.getByRole("button", { name: "Fill oldest first" }).click();
    await page.getByRole("button", { name: "Save payment" }).click();
    await expect(page).toHaveURL(PAYMENT_PAGE);
    await page.goto(draftUrl);
    await expect(page.getByText("Paid", { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId("balance-due")).toHaveText("₹0.00");
  });

  test("an advance against a proforma prompts to convert, then pays the tax invoice", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page);
    const company = `Advance ${unique()}`;
    await newClient(page, company);
    await fillInvoice(page, company, "10000");
    await pick(page, "Type", "Proforma invoice");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page).toHaveURL(INVOICE_PAGE);
    await page.getByRole("button", { name: "Issue", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Issue invoice" }).click();
    await expect(page.getByRole("heading", { name: /^REZ\/PI\// })).toBeVisible();
    await expect(page.getByText(/not a tax invoice/)).toBeVisible();

    await page.getByRole("link", { name: "Record advance" }).click();
    await page.getByLabel(/Amount received/).fill("5000");
    await expect(page.getByTestId("advance-left")).toHaveText("₹5,000.00");
    await page.getByRole("button", { name: "Save payment" }).click();
    await expect(page).toHaveURL(PAYMENT_PAGE);
    await expect(page.getByTestId("payment-advance")).toHaveText("₹5,000.00");

    await expect(page.getByTestId("convert-prompt")).toContainText("confirm GST on advances");
    await page.getByRole("button", { name: "Convert and apply" }).click();
    await expect(page.getByRole("heading", { name: /^REZ\/INV\// })).toBeVisible();
    await expect(page.getByTestId("grand-total")).toHaveText("₹11,800.00");
    await expect(page.getByTestId("balance-due")).toHaveText("₹6,800.00");
    await expect(page.getByRole("link", { name: /From proforma REZ\/PI\// })).toBeVisible();
  });

  test("corrections: credit note, cancelling, voiding, removing a payment", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page);
    const company = `Fixes ${unique()}`;
    await newClient(page, company);
    await fillInvoice(page, company, "1000");
    await saveAndIssue(page);
    const url = page.url();

    // Credit note for part of it
    await page.getByRole("link", { name: "Credit note" }).click();
    await page.getByLabel("Reason").fill("Goodwill discount");
    await page.getByLabel(/Campaign work/).fill("100");
    await expect(page.getByTestId("credit-total")).toHaveText("₹118.00");
    await page.getByRole("button", { name: "Create credit note" }).click();
    await expect(page).toHaveURL(url);
    await expect(page.getByRole("link", { name: /^REZ\/CN\// })).toBeVisible();
    await expect(page.getByTestId("balance-due")).toHaveText("₹1,062.00");
    const cn = await page.getByRole("link", { name: /^REZ\/CN\// }).getAttribute("href");
    expect((await page.request.get(cn!)).headers()["content-type"]).toBe("application/pdf");

    // Payment, then void it: the balance comes back
    await page.getByRole("link", { name: "Record payment" }).click();
    await page.getByLabel(/Amount received/).fill("1062");
    await page.getByRole("button", { name: "Fill oldest first" }).click();
    await page.getByRole("button", { name: "Save payment" }).click();
    await expect(page).toHaveURL(PAYMENT_PAGE);
    await page.getByRole("button", { name: "Void payment" }).click();
    await page.getByLabel("Reason").fill("Cheque bounced");
    await page.getByRole("dialog").getByRole("button", { name: "Void payment" }).click();
    await expect(page.getByText("Voided: Cheque bounced")).toBeVisible();
    await page.goto(url);
    await expect(page.getByTestId("balance-due")).toHaveText("₹1,062.00");

    // A second invoice: pay, remove the payment (it becomes an advance), then cancel
    await fillInvoice(page, company, "500");
    await saveAndIssue(page);
    const second = page.url();
    await page.getByRole("link", { name: "Record payment" }).click();
    await page.getByLabel(/Amount received/).fill("590");
    await page.getByLabel("Applied (₹)").first().fill("590");
    await page.getByRole("button", { name: "Save payment" }).click();
    await expect(page).toHaveURL(PAYMENT_PAGE);
    const paymentUrl = page.url();

    await page.goto(second);
    await page.getByRole("button", { name: "Cancel invoice" }).click();
    await page.getByLabel("Reason").fill("Raised by mistake");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel invoice" }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Payments are applied");
    await page.keyboard.press("Escape");

    await page.goto(paymentUrl);
    await page.getByRole("button", { name: /^Remove from / }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
    await expect(page.getByTestId("payment-advance")).toHaveText("₹590.00");

    await page.goto(second);
    await page.getByRole("button", { name: "Cancel invoice" }).click();
    await page.getByLabel("Reason").fill("Raised by mistake");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel invoice" }).click();
    await expect(page.getByText("Cancelled: Raised by mistake")).toBeVisible();
    await expect(page.getByRole("heading", { name: /^REZ\/INV\// })).toBeVisible();
  });

  test("email and payment reminders go only when clicked", async ({ page }) => {
    test.setTimeout(60_000);
    await login(page);
    const company = `Reminder ${unique()}`;
    await newClient(page, company);
    await fillInvoice(page, company, "1000");
    await saveAndIssue(page);

    await page.getByRole("button", { name: "Email", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("Please find attached invoice");
    await page.getByRole("dialog").getByRole("button", { name: "Send email" }).click();
    await expect(page.getByText(/^Sent to /)).toBeVisible();

    await page.getByRole("button", { name: "Payment reminder" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Gentle reminder");
    await dialog.getByRole("button", { name: "firm" }).click();
    await expect(dialog).toContainText("Payment overdue");
    await dialog.getByRole("button", { name: "final" }).click();
    await expect(dialog).toContainText("Final reminder");
    await expect(dialog.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", /wa\.me\/.*text=/);
    await dialog.getByRole("button", { name: "Send email" }).click();
    await expect(page.getByText(/^Reminder sent to /)).toBeVisible();
  });

  test("renewal, lists, filters, exports and the ageing report", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page);

    await page.goto("/renewals?within=30");
    await page.getByRole("main").getByRole("link").filter({ hasText: /\.(in|com)/ }).first().click();
    await page.getByRole("button", { name: "Create renewal invoice" }).click();
    await expect(page).toHaveURL(INVOICE_PAGE);
    await expect(page.getByText(/renewal/i).first()).toBeVisible();

    await page.goto("/invoices?status=DRAFT");
    await expect(page.getByRole("main").getByRole("link", { name: "Draft" }).first()).toBeVisible();
    await page.goto("/invoices?payment=OVERDUE");
    await expect(page.getByText("Overdue").first()).toBeVisible();
    await page.goto("/invoices?q=REZ/INV&type=TAX");
    await expect(page.getByRole("link", { name: /^REZ\/INV\// }).first()).toBeVisible();

    await page.goto("/payments");
    await expect(page.getByRole("row").nth(1)).toBeVisible();

    await page.goto("/payments/ageing");
    await expect(page.getByTestId("ageing-total")).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "90+ days" })).toBeVisible();

    for (const path of ["/api/export/invoices", "/api/export/payments", "/api/export/ageing"]) {
      const res = await page.request.get(path);
      expect(res.status(), path).toBe(200);
      expect(res.headers()["content-type"]).toContain("spreadsheet");
    }
  });

  test("an employee can't see invoices, payments or their exports", async ({ page }) => {
    await login(page, "kunal@rezonest.com", "Employee@123");
    for (const path of ["/invoices", "/invoices/new", "/payments", "/payments/new", "/payments/ageing"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/dashboard/);
    }
    for (const path of ["/api/export/invoices", "/api/export/payments", "/api/export/ageing", "/api/invoices/x/pdf", "/api/credit-notes/x/pdf", "/api/clients/x/statement"]) {
      expect((await page.request.get(path)).status(), path).toBe(403);
    }
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 } });
    test("the money screens don't scroll sideways", async ({ page }) => {
      test.setTimeout(90_000);
      await login(page);
      const flat = async () => {
        await page.waitForLoadState("networkidle");
        expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), page.url()).toBe(false);
      };
      for (const path of ["/invoices", "/invoices/new", "/payments", "/payments/new", "/payments/ageing"]) {
        await page.goto(path);
        await flat();
      }
      await page.goto("/invoices?type=TAX&status=ISSUED");
      await page.getByRole("link", { name: /^REZ\/INV\// }).first().click();
      await expect(page).toHaveURL(INVOICE_PAGE);
      await flat();
      await page.goto("/payments");
      await page.getByRole("main").getByRole("table").getByRole("link").first().click();
      await expect(page).toHaveURL(PAYMENT_PAGE);
      await flat();
    });
  });
});
