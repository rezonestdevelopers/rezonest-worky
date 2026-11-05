import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { addDaysKey, keyToDate, monthKeyOf, shiftMonth, todayKey } from "@/lib/dates";
import { clientCreateSchema } from "@/lib/validators/client";
import { expenseSchema } from "@/lib/validators/expense";
import { invoiceSchema } from "@/lib/validators/invoice";
import { pruneBackups, runBackup, type BackupTools } from "@/server/services/backups";
import { createClient } from "@/server/services/clients";
import { EXPORT_TABLES, exportRows, exportTable } from "@/server/services/data-export";
import { saveExpense } from "@/server/services/expenses";
import { createCreditNote, issueInvoice, saveDraftInvoice } from "@/server/services/invoices";
import { agencyReportDoc, clientMonthlyDoc, clientReportDoc, gstReportDoc, saveReportNote } from "@/server/services/reports";

const db = new PrismaClient();
const TODAY = todayKey();
const MONTH = monthKeyOf(TODAY);
const SAC = "998361";
let actor: string;
let serviceId: string;

const makeClient = (stateCode = "27") => createClient(db, clientCreateSchema.parse({ companyName: `Client ${Math.random()}`, contactName: "Asha", country: "India", stateCode, status: "ACTIVE", email: `c${Math.random()}@x.in`, phone: `9${Math.floor(Math.random() * 1e9).toString().padStart(9, "0")}` }), actor);
const invoice = async (clientId: string, rate: string, over: Record<string, unknown> = {}) =>
  issueInvoice(db, (await saveDraftInvoice(db, null, invoiceSchema.parse({ clientId, projectId: "", type: "TAX", gstEnabled: true, invoiceDate: TODAY, dueDate: addDaysKey(TODAY, 15), terms: "", notes: "", items: [{ serviceId, description: "Work done", sacCode: SAC, quantity: "1", rate, gstRate: "18" }], ...over }), actor)).id, actor);
const section = (doc: { sections: { title: string; rows: unknown[][]; total?: unknown[] }[] }, title: string) => doc.sections.find((s) => s.title === title)!;

async function clean() {
  await db.backupRun.deleteMany();
  await db.notification.deleteMany();
  await db.clientReportNote.deleteMany();
  await db.invoiceRun.deleteMany();
  await db.paymentAllocation.deleteMany();
  await db.payment.deleteMany();
  await db.creditNote.deleteMany();
  await db.changeRequest.deleteMany();
  await db.invoiceItem.deleteMany();
  await db.invoice.updateMany({ data: { convertedFromId: null } });
  await db.invoice.deleteMany();
  await db.timeLog.deleteMany();
  await db.contentApproval.deleteMany();
  await db.contentCalendarItem.deleteMany();
  await db.task.deleteMany();
  await db.expense.deleteMany();
  await db.adSpendEntry.deleteMany();
  await db.adCampaign.deleteMany();
  await db.domainHostingAsset.deleteMany();
  await db.deliverable.deleteMany();
  await db.target.deleteMany();
}

beforeAll(async () => {
  await db.settings.upsert({ where: { id: "agency" }, update: { stateCode: "27", gstin: "27ABCDE1234F1Z5", agencyName: "Rezonest Test" }, create: { id: "agency", agencyName: "Rezonest Test", address: "Pune", stateCode: "27", gstin: "27ABCDE1234F1Z5" } });
  const user = await db.user.upsert({ where: { email: "phase9-tester@example.com" }, update: { isActive: true, role: "ADMIN" }, create: { name: "Tester", email: "phase9-tester@example.com", passwordHash: "x", role: "ADMIN" } });
  actor = user.id;
  const dept = (await db.department.upsert({ where: { name: "P9 Dept" }, update: {}, create: { name: "P9 Dept" } })).id;
  serviceId = (await db.service.upsert({ where: { slug: "p9-seo" }, update: {}, create: { name: "P9 SEO", slug: "p9-seo", billingType: "MONTHLY_RETAINER", departmentId: dept } })).id;
});

beforeEach(clean);

afterAll(async () => {
  await clean();
  await db.settings.update({ where: { id: "agency" }, data: { gstin: null } });
  await db.$disconnect();
});

describe("GST summary", () => {
  it("adds up output tax, takes off credit notes in their own month, and lists each one", async () => {
    const c = await makeClient("27");
    const other = await makeClient("29");
    const a = await invoice(c.id, "1000");
    await invoice(other.id, "2000");
    await invoice(c.id, "500", { gstEnabled: false });
    const item = await db.invoiceItem.findFirstOrThrow({ where: { invoiceId: a.id } });
    await createCreditNote(db, { invoiceId: a.id, date: TODAY, reason: "Discount", lines: [{ itemId: item.id, taxable: "100" }] }, actor);

    const doc = await gstReportDoc(db, { today: TODAY });
    const row = section(doc, "Output tax by month").rows.at(-1)!;
    // Month, invoices, taxable, CGST, SGST, IGST, credit taxable, credit tax, net tax, no-GST value
    expect(row.slice(1)).toEqual([2, "3000.00", "90.00", "90.00", "360.00", "100.00", "18.00", "522.00", "500.00"]);
    expect(section(doc, "Tax invoices").rows).toHaveLength(3);
    expect(section(doc, "Credit notes").rows).toHaveLength(1);
    expect(section(doc, "By SAC code and rate").rows).toEqual([[SAC, 18, "3000.00", "540.00"]]);
  });
  it("leaves out proformas, drafts and cancelled invoices", async () => {
    const c = await makeClient();
    await invoice(c.id, "1000", { type: "PROFORMA" });
    await saveDraftInvoice(db, null, invoiceSchema.parse({ clientId: c.id, projectId: "", type: "TAX", gstEnabled: true, invoiceDate: TODAY, dueDate: TODAY, terms: "", notes: "", items: [{ description: "Draft", sacCode: SAC, quantity: "1", rate: "99", gstRate: "18" }] }), actor);
    const gone = await invoice(c.id, "777");
    await db.invoice.update({ where: { id: gone.id }, data: { status: "CANCELLED" } });
    const doc = await gstReportDoc(db, { today: TODAY });
    expect(section(doc, "Tax invoices").rows).toHaveLength(0);
    expect(section(doc, "Output tax by month").total![2]).toBe("0.00");
  });
});

describe("the client's monthly report never shows what it shouldn't", () => {
  it("has no fee, cost, budget or team name in it anywhere", async () => {
    const c = await makeClient();
    const person = await db.user.upsert({ where: { email: "p9-worker@example.com" }, update: { name: "Secret Worker" }, create: { name: "Secret Worker", email: "p9-worker@example.com", passwordHash: "x", role: "EMPLOYEE" } });
    await db.employeeProfile.upsert({ where: { userId: person.id }, update: { hourlyCost: "6161" }, create: { userId: person.id, hourlyCost: "6161" } });
    const project = await db.project.create({
      data: { code: `P9-${Math.random()}`, name: "Secret Project", clientId: c.id, startDate: keyToDate(TODAY), managerId: person.id, services: { create: { serviceId, billingType: "MONTHLY_RETAINER", rate: "71717", monthlyValue: "71717", gstRate: "18" } } },
    });
    await db.task.create({ data: { title: "Hidden task title", clientId: c.id, projectId: project.id, assigneeId: person.id } });
    await db.deliverable.create({ data: { projectId: project.id, title: "Reel one", format: "REEL", month: MONTH, deliveredAt: new Date() } });
    const target = await db.target.create({ data: { projectId: project.id, metric: "Leads", unit: "count", targetValue: "100" } });
    await db.targetProgress.create({ data: { targetId: target.id, month: MONTH, actualValue: "80" } });
    const campaign = await db.adCampaign.create({ data: { clientId: c.id, name: "Diwali", startDate: keyToDate(TODAY), plannedBudget: "92929" } });
    await db.adSpendEntry.create({ data: { campaignId: campaign.id, periodStart: keyToDate(`${MONTH}-01`), periodEnd: keyToDate(`${MONTH}-02`), spend: "5000", impressions: 1000, clicks: 50, leads: 10, conversionValue: "20000" } });
    await invoice(c.id, "71717");
    await saveExpense(db, null, expenseSchema.parse({ date: TODAY, category: "FREELANCER", description: "Hidden cost", vendor: "Hidden vendor", amount: "83838", gstPaid: "", clientId: c.id, projectId: "" }), actor);
    await saveReportNote(db, { clientId: c.id, month: MONTH, highlights: "Lovely month", nextPlan: "More of the same" }, actor);

    const doc = await clientMonthlyDoc(db, { clientId: c.id, month: MONTH });
    const text = JSON.stringify(doc);
    for (const secret of ["71717", "6161", "92929", "83838", "84626", "Secret Worker", "Hidden", "Secret Project", "p9-worker", "grandTotal", "rate"]) expect(text).not.toContain(secret);

    expect(text).toContain("Lovely month");
    expect(section(doc, "Deliverables").rows).toEqual([["Reels", 1, 1]]);
    expect(section(doc, "KPIs").rows).toEqual([["Leads", "100", "80", 80]]);
    const ads = section(doc, "Ads results").rows[0];
    expect(ads.slice(0, 2)).toEqual(["Diwali", "5000.00"]);
    expect(ads.slice(5)).toEqual([10, "500.00", "4x"]);
  });

  it("only shows that month, and that client", async () => {
    const [a, b] = [await makeClient(), await makeClient()];
    const project = await db.project.create({ data: { code: `P9-${Math.random()}`, name: "P", clientId: a.id, startDate: keyToDate(TODAY) } });
    await db.deliverable.create({ data: { projectId: project.id, title: "Now", format: "REEL", month: MONTH } });
    await db.deliverable.create({ data: { projectId: project.id, title: "Before", format: "STATIC_POST", month: shiftMonth(MONTH, -1) } });
    expect(section(await clientMonthlyDoc(db, { clientId: a.id, month: MONTH }), "Deliverables").rows).toEqual([["Reels", 1, 0]]);
    expect(section(await clientMonthlyDoc(db, { clientId: b.id, month: MONTH }), "Deliverables").rows).toEqual([]);
  });

  it("words are saved per client and month, and can be changed", async () => {
    const c = await makeClient();
    await saveReportNote(db, { clientId: c.id, month: MONTH, highlights: "First", nextPlan: null }, actor);
    await saveReportNote(db, { clientId: c.id, month: MONTH, highlights: "Second", nextPlan: "Plan" }, actor);
    expect(await db.clientReportNote.count({ where: { clientId: c.id } })).toBe(1);
    expect(JSON.stringify(await clientMonthlyDoc(db, { clientId: c.id, month: MONTH }))).toContain("Second");
    expect(JSON.stringify(await clientMonthlyDoc(db, { clientId: c.id, month: shiftMonth(MONTH, -1) }))).not.toContain("Second");
    await expect(saveReportNote(db, { clientId: "nobody", month: MONTH, highlights: "x", nextPlan: null }, actor)).rejects.toThrow(/no longer exists/);
  });
});

describe("internal client report", () => {
  it("includes money, profit and the team, and only this client's", async () => {
    const [c, other] = [await makeClient(), await makeClient()];
    await invoice(c.id, "1000");
    await invoice(other.id, "5555");
    await saveExpense(db, null, expenseSchema.parse({ date: TODAY, category: "TRAVEL", description: "Visit", vendor: "", amount: "200", gstPaid: "", clientId: c.id, projectId: "" }), actor);
    const doc = await clientReportDoc(db, { clientId: c.id, from: addDaysKey(TODAY, -5), to: TODAY, today: TODAY });
    expect(section(doc, "Invoices").rows).toHaveLength(1);
    expect(section(doc, "Expenses").rows[0][4]).toBe("200.00");
    expect(section(doc, "Profit").rows[0].slice(0, 4)).toEqual(["1000.00", "200.00", "0.00", "800.00"]);
    expect(JSON.stringify(doc)).not.toContain("5555");
  });
  it("respects the dates", async () => {
    const c = await makeClient();
    await invoice(c.id, "1000", { invoiceDate: addDaysKey(TODAY, -40), dueDate: addDaysKey(TODAY, -30) });
    const doc = await clientReportDoc(db, { clientId: c.id, from: addDaysKey(TODAY, -5), to: TODAY, today: TODAY });
    expect(section(doc, "Invoices").rows).toHaveLength(0);
    expect(doc.summary?.find((s) => s.label === "Outstanding today")?.value).toBe("₹1,180.00");
  });
  it("refuses a client that doesn't exist", async () => {
    await expect(clientReportDoc(db, { clientId: "nobody", from: TODAY, to: TODAY, today: TODAY })).rejects.toThrow(/no longer exists/);
  });
});

describe("agency report", () => {
  it("adds revenue by month and service, after credit notes, and shows ageing and profit", async () => {
    const c = await makeClient();
    const a = await invoice(c.id, "1000");
    await invoice(c.id, "2000", { invoiceDate: addDaysKey(TODAY, -3), dueDate: addDaysKey(TODAY, -1) });
    const item = await db.invoiceItem.findFirstOrThrow({ where: { invoiceId: a.id } });
    await createCreditNote(db, { invoiceId: a.id, date: TODAY, reason: "Discount", lines: [{ itemId: item.id, taxable: "100" }] }, actor);
    const doc = await agencyReportDoc(db, { from: addDaysKey(TODAY, -10), to: TODAY, today: TODAY });
    expect(doc.summary?.[0].value).toBe("₹2,900.00");
    expect(section(doc, "Revenue by service").rows).toEqual([["P9 SEO", "2900.00", 100]]);
    expect(section(doc, "Revenue by month").total).toEqual(["Total", "2900.00"]);
    const ageing = section(doc, "Outstanding and ageing");
    expect(ageing.rows.find((r) => r[0] === c.companyName)?.slice(1, 3)).toEqual(["1062.00", "2360.00"]);
    expect(section(doc, "Profit by client").rows.find((r) => r[0] === c.companyName)?.[4]).toBe("2900.00");
    expect(doc.sections.map((s) => s.title)).toEqual(expect.arrayContaining(["Revenue by sector", "Revenue by lead source", "Offer conversion", "MRR trend", "Team workload and on-time delivery", "Renewals calendar", "Profit by service"]));
  });
  it("an empty period says so rather than failing", async () => {
    const doc = await agencyReportDoc(db, { from: "2001-01-01", to: "2001-01-31", today: TODAY });
    expect(doc.summary?.[0].value).toBe("₹0.00");
    expect(section(doc, "Revenue by month").rows).toEqual([]);
  });
});

describe("data export", () => {
  it("never includes password hashes", async () => {
    const rows = (await exportRows(db, "user"))!;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => "passwordHash" in r)).toBe(false);
    expect(JSON.stringify(rows)).not.toContain("passwordHash");
  });
  it("won't export secrets or anything not on its list", async () => {
    for (const secret of ["passwordResetToken", "publicLink", "backupRun", "digestRun", "$queryRaw", "__proto__"]) {
      expect(exportTable(secret)).toBeUndefined();
      expect(await exportRows(db, secret)).toBeNull();
    }
  });
  it("every listed table really downloads", async () => {
    for (const t of EXPORT_TABLES) expect(Array.isArray(await exportRows(db, t.key)), t.key).toBe(true);
  });
  it("keeps money exact, as text", async () => {
    const c = await makeClient();
    await invoice(c.id, "1000.55");
    const rows = (await exportRows(db, "invoice"))!;
    expect(rows[0].taxableTotal).toBe("1000.55");
    expect(typeof rows[0].createdAt).toBe("string");
  });
});

describe("backups", () => {
  const tools = (over: Partial<BackupTools> = {}) => {
    const stored = new Map<string, Buffer>();
    const removed: string[] = [];
    let dumps = 0;
    const t: BackupTools = {
      dump: async () => {
        dumps++;
        return Buffer.from("backup");
      },
      put: async (k, b) => {
        stored.set(k, b);
      },
      remove: async (k) => {
        removed.push(k);
        stored.delete(k);
      },
      ...over,
    };
    return { t, stored, removed, dumps: () => dumps };
  };

  it("makes one a day, however often it runs", async () => {
    const b = tools();
    expect((await runBackup(db, b.t, TODAY)).status).toBe("done");
    expect((await runBackup(db, b.t, TODAY)).status).toBe("skipped");
    expect(b.dumps()).toBe(1);
    const run = await db.backupRun.findUniqueOrThrow({ where: { day: TODAY } });
    expect([run.status, run.sizeBytes]).toEqual(["DONE", 6]);
    expect(b.stored.has(run.storageKey!)).toBe(true);
  });
  it("two at the same moment still make one", async () => {
    const b = tools();
    const results = await Promise.all([runBackup(db, b.t, TODAY), runBackup(db, b.t, TODAY), runBackup(db, b.t, TODAY)]);
    expect(results.filter((r) => r.status === "done")).toHaveLength(1);
    expect(b.dumps()).toBe(1);
  });
  it("its file name can't be guessed from the date", async () => {
    await runBackup(db, tools().t, TODAY);
    const run = await db.backupRun.findUniqueOrThrow({ where: { day: TODAY } });
    expect(run.storageKey).toMatch(new RegExp(`^private/backups/${TODAY}-[0-9a-f]{24}\\.dump$`));
  });
  it("a failure is recorded, tells you, and the next run tries again", async () => {
    const bad = tools({ dump: async () => { throw new Error("no connection"); } });
    const result = await runBackup(db, bad.t, TODAY);
    expect(result).toEqual({ status: "failed", error: "no connection" });
    expect((await db.backupRun.findUniqueOrThrow({ where: { day: TODAY } })).status).toBe("FAILED");
    expect(await db.notification.count({ where: { userId: actor, title: "Today's backup failed" } })).toBe(1);
    expect((await runBackup(db, tools().t, TODAY)).status).toBe("done");
    const run = await db.backupRun.findUniqueOrThrow({ where: { day: TODAY } });
    expect([run.status, run.error]).toEqual(["DONE", null]);
  });
  it("an empty file counts as a failure", async () => {
    expect((await runBackup(db, tools({ dump: async () => Buffer.alloc(0) }).t, TODAY)).status).toBe("failed");
  });
  it("one that's stuck running can be retried later, but not straight away", async () => {
    await db.backupRun.create({ data: { day: TODAY, status: "RUNNING" } });
    expect((await runBackup(db, tools().t, TODAY)).status).toBe("skipped");
    expect((await runBackup(db, tools().t, TODAY, new Date(Date.now() + 31 * 60_000))).status).toBe("done");
  });

  const old = (daysAgo: number, status = "DONE") => db.backupRun.create({ data: { day: addDaysKey(TODAY, -daysAgo), status, storageKey: `private/backups/old-${daysAgo}.dump` } });

  it("keeps 30 days, and marks what it removes", async () => {
    await old(29);
    await old(30);
    await old(45);
    const b = tools();
    expect(await pruneBackups(db, b.t, TODAY)).toBe(2);
    expect(b.removed.sort()).toEqual(["private/backups/old-30.dump", "private/backups/old-45.dump"]);
    expect((await db.backupRun.findUniqueOrThrow({ where: { day: addDaysKey(TODAY, -29) } })).deletedAt).toBeNull();
    expect((await db.backupRun.findUniqueOrThrow({ where: { day: addDaysKey(TODAY, -45) } })).deletedAt).not.toBeNull();
    expect(await pruneBackups(db, b.t, TODAY)).toBe(0);
  });
  it("a failed backup never removes old ones", async () => {
    await old(60);
    const bad = tools({ dump: async () => { throw new Error("down"); } });
    await runBackup(db, bad.t, TODAY);
    expect(bad.removed).toEqual([]);
    expect((await db.backupRun.findUniqueOrThrow({ where: { day: addDaysKey(TODAY, -60) } })).deletedAt).toBeNull();
    const good = tools();
    await runBackup(db, good.t, TODAY);
    expect(good.removed).toEqual(["private/backups/old-60.dump"]);
  });
});
