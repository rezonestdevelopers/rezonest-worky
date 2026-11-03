import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { clientCreateSchema } from "@/lib/validators/client";
import { leadSchema } from "@/lib/validators/lead";
import { serviceSchema, taskTemplateSchema } from "@/lib/validators/catalogue";
import { archiveClient, archiveContact, createClient, restoreClient, saveContact, updateClient } from "@/server/services/clients";
import { changeLeadStage, convertLead, createLead, setLeadArchived } from "@/server/services/leads";
import { analyseImport, cellToText, commitImport, parseImportFile } from "@/server/services/import";
import { saveMasterItem, saveService, saveSubServices, saveTaskTemplate } from "@/server/services/catalogue";
import { BusinessError, diffChanges, loadContactables } from "@/server/services/shared";

const db = new PrismaClient();
let actorId: string;

const leadInput = (over: Record<string, unknown> = {}) =>
  leadSchema.parse({ contactName: "Asha Kulkarni", companyName: "Asha Foods", phone: "9000000001", servicesInterested: [], ...over });

const clientInput = (over: Record<string, unknown> = {}) =>
  clientCreateSchema.parse({ companyName: "Asha Foods Pvt Ltd", contactName: "Asha Kulkarni", country: "India", stateCode: "27", status: "ACTIVE", phone: "9000000001", ...over });

beforeAll(async () => {
  const user = await db.user.upsert({
    where: { email: "phase2-tester@example.com" },
    update: {},
    create: { name: "Tester", email: "phase2-tester@example.com", passwordHash: "x", role: "ADMIN" },
  });
  actorId = user.id;
});

beforeEach(async () => {
  // Children first. This only ever runs on the *_test database (see global-setup).
  await db.paymentAllocation.deleteMany();
  await db.payment.deleteMany();
  await db.creditNote.deleteMany();
  await db.invoiceItem.deleteMany();
  await db.invoice.deleteMany();
  await db.onboardingChecklist.deleteMany();
  await db.task.deleteMany();
  await db.project.deleteMany();
  await db.offerItem.deleteMany();
  await db.offer.deleteMany();
  await db.communicationLog.deleteMany();
  await db.lead.deleteMany();
  await db.client.deleteMany();
  await db.activityLog.deleteMany();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("leads", () => {
  it("creating a lead records its first stage and an activity entry", async () => {
    const lead = await createLead(db, leadInput(), actorId);
    const history = await db.leadStageHistory.findMany({ where: { leadId: lead.id } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ fromStage: null, toStage: "NEW", changedById: actorId });
    expect(lead.ownerId).toBe(actorId);
    expect(await db.activityLog.count({ where: { entityId: lead.id, action: "lead.created" } })).toBe(1);
  });

  it("stores the budget exactly", async () => {
    const lead = await createLead(db, leadInput({ approxBudget: "₹1,25,000.55" }), actorId);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).approxBudget?.toString()).toBe("125000.55");
  });

  it("moving stage keeps history; Lost saves the reason and clears the follow-up", async () => {
    const lead = await createLead(db, leadInput({ nextFollowUpDate: "2026-12-01" }), actorId);
    await changeLeadStage(db, { leadId: lead.id, stage: "CONTACTED", lostReason: null, actorId });
    await changeLeadStage(db, { leadId: lead.id, stage: "LOST", lostReason: "Too costly", actorId });
    const after = await db.lead.findUniqueOrThrow({ where: { id: lead.id }, include: { stageHistory: { orderBy: { createdAt: "asc" } } } });
    expect(after).toMatchObject({ stage: "LOST", lostReason: "Too costly", nextFollowUpDate: null });
    expect(after.stageHistory.map((h) => h.toStage)).toEqual(["NEW", "CONTACTED", "LOST"]);
    expect(after.stageHistory[2]).toMatchObject({ fromStage: "CONTACTED", note: "Too costly" });
  });

  it("reopening a Lost lead clears the reason", async () => {
    const lead = await createLead(db, leadInput(), actorId);
    await changeLeadStage(db, { leadId: lead.id, stage: "LOST", lostReason: "Too costly", actorId });
    await changeLeadStage(db, { leadId: lead.id, stage: "CONTACTED", lostReason: null, actorId });
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).lostReason).toBeNull();
  });

  it("can't be marked Won without converting", async () => {
    const lead = await createLead(db, leadInput(), actorId);
    await expect(changeLeadStage(db, { leadId: lead.id, stage: "WON", lostReason: null, actorId })).rejects.toThrow(BusinessError);
  });

  it("archived leads are kept but can't be changed until restored", async () => {
    const lead = await createLead(db, leadInput(), actorId);
    await setLeadArchived(db, lead.id, true, actorId);
    expect(await db.lead.count({ where: { id: lead.id } })).toBe(1);
    await expect(changeLeadStage(db, { leadId: lead.id, stage: "CONTACTED", lostReason: null, actorId })).rejects.toThrow(/archived/);
    await setLeadArchived(db, lead.id, false, actorId);
    await changeLeadStage(db, { leadId: lead.id, stage: "CONTACTED", lostReason: null, actorId });
  });
});

describe("converting a lead to a client", () => {
  it("creates the client and primary contact, marks the lead Won, and moves offers and notes across", async () => {
    const lead = await createLead(db, leadInput(), actorId);
    const offer = await db.offer.create({
      data: { number: `T-${lead.id}`, leadId: lead.id, title: "Test offer", offerDate: new Date("2026-11-01"), validUntil: new Date("2026-11-15") },
    });
    const note = await db.communicationLog.create({ data: { leadId: lead.id, type: "CALL", date: new Date(), summary: "Called" } });

    const { clientId } = await convertLead(db, { leadId: lead.id, client: clientInput(), actorId });

    const client = await db.client.findUniqueOrThrow({ where: { id: clientId }, include: { contacts: true } });
    expect(client.companyName).toBe("Asha Foods Pvt Ltd");
    expect(client.contacts).toHaveLength(1);
    expect(client.contacts[0]).toMatchObject({ name: "Asha Kulkarni", isPrimary: true });

    const after = await db.lead.findUniqueOrThrow({ where: { id: lead.id }, include: { stageHistory: true } });
    expect(after).toMatchObject({ stage: "WON", convertedClientId: clientId });
    expect(after.convertedAt).not.toBeNull();
    expect(after.stageHistory.some((h) => h.toStage === "WON")).toBe(true);

    expect((await db.offer.findUniqueOrThrow({ where: { id: offer.id } })).clientId).toBe(clientId);
    expect((await db.communicationLog.findUniqueOrThrow({ where: { id: note.id } })).clientId).toBe(clientId);
  });

  it("can't be converted twice", async () => {
    const lead = await createLead(db, leadInput(), actorId);
    await convertLead(db, { leadId: lead.id, client: clientInput(), actorId });
    await expect(convertLead(db, { leadId: lead.id, client: clientInput(), actorId })).rejects.toThrow(/already been converted/);
    expect(await db.client.count()).toBe(1);
  });

  it("two clicks at the same moment create only one client", async () => {
    const lead = await createLead(db, leadInput(), actorId);
    const results = await Promise.allSettled([
      convertLead(db, { leadId: lead.id, client: clientInput(), actorId }),
      convertLead(db, { leadId: lead.id, client: clientInput(), actorId }),
      convertLead(db, { leadId: lead.id, client: clientInput(), actorId }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.client.count()).toBe(1);
  });

  it("a failed conversion saves nothing", async () => {
    const lead = await createLead(db, leadInput(), actorId);
    await expect(convertLead(db, { leadId: lead.id, client: clientInput({ sectorId: "does-not-exist" }), actorId })).rejects.toThrow();
    expect(await db.client.count()).toBe(0);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).stage).toBe("NEW");
  });

  it("can link to an existing client, and one client can have several leads", async () => {
    const client = await createClient(db, clientInput(), actorId);
    const a = await createLead(db, leadInput(), actorId);
    const b = await createLead(db, leadInput({ phone: "9000000002" }), actorId);
    await convertLead(db, { leadId: a.id, linkClientId: client.id, actorId });
    await convertLead(db, { leadId: b.id, linkClientId: client.id, actorId });
    expect(await db.lead.count({ where: { convertedClientId: client.id, stage: "WON" } })).toBe(2);
    expect(await db.client.count()).toBe(1);
  });

  it("won't link to an archived client", async () => {
    const client = await createClient(db, clientInput(), actorId);
    await archiveClient(db, client.id, actorId);
    const lead = await createLead(db, leadInput(), actorId);
    await expect(convertLead(db, { leadId: lead.id, linkClientId: client.id, actorId })).rejects.toThrow(/can't be linked/);
  });
});

describe("clients", () => {
  it("logs only what actually changed, old and new", async () => {
    const client = await createClient(db, clientInput({ city: "Pune" }), actorId);
    await updateClient(db, client.id, clientInput({ city: "Nashik" }), actorId);
    const log = await db.activityLog.findFirstOrThrow({ where: { entityId: client.id, action: "client.updated" } });
    expect(log.changes).toEqual({ city: { from: "Pune", to: "Nashik" } });
    await updateClient(db, client.id, clientInput({ city: "Nashik" }), actorId);
    expect(await db.activityLog.count({ where: { entityId: client.id, action: "client.updated" } })).toBe(1);
  });

  async function issueInvoice(clientId: string, balance: string) {
    return db.invoice.create({
      data: {
        number: `T-${clientId}-${balance}`, type: "TAX", status: "ISSUED", clientId, invoiceDate: new Date("2026-11-01"), dueDate: new Date("2026-11-15"),
        placeOfSupply: "Maharashtra (27)", taxMode: "INTRA_STATE", grandTotal: balance, balanceDue: balance,
      },
    });
  }

  it("can't be archived while money is owed", async () => {
    const client = await createClient(db, clientInput(), actorId);
    await issueInvoice(client.id, "59000");
    await expect(archiveClient(db, client.id, actorId)).rejects.toThrow(/1 unpaid invoice/);
    expect((await db.client.findUniqueOrThrow({ where: { id: client.id } })).archivedAt).toBeNull();
  });

  it("can't be archived with a running project", async () => {
    const client = await createClient(db, clientInput(), actorId);
    await db.project.create({ data: { code: `P-${client.id}`, name: "Work", clientId: client.id, startDate: new Date("2026-11-01"), status: "ACTIVE" } });
    await expect(archiveClient(db, client.id, actorId)).rejects.toThrow(/1 running project/);
  });

  it("a paid-up client can be archived and restored, keeping everything", async () => {
    const client = await createClient(db, clientInput(), actorId);
    await issueInvoice(client.id, "0");
    await archiveClient(db, client.id, actorId);
    expect(await db.client.findUniqueOrThrow({ where: { id: client.id } })).toMatchObject({ status: "ARCHIVED" });
    await expect(updateClient(db, client.id, clientInput({ city: "X" }), actorId)).rejects.toThrow(/archived/);
    await restoreClient(db, client.id, actorId);
    const after = await db.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(after).toMatchObject({ status: "ACTIVE", archivedAt: null });
    expect(await db.invoice.count({ where: { clientId: client.id } })).toBe(1);
  });
});

describe("contact people", () => {
  const contact = (over: Record<string, unknown> = {}) => ({ name: "Second", designation: null, phone: null, whatsapp: null, email: null, isPrimary: false, ...over });
  const primaries = (clientId: string) => db.clientContact.findMany({ where: { clientId, isPrimary: true, archivedAt: null } });

  it("making a new primary replaces the old one", async () => {
    const client = await createClient(db, clientInput(), actorId);
    await saveContact(db, client.id, undefined, contact({ isPrimary: true }), actorId);
    const list = await primaries(client.id);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Second");
  });

  it("the primary can't be un-marked or removed", async () => {
    const client = await createClient(db, clientInput(), actorId);
    const [primary] = await primaries(client.id);
    await expect(saveContact(db, client.id, primary.id, contact({ name: primary.name }), actorId)).rejects.toThrow(/primary/);
    await expect(archiveContact(db, client.id, primary.id, actorId)).rejects.toThrow(/primary/);
  });

  it("removing keeps the record, and duplicates stop matching it", async () => {
    const client = await createClient(db, clientInput(), actorId);
    const { id } = await saveContact(db, client.id, undefined, contact({ phone: "9111111111" }), actorId);
    await archiveContact(db, client.id, id, actorId);
    expect((await db.clientContact.findUniqueOrThrow({ where: { id } })).archivedAt).not.toBeNull();
    const known = await loadContactables(db, { leads: false });
    expect(known[0].phones).not.toContain("9111111111");
  });

  it("can't edit a contact through another client", async () => {
    const a = await createClient(db, clientInput(), actorId);
    const b = await createClient(db, clientInput({ phone: "9000000009" }), actorId);
    const [contactOfA] = await primaries(a.id);
    await expect(saveContact(db, b.id, contactOfA.id, contact({ isPrimary: true }), actorId)).rejects.toThrow(/no longer exists/);
  });
});

async function sheet(rows: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("import files", () => {
  it("reads Excel including phone numbers stored as numbers, email links and real dates", async () => {
    const file = await sheet([
      ["Contact Person", "Mobile", "Email", "Next Follow-up", "Nonsense"],
      ["Asha", 9000000001, { text: "asha@x.in", hyperlink: "mailto:asha@x.in" }, new Date(Date.UTC(2026, 10, 15)), "ignored"],
    ]);
    const { rows, ignoredColumns } = await parseImportFile("leads", file, "list.xlsx");
    expect(ignoredColumns).toEqual(["Nonsense"]);
    expect(rows).toEqual([{ rowNumber: 2, values: { contactName: "Asha", phone: "9000000001", email: "asha@x.in", followUp: "2026-11-15" } }]);
  });

  it("reads CSV, skipping blank rows", async () => {
    const { rows } = await parseImportFile("clients", Buffer.from('Company,City\n"Asha Foods, Pune",Pune\n,\n'), "list.csv");
    expect(rows).toEqual([{ rowNumber: 2, values: { companyName: "Asha Foods, Pune", city: "Pune" } }]);
  });

  it("explains what's wrong with bad files", async () => {
    await expect(parseImportFile("leads", Buffer.from("x"), "old.xls")).rejects.toThrow(/\.xls files/);
    await expect(parseImportFile("leads", Buffer.from("not a zip"), "fake.xlsx")).rejects.toThrow(/Excel/);
    await expect(parseImportFile("leads", Buffer.from("x"), "photo.png")).rejects.toThrow(/Excel/);
    await expect(parseImportFile("leads", Buffer.from(""), "empty.csv")).rejects.toThrow(/empty/);
    await expect(parseImportFile("leads", Buffer.from("City,State\nPune,MH"), "a.csv")).rejects.toThrow(/Contact Person/);
    await expect(parseImportFile("leads", Buffer.from("Contact Person,Phone"), "a.csv")).rejects.toThrow(/no rows/);
    const big = "Contact Person\n" + "Asha\n".repeat(2001);
    await expect(parseImportFile("leads", Buffer.from(big), "a.csv")).rejects.toThrow(/limit/);
  });

  it("cell values of every kind become text", () => {
    expect(cellToText(null)).toBe("");
    expect(cellToText(" x ")).toBe("x");
    expect(cellToText(42)).toBe("42");
    expect(cellToText({ richText: [{ text: "a" }, { text: "b" }] })).toBe("ab");
    expect(cellToText({ formula: "=1+1", result: 2 })).toBe("2");
    expect(cellToText({ text: "site", hyperlink: "https://x.in" })).toBe("site");
    expect(cellToText({ error: "#REF!" })).toBe("");
  });
});

describe("saving an import", () => {
  it("imports good rows, skips errors and duplicates, and logs a summary", async () => {
    await createClient(db, clientInput({ phone: "9000000001" }), actorId);
    const rows: { rowNumber: number; values: Record<string, string> }[] = [
      { rowNumber: 2, values: { companyName: "Good Co", phone: "9000000002" } },
      { rowNumber: 3, values: { companyName: "Copy Of Asha", phone: "+91 90000 00001" } },
      { rowNumber: 4, values: { companyName: "Bad GST", gstin: "nope" } },
      { rowNumber: 5, values: { companyName: "Vertex", gstin: "29AAFCV2231H1Z6" } },
    ];
    const result = await commitImport(db, { kind: "clients", rows, allowDuplicateRows: [], actorId });
    expect(result).toEqual({ created: 2, skippedDuplicates: 1, skippedErrors: 1 });
    expect(await db.client.count()).toBe(3);

    const vertex = await db.client.findFirstOrThrow({ where: { companyName: "Vertex" }, include: { contacts: true } });
    expect(vertex).toMatchObject({ state: "Karnataka", stateCode: "29", createdById: actorId });
    expect(vertex.contacts[0]).toMatchObject({ name: "Vertex", isPrimary: true });
    expect(await db.activityLog.count({ where: { action: "import.clients" } })).toBe(1);
  });

  it("a duplicate is imported only if ticked", async () => {
    await createClient(db, clientInput({ phone: "9000000001" }), actorId);
    const rows = [{ rowNumber: 2, values: { companyName: "Second Branch", phone: "9000000001" } }];
    const result = await commitImport(db, { kind: "clients", rows, allowDuplicateRows: [2], actorId });
    expect(result.created).toBe(1);
  });

  it("running the same file twice adds nothing the second time", async () => {
    const rows = [{ rowNumber: 2, values: { contactName: "Asha", phone: "9000000005" } }];
    expect((await commitImport(db, { kind: "leads", rows, allowDuplicateRows: [], actorId })).created).toBe(1);
    expect(await commitImport(db, { kind: "leads", rows, allowDuplicateRows: [], actorId })).toEqual({ created: 0, skippedDuplicates: 1, skippedErrors: 0 });
    expect(await db.lead.count()).toBe(1);
  });

  it("imported leads start at New with history", async () => {
    await commitImport(db, { kind: "leads", rows: [{ rowNumber: 2, values: { contactName: "Asha", email: "a@x.in" } }], allowDuplicateRows: [], actorId });
    const lead = await db.lead.findFirstOrThrow({ include: { stageHistory: true } });
    expect(lead.stage).toBe("NEW");
    expect(lead.stageHistory).toHaveLength(1);
  });

  it("preview saves nothing", async () => {
    await analyseImport(db, "leads", [{ rowNumber: 2, values: { contactName: "Asha", email: "a@x.in" } }]);
    expect(await db.lead.count()).toBe(0);
  });

  it("all or nothing: one failure saves no rows", async () => {
    const rows = [
      { rowNumber: 2, values: { contactName: "Asha", email: "a@x.in" } },
      { rowNumber: 3, values: { contactName: "Ben", email: "b@x.in" } },
    ];
    const failing = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== "$transaction") return Reflect.get(target, prop, receiver);
        return (fn: (tx: unknown) => Promise<unknown>, opts: never) =>
          target.$transaction(async (tx) => {
            await fn(tx);
            throw new Error("database went away");
          }, opts);
      },
    });
    await expect(commitImport(failing, { kind: "leads", rows, allowDuplicateRows: [], actorId })).rejects.toThrow("database went away");
    expect(await db.lead.count()).toBe(0);
  });
});

describe("service catalogue", () => {
  const service = (over: Record<string, unknown> = {}) =>
    serviceSchema.parse({
      name: `Test Service ${Math.random()}`, departmentId: "", billingType: "PER_UNIT", defaultPrice: "1500.50", unit: "post", gstRate: "18", sacCode: "",
      revisionsIncluded: 2, isActive: true, defaultKpis: [], defaultDeliverables: [], ...over,
    });

  it("creates with a unique web address and exact price", async () => {
    const name = `Same Name ${Date.now()}`;
    const a = await saveService(db, undefined, service({ name }), actorId);
    await db.service.update({ where: { id: a.id }, data: { name: `${name} old` } });
    const b = await saveService(db, undefined, service({ name }), actorId);
    expect(b.slug).toBe(`${a.slug}-2`);
    expect(a.defaultPrice.toString()).toBe("1500.5");
  });

  it("logs price changes but not unchanged saves", async () => {
    const s = await saveService(db, undefined, service(), actorId);
    const same = service({ name: s.name, defaultPrice: "1500.50" });
    await saveService(db, s.id, same, actorId);
    expect(await db.activityLog.count({ where: { entityId: s.id, action: "service.updated" } })).toBe(0);
    await saveService(db, s.id, { ...same, defaultPrice: "2000" }, actorId);
    const log = await db.activityLog.findFirstOrThrow({ where: { entityId: s.id, action: "service.updated" } });
    expect(log.changes).toEqual({ defaultPrice: { from: "1500.5", to: "2000" } });
  });

  it("sub-services can swap names and be added", async () => {
    const s = await saveService(db, undefined, service(), actorId);
    const row = (name: string, id?: string) => ({ id, name, billingType: null, defaultPrice: null, unit: null, isActive: true });
    await saveSubServices(db, { serviceId: s.id, items: [row("Reel"), row("Post")] }, actorId);
    const [reel, post] = await db.subService.findMany({ where: { serviceId: s.id }, orderBy: { sortOrder: "asc" } });
    await saveSubServices(db, { serviceId: s.id, items: [row("Post", reel.id), row("Reel", post.id), row("Story")] }, actorId);
    const after = await db.subService.findMany({ where: { serviceId: s.id }, orderBy: { sortOrder: "asc" } });
    expect(after.map((x) => [x.id, x.name])).toEqual([[reel.id, "Post"], [post.id, "Reel"], [expect.any(String), "Story"]]);
  });

  it("sub-services can't be dropped from the list", async () => {
    const s = await saveService(db, undefined, service(), actorId);
    await saveSubServices(db, { serviceId: s.id, items: [{ name: "Reel", billingType: null, defaultPrice: null, unit: null, isActive: true }] }, actorId);
    await expect(saveSubServices(db, { serviceId: s.id, items: [] }, actorId)).rejects.toThrow(/deactivated/);
    expect(await db.subService.count({ where: { serviceId: s.id, name: "Reel" } })).toBe(1);
  });

  it("template steps run one after another; editing replaces them", async () => {
    const s = await saveService(db, undefined, service(), actorId);
    const step = (title: string, durationDays: number) => ({ title, departmentId: "", durationDays, priority: "MEDIUM", isClientApproval: false });
    const input = (id?: string, steps = [step("Script", 2), step("Shoot", 1), step("Edit", 3)]) => taskTemplateSchema.parse({ id, serviceId: s.id, name: "Reel", isActive: true, steps });
    const { id } = await saveTaskTemplate(db, input(), actorId);
    let rows = await db.taskTemplateStep.findMany({ where: { templateId: id }, orderBy: { sortOrder: "asc" } });
    expect(rows.map((r) => [r.title, r.offsetDays])).toEqual([["Script", 0], ["Shoot", 2], ["Edit", 3]]);

    await saveTaskTemplate(db, input(id, [step("Edit", 3), step("Post", 1)]), actorId);
    rows = await db.taskTemplateStep.findMany({ where: { templateId: id }, orderBy: { sortOrder: "asc" } });
    expect(rows.map((r) => [r.title, r.offsetDays])).toEqual([["Edit", 0], ["Post", 3]]);
  });

  it("master lists reject a repeated name, and can be switched off", async () => {
    const name = `Sector ${Date.now()}`;
    const { id } = await saveMasterItem(db, { kind: "sector", name, isActive: true }, actorId);
    await expect(saveMasterItem(db, { kind: "sector", name, isActive: true }, actorId)).rejects.toThrow();
    await saveMasterItem(db, { kind: "sector", id, name, isActive: false }, actorId);
    expect((await db.sector.findUniqueOrThrow({ where: { id } })).isActive).toBe(false);
  });
});

describe("activity diff", () => {
  it("treats 25000 and 25000.00 as the same amount", () => {
    expect(diffChanges({ a: "25000" }, { a: "25000.00" }, ["a"])).toEqual({});
    expect(diffChanges({ a: "25000" }, { a: "25001" }, ["a"])).toEqual({ a: { from: "25000", to: "25001" } });
  });
  it("treats blank and missing as the same", () => {
    expect(diffChanges({ a: null }, { a: undefined }, ["a"])).toEqual({});
  });
});
