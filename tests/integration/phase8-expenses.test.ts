import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { addDaysKey, keyToDate, monthKeyOf, shiftMonth, todayKey } from "@/lib/dates";
import { clientCreateSchema } from "@/lib/validators/client";
import { communicationSchema, expenseSchema } from "@/lib/validators/expense";
import { invoiceSchema } from "@/lib/validators/invoice";
import { createClient } from "@/server/services/clients";
import { addClientDocument, archiveClientDocument, archiveCommunication, attachBill, saveCommunication, saveExpense, setExpenseArchived } from "@/server/services/expenses";
import { createCreditNote, issueInvoice, saveDraftInvoice } from "@/server/services/invoices";
import { monthlyReport, profitFor, profitReport } from "@/server/services/profit";
import { syncReminders } from "@/server/services/reminders";

const db = new PrismaClient();
const TODAY = todayKey();
const SAC = "998361";
let actor: string;

const makeClient = () => createClient(db, clientCreateSchema.parse({ companyName: `Client ${Math.random()}`, contactName: "Asha", country: "India", stateCode: "27", status: "ACTIVE", email: `c${Math.random()}@x.in`, phone: `9${Math.floor(Math.random() * 1e9).toString().padStart(9, "0")}` }), actor);
const makeProject = (clientId: string) => db.project.create({ data: { code: `P8-${Math.random()}`, name: "Project", clientId, startDate: keyToDate(TODAY) } });
const expense = (over: Record<string, unknown> = {}) => expenseSchema.parse({ date: TODAY, category: "FREELANCER", description: "Editor", vendor: "", amount: "1000", gstPaid: "", clientId: "", projectId: "", ...over });
const comm = (over: Record<string, unknown>) => communicationSchema.parse({ clientId: "", leadId: "", type: "CALL", date: TODAY, summary: "Spoke about the plan", nextAction: "", nextActionDate: "", ...over });
const invoice = async (clientId: string, projectId: string | null, rate: string, date = TODAY) =>
  issueInvoice(db, (await saveDraftInvoice(db, null, invoiceSchema.parse({ clientId, projectId: projectId ?? "", type: "TAX", gstEnabled: true, invoiceDate: date, dueDate: addDaysKey(date, 15), terms: "", notes: "", items: [{ description: "Work done", sacCode: SAC, quantity: "1", rate, gstRate: "18" }] }), actor)).id, actor);
const file = (name = "a.pdf") => ({ name, storageKey: `private/documents/${Math.random()}.pdf`, mimeType: "application/pdf", sizeBytes: 100 });

async function clean() {
  await db.reminder.deleteMany();
  await db.invoiceRun.deleteMany();
  await db.paymentAllocation.deleteMany();
  await db.payment.deleteMany();
  await db.creditNote.deleteMany();
  await db.changeRequest.deleteMany();
  await db.invoiceItem.deleteMany();
  await db.invoice.updateMany({ data: { convertedFromId: null } });
  await db.invoice.deleteMany();
  await db.timeLog.deleteMany();
  await db.task.deleteMany();
  await db.expense.deleteMany();
  await db.communicationLog.deleteMany();
  await db.document.deleteMany();
}

beforeAll(async () => {
  await db.settings.upsert({ where: { id: "agency" }, update: { stateCode: "27", gstin: "27ABCDE1234F1Z5" }, create: { id: "agency", agencyName: "Test", address: "Pune", stateCode: "27", gstin: "27ABCDE1234F1Z5" } });
  const user = await db.user.upsert({ where: { email: "phase8-tester@example.com" }, update: { isActive: true, role: "ADMIN" }, create: { name: "Tester", email: "phase8-tester@example.com", passwordHash: "x", role: "ADMIN" } });
  actor = user.id;
  await db.employeeProfile.upsert({ where: { userId: actor }, update: { hourlyCost: "600" }, create: { userId: actor, hourlyCost: "600" } });
});

beforeEach(clean);

afterAll(async () => {
  await clean();
  await db.employeeProfile.deleteMany({ where: { userId: actor } });
  await db.settings.update({ where: { id: "agency" }, data: { gstin: null } });
  await db.$disconnect();
});

describe("expenses", () => {
  it("saves with GST kept apart, and logs who did it", async () => {
    const e = await saveExpense(db, null, expense({ amount: "1000.50", gstPaid: "180.09" }), actor);
    expect([e.amount.toString(), e.gstPaid.toString(), e.clientId]).toEqual(["1000.5", "180.09", null]);
    expect(await db.activityLog.count({ where: { entityId: e.id, action: "expense.created", actorId: actor } })).toBe(1);
  });
  it("a project decides the client; a mismatch is refused", async () => {
    const [a, b] = [await makeClient(), await makeClient()];
    const p = await makeProject(a.id);
    expect((await saveExpense(db, null, expense({ projectId: p.id }), actor)).clientId).toBe(a.id);
    await expect(saveExpense(db, null, expense({ clientId: b.id, projectId: p.id }), actor)).rejects.toThrow(/different client/);
  });
  it("refuses a future date", async () => {
    await expect(saveExpense(db, null, expense({ date: addDaysKey(TODAY, 1) }), actor)).rejects.toThrow(/future/);
  });
  it("editing records what changed", async () => {
    const e = await saveExpense(db, null, expense(), actor);
    await saveExpense(db, e.id, expense({ amount: "2000" }), actor);
    const log = await db.activityLog.findFirstOrThrow({ where: { entityId: e.id, action: "expense.updated" } });
    expect(log.changes).toMatchObject({ amount: { from: "1000", to: "2000" } });
  });
  it("archiving stops it counting, and restoring brings it back", async () => {
    const c = await makeClient();
    const e = await saveExpense(db, null, expense({ clientId: c.id, amount: "700" }), actor);
    const expenses = async () => (await profitFor(db, { from: null, to: TODAY, clientId: c.id })).expenses.toString();
    expect(await expenses()).toBe("700");
    await setExpenseArchived(db, e.id, true, actor);
    expect(await expenses()).toBe("0");
    expect(await db.expense.count({ where: { id: e.id } })).toBe(1);
    await setExpenseArchived(db, e.id, false, actor);
    expect(await expenses()).toBe("700");
  });
  it("replacing a bill keeps the old file on record", async () => {
    const e = await saveExpense(db, null, expense(), actor);
    await attachBill(db, { expenseId: e.id, ...file("one.pdf"), actorId: actor });
    await attachBill(db, { expenseId: e.id, ...file("two.pdf"), actorId: actor });
    const row = await db.expense.findUniqueOrThrow({ where: { id: e.id } });
    const docs = await db.document.findMany({ orderBy: { createdAt: "asc" } });
    expect(docs.map((d) => [d.name, d.category, !!d.archivedAt])).toEqual([["one.pdf", "BILL", true], ["two.pdf", "BILL", false]]);
    expect(row.billDocId).toBe(docs[1].id);
  });
});

describe("profit", () => {
  it("is revenue before GST, less expenses and team time, for client and project", async () => {
    const c = await makeClient();
    const p = await makeProject(c.id);
    const inv = await invoice(c.id, p.id, "10000");
    await invoice(c.id, null, "2000");
    const item = await db.invoiceItem.findFirstOrThrow({ where: { invoiceId: inv.id } });
    await createCreditNote(db, { invoiceId: inv.id, date: TODAY, reason: "Discount", lines: [{ itemId: item.id, taxable: "1000" }] }, actor);
    await saveExpense(db, null, expense({ projectId: p.id, amount: "3000", gstPaid: "540" }), actor);
    await saveExpense(db, null, expense({ clientId: c.id, amount: "500" }), actor);
    const task = await db.task.create({ data: { title: "Work", clientId: c.id, projectId: p.id } });
    await db.timeLog.create({ data: { taskId: task.id, userId: actor, date: keyToDate(TODAY), minutes: 90 } });

    const client = await profitFor(db, { from: null, to: TODAY, clientId: c.id });
    expect([client.revenue, client.expenses, client.time, client.profit].map(String)).toEqual(["11000", "3500", "900", "6600"]);
    const project = await profitFor(db, { from: null, to: TODAY, projectId: p.id });
    expect([project.revenue, project.expenses, project.time, project.profit].map(String)).toEqual(["9000", "3000", "900", "5100"]);

    const report = await profitReport(db, null, TODAY);
    expect(report.clients.find((r) => r.id === c.id)!.profit.toString()).toBe("6600");
    expect(report.projects.find((r) => r.id === p.id)!.profit.toString()).toBe("5100");
  });

  it("leaves out proformas, drafts and cancelled invoices", async () => {
    const c = await makeClient();
    const draftRow = invoiceSchema.parse({ clientId: c.id, projectId: "", type: "PROFORMA", gstEnabled: true, invoiceDate: TODAY, dueDate: TODAY, terms: "", notes: "", items: [{ description: "Advance", sacCode: SAC, quantity: "1", rate: "5000", gstRate: "18" }] });
    await saveDraftInvoice(db, null, draftRow, actor);
    await issueInvoice(db, (await saveDraftInvoice(db, null, draftRow, actor)).id, actor);
    const gone = await invoice(c.id, null, "999");
    await db.invoice.update({ where: { id: gone.id }, data: { status: "CANCELLED" } });
    expect((await profitFor(db, { from: null, to: TODAY, clientId: c.id })).revenue.toString()).toBe("0");
  });

  it("only counts what falls in the period", async () => {
    const c = await makeClient();
    const old = addDaysKey(TODAY, -40);
    await invoice(c.id, null, "1000", old);
    await invoice(c.id, null, "2000");
    await saveExpense(db, null, expense({ clientId: c.id, amount: "300", date: old }), actor);
    const recent = await profitFor(db, { from: addDaysKey(TODAY, -10), to: TODAY, clientId: c.id });
    expect([recent.revenue, recent.expenses].map(String)).toEqual(["2000", "0"]);
    const earlier = await profitFor(db, { from: addDaysKey(TODAY, -60), to: addDaysKey(TODAY, -20), clientId: c.id });
    expect([earlier.revenue, earlier.expenses].map(String)).toEqual(["1000", "300"]);
  });

  it("overheads aren't charged to anyone, but count in the agency's month", async () => {
    const c = await makeClient();
    await invoice(c.id, null, "1000");
    await saveExpense(db, null, expense({ amount: "400" }), actor);
    const report = await profitReport(db, null, TODAY);
    expect(report.overheads.toString()).toBe("400");
    expect(report.clients.find((r) => r.id === c.id)!.expenses.toString()).toBe("0");
    const month = monthKeyOf(TODAY);
    const rows = await monthlyReport(db, [shiftMonth(month, -1), month]);
    const now = rows.find((r) => r.month === month)!;
    expect([now.revenue, now.expenses, now.net].map(String)).toEqual(["1000", "400", "600"]);
  });
});

describe("documents", () => {
  it("a manager can't add a bill or invoice, or archive one", async () => {
    const c = await makeClient();
    await expect(addClientDocument(db, { clientId: c.id, category: "BILL", ...file(), actorId: actor, canSeeMoney: false })).rejects.toThrow(/Only an admin/);
    const doc = await addClientDocument(db, { clientId: c.id, category: "INVOICE", ...file(), actorId: actor, canSeeMoney: true });
    await expect(archiveClientDocument(db, doc.id, actor, false)).rejects.toThrow(/no longer exists/);
    expect((await db.document.findUniqueOrThrow({ where: { id: doc.id } })).archivedAt).toBeNull();
  });
  it("an archived client can't take new documents", async () => {
    const c = await makeClient();
    await db.client.update({ where: { id: c.id }, data: { archivedAt: new Date() } });
    await expect(addClientDocument(db, { clientId: c.id, category: "NDA", ...file(), actorId: actor, canSeeMoney: true })).rejects.toThrow(/archived/);
  });
  it("archiving hides it but keeps the record", async () => {
    const c = await makeClient();
    const doc = await addClientDocument(db, { clientId: c.id, category: "NDA", ...file(), actorId: actor, canSeeMoney: false });
    await archiveClientDocument(db, doc.id, actor, false);
    expect((await db.document.findUniqueOrThrow({ where: { id: doc.id } })).archivedAt).not.toBeNull();
    await expect(archiveClientDocument(db, doc.id, actor, false)).rejects.toThrow(/no longer exists/);
  });
  it("files that belong to a task or an expense stay with them", async () => {
    const c = await makeClient();
    const task = await db.task.create({ data: { title: "Work", clientId: c.id } });
    const onTask = await db.document.create({ data: { ...file(), category: "CREATIVE", clientId: c.id, taskId: task.id } });
    await expect(archiveClientDocument(db, onTask.id, actor, true)).rejects.toThrow(/task/);
    const e = await saveExpense(db, null, expense({ clientId: c.id }), actor);
    await attachBill(db, { expenseId: e.id, ...file("bill.pdf"), actorId: actor });
    const bill = await db.document.findFirstOrThrow({ where: { category: "BILL" } });
    await expect(archiveClientDocument(db, bill.id, actor, true)).rejects.toThrow(/bill for an expense/);
  });
});

describe("communication log", () => {
  it("a next action becomes a reminder on its date, once", async () => {
    const c = await makeClient();
    const row = await saveCommunication(db, null, comm({ clientId: c.id, nextAction: "Send the quote", nextActionDate: TODAY }), actor);
    await syncReminders(db, TODAY);
    await syncReminders(db, TODAY);
    const reminders = await db.reminder.findMany({ where: { dedupeKey: `COMMUNICATION_NEXT_ACTION:${row.id}` } });
    expect(reminders).toHaveLength(1);
    expect(reminders[0].title).toBe("Send the quote");
  });
  it("no reminder until the day comes", async () => {
    const c = await makeClient();
    const row = await saveCommunication(db, null, comm({ clientId: c.id, nextAction: "Later", nextActionDate: addDaysKey(TODAY, 5) }), actor);
    await syncReminders(db, TODAY);
    expect(await db.reminder.count({ where: { dedupeKey: `COMMUNICATION_NEXT_ACTION:${row.id}` } })).toBe(0);
  });
  it("archiving stops its reminder", async () => {
    const c = await makeClient();
    const row = await saveCommunication(db, null, comm({ clientId: c.id, nextAction: "Call back", nextActionDate: TODAY }), actor);
    await syncReminders(db, TODAY);
    await archiveCommunication(db, row.id, actor);
    await syncReminders(db, TODAY);
    const reminder = await db.reminder.findUniqueOrThrow({ where: { dedupeKey: `COMMUNICATION_NEXT_ACTION:${row.id}` } });
    expect(reminder.status).not.toBe("OPEN");
    expect(await db.communicationLog.count({ where: { id: row.id } })).toBe(1);
    await expect(archiveCommunication(db, row.id, actor)).rejects.toThrow(/no longer exists/);
  });
  it("refuses a future date, an unknown client, and editing someone else's entry", async () => {
    const [a, b] = [await makeClient(), await makeClient()];
    await expect(saveCommunication(db, null, comm({ clientId: a.id, date: addDaysKey(TODAY, 1) }), actor)).rejects.toThrow(/future/);
    await expect(saveCommunication(db, null, comm({ clientId: "nobody" }), actor)).rejects.toThrow(/no longer exists/);
    const row = await saveCommunication(db, null, comm({ clientId: a.id }), actor);
    await expect(saveCommunication(db, row.id, comm({ clientId: b.id }), actor)).rejects.toThrow(/someone else/);
    const edited = await saveCommunication(db, row.id, comm({ clientId: a.id, summary: "Changed it" }), actor);
    expect(edited.summary).toBe("Changed it");
  });
  it("works for a lead too", async () => {
    const lead = await db.lead.create({ data: { contactName: "Ravi", stage: "NEW" } });
    const row = await saveCommunication(db, null, comm({ leadId: lead.id }), actor);
    expect([row.leadId, row.clientId]).toEqual([lead.id, null]);
  });
});
