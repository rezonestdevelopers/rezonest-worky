import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

/** Different on every run, so tests can repeat without tripping duplicate warnings. */
const unique = () => `${Date.now()}`.slice(-9);
// "new" and "import" are pages of their own, not a record.
const LEAD_PAGE = /\/leads\/(?!new$|import$)[a-z0-9]+$/;
const CLIENT_PAGE = /\/clients\/(?!new$|import$)[a-z0-9]+$/;
const phoneFrom = (seed: string) => `9${seed}`.padEnd(10, "0").slice(0, 10);

async function pick(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test.describe("Phase 2: leads", () => {
  test("create → duplicate warning → stage change → lost → reopen → convert to client", async ({ page }) => {
    const seed = unique();
    const name = `Test Person ${seed}`;
    const phone = phoneFrom(seed);
    await login(page);

    await page.goto("/leads/new");
    await page.getByRole("button", { name: "Create lead" }).click();
    await expect(page.getByText("Enter the contact person's name")).toBeVisible();

    await page.getByLabel("Contact person").fill(name);
    await page.getByLabel("Company").fill(`Test Co ${seed}`);
    await page.getByLabel("Phone").fill(phone);
    await page.getByLabel("Approximate budget").fill("25000");
    await page.getByRole("button", { name: "Meta Ads" }).click();
    await page.getByRole("button", { name: "Create lead" }).click();
    await expect(page).toHaveURL(LEAD_PAGE);
    const leadUrl = page.url();
    await expect(page.getByRole("heading", { name: `Test Co ${seed}` })).toBeVisible();
    await expect(page.getByText("₹25,000")).toBeVisible();

    // Same phone typed differently is caught
    await page.goto("/leads/new");
    await page.getByLabel("Contact person").fill("Someone Else");
    await page.getByLabel("Phone").fill(`+91 ${phone.slice(0, 5)} ${phone.slice(5)}`);
    await page.getByRole("button", { name: "Create lead" }).click();
    await expect(page.getByText("This may already exist")).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(`Test Co ${seed}`) })).toBeVisible();
    await page.getByRole("button", { name: "Go back" }).click();

    // Stage changes are recorded
    await page.goto(leadUrl);
    await pick(page, "Change stage", "Contacted");
    await expect(page.getByText("New → Contacted")).toBeVisible();

    // Lost needs a reason, and can be reopened
    await pick(page, "Change stage", "Lost");
    await page.getByRole("button", { name: "Mark as lost" }).click();
    await expect(page.getByText("Please enter the reason this lead was lost.")).toBeVisible();
    await page.getByLabel("Reason").fill("Budget too low");
    await page.getByRole("button", { name: "Mark as lost" }).click();
    await expect(page.getByText("Lost: Budget too low")).toBeVisible();
    await pick(page, "Change stage", "Contacted");
    await expect(page.getByText("Lost: Budget too low")).toHaveCount(0);

    // Convert: details are carried across, and GST is checked
    await page.getByRole("link", { name: "Convert to client" }).click();
    await expect(page.getByLabel("Company name")).toHaveValue(`Test Co ${seed}`);
    await expect(page.getByLabel("Main contact person")).toHaveValue(name);
    await page.getByLabel("GSTIN").fill("29AAFCV2231H1Z6");
    await page.getByRole("button", { name: "Convert to client" }).click();
    await expect(page.getByText(/doesn't match the selected state/)).toBeVisible();
    await page.getByLabel("GSTIN").fill("");
    await page.getByRole("button", { name: "Convert to client" }).click();

    await expect(page).toHaveURL(CLIENT_PAGE);
    await expect(page.getByRole("heading", { name: `Test Co ${seed}` })).toBeVisible();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await expect(page.getByText("Primary", { exact: true })).toBeVisible();

    await page.goto(leadUrl);
    await expect(page.getByRole("status").filter({ hasText: "Converted to client" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Convert to client" })).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Change stage" })).toHaveCount(0);
  });

  test("list: search by digits however typed, filter, sort, paging and Excel", async ({ page }) => {
    await login(page);
    await page.goto("/leads");
    await expect(page.getByText(/\d+ leads?/).first()).toBeVisible();

    await page.getByPlaceholder("Search name, company, phone…").fill("Moraya");
    await expect(page).toHaveURL(/q=Moraya/);
    await expect(page.getByRole("link", { name: "Yogesh Gawade" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Akash Thorat" })).toHaveCount(0);
    await page.getByRole("button", { name: "Clear" }).click();
    await expect(page).not.toHaveURL(/q=/);

    await pick(page, "Stage", "Lost");
    await expect(page).toHaveURL(/stage=LOST/);
    await expect(page.getByRole("link", { name: "Imran Shaikh" })).toBeVisible();
    await page.getByRole("button", { name: "Clear" }).click();
    await expect(page).not.toHaveURL(/stage=/);
    await expect(page.getByRole("link", { name: "Akash Thorat" })).toBeVisible();

    await page.getByRole("button", { name: "Contact", exact: true }).click();
    await expect(page).toHaveURL(/sort=contactName&dir=asc/);

    await pick(page, "Rows per page", "10 per page");
    await expect(page).toHaveURL(/size=10/);
    await expect(page.getByText("Page 1 of")).toBeVisible();
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page).toHaveURL(/page=2/);

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Excel" }).click()]);
    expect(download.suggestedFilename()).toMatch(/^leads-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  test("archive hides a lead and restore brings it back", async ({ page }) => {
    const seed = unique();
    await login(page);
    await page.goto("/leads/new");
    await page.getByLabel("Contact person").fill(`Archive Me ${seed}`);
    await page.getByLabel("Phone").fill(phoneFrom(seed));
    await page.getByRole("button", { name: "Create lead" }).click();
    await expect(page).toHaveURL(LEAD_PAGE);
    const url = page.url();

    await page.getByRole("button", { name: "Archive" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Archive" }).click();
    await expect(page.getByText(/This lead was archived/)).toBeVisible();

    await page.goto(`/leads?q=${encodeURIComponent(`Archive Me ${seed}`)}`);
    await expect(page.getByText("No leads match")).toBeVisible();

    await page.goto(url);
    await page.getByRole("button", { name: "Restore" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Restore" }).click();
    await expect(page.getByText(/This lead was archived/)).toHaveCount(0);
  });
});

test.describe("Phase 2: clients", () => {
  test("create, edit, add a contact, see it in the activity tab", async ({ page }) => {
    const seed = unique();
    const company = `New Client ${seed}`;
    await login(page);
    await page.goto("/clients/new");
    await page.getByLabel("Company name").fill(company);
    await page.getByLabel("Main contact person").fill("Meera Joshi");
    await page.getByLabel("Phone").fill(phoneFrom(seed));
    await pick(page, "State", "Karnataka (29)");
    await page.getByLabel("Website").fill("javascript:alert(1)");
    await page.getByRole("button", { name: "Create client" }).click();
    await expect(page).toHaveURL(CLIENT_PAGE);
    await expect(page.getByText("Karnataka (29)")).toBeVisible();
    // An unsafe website is shown as plain text, never as a clickable link
    await expect(page.getByRole("link", { name: "javascript:alert(1)" })).toHaveCount(0);

    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("dialog").getByLabel("Name").fill("Ravi Kumar");
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Ravi Kumar")).toBeVisible();

    await page.getByRole("link", { name: "Edit", exact: true }).click();
    await page.getByLabel("City").fill("Mysuru");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(CLIENT_PAGE);

    await page.getByRole("link", { name: "Activity" }).click();
    await expect(page.getByText(/city: — → Mysuru/)).toBeVisible();
    await expect(page.getByText("Client Contact Added")).toBeVisible();
  });

  test("all tabs open; a client who owes money can't be archived", async ({ page }) => {
    await login(page);
    await page.goto("/clients?q=BrightPath");
    await page.getByRole("link", { name: "BrightPath Coaching Academy" }).click();
    await expect(page).toHaveURL(CLIENT_PAGE);

    for (const [tab, expected] of [
      ["Offers", "Valid until"],
      ["Projects", "BrightPath – Admissions Campaign"],
      ["Tasks", "Assigned to"],
      ["Content Calendar", "Publish date"],
      ["Ads", "Client's budget"],
      ["Invoices", /REZ\/INV\//],
      ["Payments", "Amount received"],
      ["Reports", "Client reports arrive in Phase 9"],
      ["Communication Log", "Reminded about 2 pending invoices"],
    ] as const) {
      await page.getByRole("navigation", { name: "Client sections" }).getByRole("link", { name: tab, exact: true }).click();
      await expect(page.getByText(expected).first()).toBeVisible();
    }

    await page.getByRole("button", { name: "Archive" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Archive" }).click();
    await expect(page.getByText(/can't be archived yet/)).toBeVisible();
    await expect(page.getByText(/This client was archived/)).toHaveCount(0);
  });

  test("the dashboard opens real client and lead pages now", async ({ page }) => {
    await login(page);
    await page.getByRole("link", { name: "Kalyani Auto Components Pvt Ltd", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Kalyani Auto Components Pvt Ltd" })).toBeVisible();
  });

  test("Ctrl+K search opens the client page", async ({ page }) => {
    await login(page);
    await page.keyboard.press("Control+k");
    await page.getByPlaceholder(/Type a client/).fill("Pristine");
    await page.getByRole("option", { name: /Pristine Heights Realty LLP/ }).first().click();
    await expect(page.getByRole("heading", { name: "Pristine Heights Realty LLP" })).toBeVisible();
  });
});

test.describe("Phase 2: Excel import", () => {
  test("preview shows errors and duplicates; only approved rows are saved", async ({ page }) => {
    const seed = unique();
    const good = `Imported Good ${seed}`;
    const copy = `Imported Copy ${seed}`;
    const csv = [
      "Contact Person,Company,Mobile,Email,Lead Source,Next Follow-up,Shoe Size",
      `${good},Good Co,${phoneFrom(seed)},,Referral,15/12/2030,9`,
      `Sanjay Copy,${copy},+91 98230 11452,,,,`,
      `Bad Date ${seed},,${phoneFrom(`${seed}1`)},,,someday,`,
    ].join("\n");

    await login(page);
    await page.goto("/leads/import");
    await page.getByTestId("import-file").setInputFiles({ name: "leads.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });

    await expect(page.getByText("1 ready", { exact: true })).toBeVisible();
    await expect(page.getByText("1 possible duplicate", { exact: true })).toBeVisible();
    await expect(page.getByText("1 with errors", { exact: true })).toBeVisible();
    await expect(page.getByText(/Shoe Size/)).toBeVisible();
    await expect(page.getByText(/Same phone as/)).toBeVisible();
    await expect(page.getByText(/isn't a valid date/)).toBeVisible();

    await page.getByRole("button", { name: "Import 1 lead" }).click();
    await expect(page).toHaveURL(/\/leads$/);
    await expect(page.getByText(/1 imported, 1 duplicate skipped, 1 row with errors skipped/)).toBeVisible();

    await page.goto(`/leads?q=${seed}`);
    await expect(page.getByRole("link", { name: good })).toBeVisible();
    await expect(page.getByText(`Bad Date ${seed}`)).toHaveCount(0);
    await page.goto(`/leads?q=${encodeURIComponent(copy)}`);
    await expect(page.getByText("No leads match")).toBeVisible();
  });

  test("a wrong file gets a clear message, and templates download", async ({ page }) => {
    await login(page);
    await page.goto("/clients/import");
    await page.getByTestId("import-file").setInputFiles({ name: "x.csv", mimeType: "text/csv", buffer: Buffer.from("Colour,Size\nRed,9\n") });
    await expect(page.getByRole("alert").filter({ hasText: /No “Company” column/ })).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download template" }).click()]);
    expect(download.suggestedFilename()).toBe("rezonest-clients-import-template.xlsx");
  });
});

test.describe("Phase 2: service catalogue and lists", () => {
  test("create a service with a sub-service and a task template", async ({ page }) => {
    const seed = unique();
    const name = `Podcast ${seed}`;
    await login(page);
    await page.goto("/settings/services");
    await expect(page.getByRole("link", { name: "SEO Services" })).toBeVisible();

    await page.getByRole("link", { name: "New service" }).click();
    await page.getByLabel("Service name").fill(name);
    await page.getByLabel("Default price").fill("abc");
    await page.getByRole("button", { name: "Create service" }).click();
    await expect(page.getByText(/Enter an amount/)).toBeVisible();
    await page.getByLabel("Default price").fill("7500.50");
    await page.getByRole("button", { name: "Create service" }).click();
    await expect(page.getByRole("heading", { name })).toBeVisible();

    await page.getByRole("button", { name: "Add", exact: true }).nth(2).click();
    await page.getByLabel("Sub-service name").fill("Episode editing");
    await page.getByRole("button", { name: "Save sub-services" }).click();
    await expect(page.getByText("Sub-services saved.")).toBeVisible();

    await page.getByRole("button", { name: "New template" }).click();
    await page.getByLabel("Template name").fill("Episode");
    await page.getByLabel("Step 1 name").fill("Record");
    await page.getByRole("button", { name: "Add step" }).click();
    await page.getByLabel("Step 2 name").fill("Edit");
    await page.getByRole("button", { name: "Move step 2 up" }).click();
    await page.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByText("Template saved.")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Step 1 name")).toHaveValue("Edit");
    await expect(page.getByLabel("Step 2 name")).toHaveValue("Record");

    await page.goto("/settings/services");
    await expect(page.getByRole("row", { name: new RegExp(name) })).toContainText("₹7,501");
  });

  test("a sector can be added and switched off, and repeats are refused", async ({ page }) => {
    const seed = unique();
    const sector = `Sector ${seed}`;
    await login(page);
    await page.goto("/settings/lists");
    await page.getByLabel("Add to Sectors").fill(sector);
    await page.getByLabel("Add to Sectors").press("Enter");
    await expect(page.getByLabel(`Sectors: ${sector}`)).toBeVisible();

    await page.getByLabel("Add to Sectors").fill(sector);
    await page.getByLabel("Add to Sectors").press("Enter");
    await expect(page.getByText(/already in use/)).toBeVisible();

    await page.goto("/leads/new");
    await page.getByRole("combobox", { name: "Sector" }).click();
    await expect(page.getByRole("option", { name: sector })).toBeVisible();

    await page.goto("/settings/lists");
    await page.getByRole("switch", { name: `${sector} is active` }).click();
    await expect(page.getByText("Saved.").first()).toBeVisible();
    await page.goto("/leads/new");
    await page.getByRole("combobox", { name: "Sector" }).click();
    await expect(page.getByRole("option", { name: sector })).toHaveCount(0);
  });
});

test.describe("Phase 2: permissions", () => {
  test("an employee can't reach leads, clients, exports or settings", async ({ page, request }) => {
    await login(page, "priya@rezonest.com", "Employee@123");
    for (const path of ["/leads", "/leads/new", "/leads/import", "/clients", "/clients/new", "/settings/services", "/settings/lists"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/dashboard/);
    }
    for (const path of ["/api/export/leads", "/api/export/clients", "/api/import/template?kind=leads"]) {
      const res = await page.request.get(path);
      expect(res.status(), path).toBe(403);
    }
    // Nor when not signed in at all
    const anonymous = await request.get("/api/export/clients", { maxRedirects: 0 });
    expect([302, 303, 307, 403]).toContain(anonymous.status());
  });
});
