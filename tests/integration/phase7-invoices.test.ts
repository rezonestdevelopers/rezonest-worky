import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { addDaysKey, keyToDate, monthKeyOf, todayKey } from "@/lib/dates";
import { publicToken } from "@/lib/public-token";
import { clientCreateSchema } from "@/lib/validators/client";
import { assetSchema } from "@/lib/validators/delivery";
import { invoiceSchema, paymentSchema, type InvoiceInput, type PaymentInput } from "@/lib/validators/invoice";
import { offerSchema } from "@/lib/validators/offer";
import { convertOfferSchema } from "@/lib/validators/work";
import { createClient } from "@/server/services/clients";
import {
  cancelInvoice,
  convertAndApplyAdvance,
  convertProforma,
  createChangeRequestDraft,
  createCreditNote,
  createMilestoneDraft,
  createProjectDraft,
  createRenewalDraft,
  createRetainerDraft,
  discardDraft,
  issueInvoice,
  markOverdueInvoices,
  runInvoiceJob,
  saveDraftInvoice,
} from "@/server/services/invoices";
import { acceptOfferViaLink, createOffer, markOfferSent, prepareForSending } from "@/server/services/offers";
import { applyAdvance, clientLedger, recordPayment, removeAllocation, voidPayment } from "@/server/services/payments";
import { convertOfferToProject, createChangeRequest, decideChangeRequest, runDailyWork } from "@/server/services/projects";
import { saveAsset } from "@/server/services/renewals";

const db = new PrismaClient();
const TODAY = todayKey();
const MONTH = monthKeyOf(TODAY);
const GSTIN = "27ABCDE1234F1Z5";
const SAC = "998361";
let actor: string;
let retainerService: string;
let webService: string;

const makeClient = (stateCode = "27", over: Record<string, unknown> = {}) =>
  createClient(db, clientCreateSchema.parse({ companyName: `Client ${Math.random()}`, contactName: "Asha", country: "India", stateCode, status: "ACTIVE", email: `c${Math.random()}@x.in`, phone: `9${Math.floor(Math.random() * 1e9).toString().padStart(9, "0")}`, ...over }), actor);

const invoiceInput = (clientId: string, over: Partial<InvoiceInput> = {}): InvoiceInput => ({
  clientId, projectId: "", type: "TAX", gstEnabled: true, invoiceDate: TODAY, dueDate: addDaysKey(TODAY, 15), terms: "", notes: "",
  items: [{ description: "SEO work", sacCode: SAC, quantity: "1", rate: "1000", gstRate: "18" }], ...over,
});
const draft = (clientId: string, over: Partial<InvoiceInput> = {}) => saveDraftInvoice(db, null, invoiceSchema.parse(invoiceInput(clientId, over)), actor);
const issued = async (clientId: string, over: Partial<InvoiceInput> = {}) => issueInvoice(db, (await draft(clientId, over)).id, actor);
const pay = (clientId: string, over: Partial<PaymentInput> = {}) =>
  recordPayment(db, paymentSchema.parse({ clientId, date: TODAY, amount: "1180", tdsAmount: "", tdsSection: "", mode: "UPI", reference: "", notes: "", allocations: [], ...over }), actor);
const load = (id: string) => db.invoice.findUniqueOrThrow({ where: { id } });
const str = (v: { toString(): string }) => v.toString();

async function acceptedOffer(clientId: string, items: Record<string, unknown>[], gstEnabled = true) {
  const offer = await createOffer(db, offerSchema.parse({ clientId, title: "Work", offerDate: TODAY, validUntil: addDaysKey(TODAY, 15), gstEnabled, milestones: [], items }), actor);
  const link = await prepareForSending(db, offer.id, actor);
  await markOfferSent(db, { offerId: offer.id, followUpDate: addDaysKey(TODAY, 3), actorId: actor, via: "email" });
  await acceptOfferViaLink(db, { token: publicToken(link.id), name: "Asha", ip: "1.1.1.1" });
  return offer;
}
const webItem = { serviceId: "", description: "Website", billingType: "MILESTONE", quantity: "1", unit: "project", rate: "100000", gstRate: "18", sacCode: SAC };
const retainerItem = { serviceId: "", description: "Social retainer", billingType: "MONTHLY_RETAINER", quantity: "1", unit: "month", rate: "20000", gstRate: "18", sacCode: SAC };

async function project(items: Record<string, unknown>[], over: Record<string, unknown> = {}, gstEnabled = true) {
  const c = await makeClient();
  const offer = await acceptedOffer(c.id, items.map((i) => ({ ...i, serviceId: i.billingType === "MONTHLY_RETAINER" ? retainerService : webService })), gstEnabled);
  const p = await convertOfferToProject(db, convertOfferSchema.parse({ offerId: offer.id, name: "My project", managerId: actor, startDate: TODAY, deadline: "", retainerEnd: items.some((i) => i.billingType === "MONTHLY_RETAINER") ? addDaysKey(TODAY, 200) : "", autoRenew: false, milestones: [], targets: [], createTasks: false, ...over }), actor);
  return { ...p, clientId: c.id };
}

async function cleanMoney() {
  await db.invoiceRun.deleteMany();
  await db.paymentAllocation.deleteMany();
  await db.payment.deleteMany();
  await db.creditNote.deleteMany();
  await db.changeRequest.deleteMany();
  await db.invoiceItem.deleteMany();
  await db.invoice.updateMany({ data: { convertedFromId: null } });
  await db.invoice.deleteMany();
}

beforeAll(async () => {
  await db.settings.upsert({ where: { id: "agency" }, update: { stateCode: "27", gstin: GSTIN, gstEnabledByDefault: true, defaultPaymentTermsDays: 15, upiId: "rezonest@okhdfcbank", bankName: "HDFC", invoiceTerms: "Pay on time" }, create: { id: "agency", agencyName: "Test", address: "Pune", stateCode: "27", gstin: GSTIN } });
  const user = await db.user.upsert({ where: { email: "phase7-tester@example.com" }, update: { isActive: true, role: "ADMIN" }, create: { name: "Tester", email: "phase7-tester@example.com", passwordHash: "x", role: "ADMIN" } });
  actor = user.id;
  const dept = (await db.department.upsert({ where: { name: "P7 Dept" }, update: {}, create: { name: "P7 Dept" } })).id;
  retainerService = (await db.service.upsert({ where: { slug: "p7-retainer" }, update: {}, create: { name: "P7 Retainer", slug: "p7-retainer", billingType: "MONTHLY_RETAINER", departmentId: dept, sacCode: SAC } })).id;
  webService = (await db.service.upsert({ where: { slug: "p7-web" }, update: {}, create: { name: "P7 Web", slug: "p7-web", billingType: "MILESTONE", departmentId: dept, sacCode: SAC } })).id;
});

beforeEach(async () => {
  await db.settings.update({ where: { id: "agency" }, data: { gstin: GSTIN } });
  await cleanMoney();
});

afterAll(async () => {
  await cleanMoney();
  await db.domainHostingAsset.deleteMany();
  await db.settings.update({ where: { id: "agency" }, data: { gstin: null, upiId: null, bankName: null, invoiceTerms: null } });
  await db.$disconnect();
});

describe("drafts and issuing", () => {
  it("a draft has no number, and takes the right tax for the client's state", async () => {
    const same = await draft((await makeClient("27")).id);
    expect(same.number).toBeNull();
    expect(same.status).toBe("DRAFT");
    expect(same.taxMode).toBe("INTRA_STATE");
    expect([str(same.cgstTotal), str(same.sgstTotal), str(same.igstTotal), str(same.grandTotal)]).toEqual(["90", "90", "0", "1180"]);
    const other = await draft((await makeClient("29")).id);
    expect(other.taxMode).toBe("INTER_STATE");
    expect([str(other.cgstTotal), str(other.igstTotal), str(other.grandTotal)]).toEqual(["0", "180", "1180"]);
    expect(other.placeOfSupply).toMatch(/\(29\)/);
  });

  it("GST can be switched off, and abroad means export", async () => {
    const off = await draft((await makeClient()).id, { gstEnabled: false });
    expect(off.taxMode).toBe("NO_GST");
    expect(str(off.grandTotal)).toBe("1000");
    const abroad = await draft((await makeClient("27", { country: "United States", stateCode: "" })).id);
    expect(abroad.taxMode).toBe("EXPORT");
    expect(str(abroad.grandTotal)).toBe("1000");
    expect(abroad.placeOfSupply).toMatch(/Outside India/);
  });

  it("issuing gives a number, locks it, and freezes the agency and client details", async () => {
    const c = await makeClient();
    const inv = await issued(c.id);
    expect(inv.number).toMatch(/^REZ\/INV\/\d{4}-\d{2}\/\d{4}$/);
    expect(inv.status).toBe("ISSUED");
    expect(inv.paymentStatus).toBe("UNPAID");
    expect((inv.agencySnapshot as { gstin: string }).gstin).toBe(GSTIN);
    expect((inv.agencySnapshot as { upiId: string }).upiId).toBe("rezonest@okhdfcbank");
    expect((inv.clientSnapshot as { name: string }).name).toBe(c.companyName);

    await expect(saveDraftInvoice(db, inv.id, invoiceSchema.parse(invoiceInput(c.id)), actor)).rejects.toThrow(/can't be edited/);
    await expect(issueInvoice(db, inv.id, actor)).rejects.toThrow(/already been issued/);
    await db.settings.update({ where: { id: "agency" }, data: { gstin: "27AAAAA0000A1Z5" } });
    expect(((await load(inv.id)).agencySnapshot as { gstin: string }).gstin).toBe(GSTIN);
  });

  it("a GST tax invoice is blocked until GSTIN and SAC codes are in, and drafts still save", async () => {
    const c = await makeClient();
    const noSac = await draft(c.id, { items: [{ description: "Logo", sacCode: "", quantity: "1", rate: "1000", gstRate: "18" }] });
    await expect(issueInvoice(db, noSac.id, actor)).rejects.toThrow(/SAC code to: Logo/);
    expect((await load(noSac.id)).number).toBeNull();

    await db.settings.update({ where: { id: "agency" }, data: { gstin: null } });
    const noGstin = await draft(c.id);
    await expect(issueInvoice(db, noGstin.id, actor)).rejects.toThrow(/GSTIN/);

    // These two don't need it.
    expect((await issued(c.id, { gstEnabled: false, items: [{ description: "Logo", sacCode: "", quantity: "1", rate: "1000", gstRate: "18" }] })).status).toBe("ISSUED");
    expect((await issued(c.id, { type: "PROFORMA", items: [{ description: "Logo", sacCode: "", quantity: "1", rate: "1000", gstRate: "18" }] })).number).toMatch(/REZ\/PI\//);
  });

  it("refuses a future-dated invoice", async () => {
    const d = await draft((await makeClient()).id, { invoiceDate: addDaysKey(TODAY, 1), dueDate: addDaysKey(TODAY, 10) });
    await expect(issueInvoice(db, d.id, actor)).rejects.toThrow(/future/);
  });

  it("issuing the same draft twice at once gives one number, and a failed issue uses none", async () => {
    const c = await makeClient();
    const d = await draft(c.id);
    const results = await Promise.allSettled([issueInvoice(db, d.id, actor), issueInvoice(db, d.id, actor)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const first = (await load(d.id)).number!;

    const bad = await draft(c.id, { items: [{ description: "No SAC", sacCode: "", quantity: "1", rate: "100", gstRate: "18" }] });
    await expect(issueInvoice(db, bad.id, actor)).rejects.toThrow();
    const next = await issued(c.id);
    expect(Number(next.number!.slice(-4))).toBe(Number(first.slice(-4)) + 1);
  });

  it("many invoices issued at once all get different numbers", async () => {
    const c = await makeClient();
    const drafts = await Promise.all(Array.from({ length: 6 }, () => draft(c.id)));
    const done = await Promise.all(drafts.map((d) => issueInvoice(db, d.id, actor)));
    expect(new Set(done.map((d) => d.number)).size).toBe(6);
  });

  it("editing a draft replaces its lines and totals", async () => {
    const c = await makeClient();
    const d = await draft(c.id, { items: [{ description: "One", sacCode: SAC, quantity: "1", rate: "100", gstRate: "18" }, { description: "Two", sacCode: SAC, quantity: "1", rate: "200", gstRate: "18" }] });
    const items = await db.invoiceItem.findMany({ where: { invoiceId: d.id }, orderBy: { sortOrder: "asc" } });
    await saveDraftInvoice(db, d.id, invoiceSchema.parse(invoiceInput(c.id, { items: [{ id: items[1].id, description: "Two changed", sacCode: SAC, quantity: "2", rate: "200", gstRate: "18" }, { description: "New", sacCode: SAC, quantity: "1", rate: "50", gstRate: "18" }] })), actor);
    const after = await db.invoice.findUniqueOrThrow({ where: { id: d.id }, include: { items: { orderBy: { sortOrder: "asc" } } } });
    expect(after.items.map((i) => i.description)).toEqual(["Two changed", "New"]);
    expect(str(after.taxableTotal)).toBe("450");
    expect(str(after.grandTotal)).toBe("531");
  });

  it("a discarded draft stays on record, without a number", async () => {
    const d = await draft((await makeClient()).id);
    await discardDraft(db, d.id, actor);
    const row = await load(d.id);
    expect(row.status).toBe("CANCELLED");
    expect(row.number).toBeNull();
    const issuedOne = await issued((await makeClient()).id);
    await expect(discardDraft(db, issuedOne.id, actor)).rejects.toThrow(/Only drafts/);
  });
});

describe("cancelling", () => {
  it("keeps the number and the reason, and owes nothing", async () => {
    const inv = await issued((await makeClient()).id);
    await cancelInvoice(db, inv.id, "Raised by mistake", actor);
    const row = await load(inv.id);
    expect([row.status, row.paymentStatus, row.number, row.cancelReason, str(row.balanceDue)]).toEqual(["CANCELLED", "CANCELLED", inv.number, "Raised by mistake", "0"]);
    await expect(cancelInvoice(db, inv.id, "Again", actor)).rejects.toThrow(/Only an issued/);
  });
  it("refused while money or a credit note is on it", async () => {
    const c = await makeClient();
    const paid = await issued(c.id);
    const p = await pay(c.id, { amount: "100", allocations: [{ invoiceId: paid.id, amount: "100", tdsAmount: "" }] });
    await expect(cancelInvoice(db, paid.id, "No", actor)).rejects.toThrow(/Payments are applied/);
    await removeAllocation(db, { paymentId: p.id, invoiceId: paid.id }, actor);
    await cancelInvoice(db, paid.id, "Now fine", actor);

    const credited = await issued(c.id);
    const item = await db.invoiceItem.findFirstOrThrow({ where: { invoiceId: credited.id } });
    await createCreditNote(db, { invoiceId: credited.id, date: TODAY, reason: "Discount", lines: [{ itemId: item.id, taxable: "100" }] }, actor);
    await expect(cancelInvoice(db, credited.id, "No", actor)).rejects.toThrow(/credit note/);
  });
});

describe("payments, TDS and balance", () => {
  it("balance = total − payments − TDS − credit notes, with status following", async () => {
    const c = await makeClient();
    const inv = await issued(c.id);
    await pay(c.id, { amount: "500", tdsAmount: "100", tdsSection: "194J", allocations: [{ invoiceId: inv.id, amount: "500", tdsAmount: "100" }] });
    let row = await load(inv.id);
    expect([str(row.amountPaid), str(row.tdsTotal), str(row.balanceDue), row.paymentStatus]).toEqual(["500", "100", "580", "PARTIALLY_PAID"]);
    const item = await db.invoiceItem.findFirstOrThrow({ where: { invoiceId: inv.id } });
    await createCreditNote(db, { invoiceId: inv.id, date: TODAY, reason: "Discount", lines: [{ itemId: item.id, taxable: "100" }] }, actor);
    row = await load(inv.id);
    expect([str(row.creditedTotal), str(row.balanceDue)]).toEqual(["118", "462"]);
    await pay(c.id, { amount: "462", allocations: [{ invoiceId: inv.id, amount: "462", tdsAmount: "" }] });
    row = await load(inv.id);
    expect([str(row.balanceDue), row.paymentStatus]).toEqual(["0", "PAID"]);
  });

  it("one payment splits across invoices, and the rest stays as advance", async () => {
    const c = await makeClient();
    const [a, b] = [await issued(c.id), await issued(c.id)];
    const p = await pay(c.id, { amount: "2000", allocations: [{ invoiceId: a.id, amount: "1180", tdsAmount: "" }, { invoiceId: b.id, amount: "500", tdsAmount: "" }] });
    expect((await load(a.id)).paymentStatus).toBe("PAID");
    expect(str((await load(b.id)).balanceDue)).toBe("680");
    const third = await issued(c.id);
    await applyAdvance(db, { paymentId: p.id, invoiceId: third.id, amount: "320" }, actor);
    expect(str((await load(third.id)).balanceDue)).toBe("860");
    await expect(applyAdvance(db, { paymentId: p.id, invoiceId: third.id, amount: "1" }, actor)).rejects.toThrow(/left to apply/);
  });

  it("applying to the same invoice twice adds up", async () => {
    const c = await makeClient();
    const inv = await issued(c.id);
    const p = await pay(c.id, { amount: "500" });
    await applyAdvance(db, { paymentId: p.id, invoiceId: inv.id, amount: "100" }, actor);
    await applyAdvance(db, { paymentId: p.id, invoiceId: inv.id, amount: "200" }, actor);
    const allocations = await db.paymentAllocation.findMany({ where: { paymentId: p.id } });
    expect(allocations).toHaveLength(1);
    expect(str(allocations[0].amount)).toBe("300");
    expect(str((await load(inv.id)).amountPaid)).toBe("300");
  });

  it("refuses what doesn't fit, and saves nothing", async () => {
    const c = await makeClient();
    const inv = await issued(c.id);
    const before = await db.payment.count();
    await expect(pay(c.id, { amount: "2000", allocations: [{ invoiceId: inv.id, amount: "1181", tdsAmount: "" }] })).rejects.toThrow(/left to pay/);
    await expect(pay(c.id, { amount: "1000", tdsAmount: "181", allocations: [{ invoiceId: inv.id, amount: "1000", tdsAmount: "181" }] })).rejects.toThrow(/left to pay/);
    await expect(pay(c.id, { amount: "100", allocations: [{ invoiceId: inv.id, amount: "200", tdsAmount: "" }] })).rejects.toThrow(/more than the amount received/);
    await expect(pay(c.id, { amount: "100", tdsAmount: "10" })).rejects.toThrow(/TDS/);
    await expect(pay(c.id, { date: addDaysKey(TODAY, 1) })).rejects.toThrow(/future/);
    expect(await db.payment.count()).toBe(before);
    expect(str((await load(inv.id)).amountPaid)).toBe("0");
  });

  it("only this client's issued tax invoices can take money", async () => {
    const c = await makeClient();
    const someoneElses = await issued((await makeClient()).id);
    await expect(pay(c.id, { allocations: [{ invoiceId: someoneElses.id, amount: "100", tdsAmount: "" }] })).rejects.toThrow(/isn't one of this client's/);
    const d = await draft(c.id);
    await expect(pay(c.id, { allocations: [{ invoiceId: d.id, amount: "100", tdsAmount: "" }] })).rejects.toThrow(/can't take a payment/);
    const proforma = await issued(c.id, { type: "PROFORMA" });
    await expect(pay(c.id, { allocations: [{ invoiceId: proforma.id, amount: "100", tdsAmount: "" }] })).rejects.toThrow(/can't take a payment/);
  });

  it("two payments racing for the last of a balance can't overpay it", async () => {
    const c = await makeClient();
    const inv = await issued(c.id);
    const results = await Promise.allSettled([1, 2, 3].map(() => pay(c.id, { amount: "1000", allocations: [{ invoiceId: inv.id, amount: "1000", tdsAmount: "" }] })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(str((await load(inv.id)).amountPaid)).toBe("1000");
  });

  it("warns on the same reference and amount, unless you confirm", async () => {
    const c = await makeClient();
    await pay(c.id, { amount: "500", reference: "UTR1" });
    await expect(pay(c.id, { amount: "500", reference: "UTR1" })).rejects.toThrow(/already recorded/);
    expect((await pay(c.id, { amount: "500", reference: "UTR1", allowDuplicate: true })).id).toBeTruthy();
    expect((await pay(c.id, { amount: "600", reference: "UTR1" })).id).toBeTruthy();
  });

  it("removing a payment from an invoice makes it an advance, and clears its TDS", async () => {
    const c = await makeClient();
    const inv = await issued(c.id);
    const p = await pay(c.id, { amount: "1000", tdsAmount: "100", allocations: [{ invoiceId: inv.id, amount: "1000", tdsAmount: "100" }] });
    await removeAllocation(db, { paymentId: p.id, invoiceId: inv.id }, actor);
    const row = await load(inv.id);
    expect([str(row.amountPaid), str(row.tdsTotal), str(row.balanceDue), row.paymentStatus]).toEqual(["0", "0", "1180", "UNPAID"]);
    expect(str((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).tdsAmount)).toBe("0");
  });

  it("voiding keeps the record and puts the balance back", async () => {
    const c = await makeClient();
    const inv = await issued(c.id);
    const p = await pay(c.id, { allocations: [{ invoiceId: inv.id, amount: "1180", tdsAmount: "" }] });
    expect((await load(inv.id)).paymentStatus).toBe("PAID");
    await voidPayment(db, p.id, "Cheque bounced", actor);
    const row = await load(inv.id);
    expect([str(row.balanceDue), row.paymentStatus]).toEqual(["1180", "UNPAID"]);
    const voided = await db.payment.findUniqueOrThrow({ where: { id: p.id }, include: { allocations: true } });
    expect(voided.voidReason).toBe("Cheque bounced");
    expect(voided.allocations).toHaveLength(1);
    await expect(voidPayment(db, p.id, "Again", actor)).rejects.toThrow(/already void/);
    await expect(applyAdvance(db, { paymentId: p.id, invoiceId: inv.id, amount: "1" }, actor)).rejects.toThrow(/no longer exists/);
  });
});

describe("overdue", () => {
  it("unpaid and part-paid invoices turn Overdue after the due date, not on it", async () => {
    const c = await makeClient();
    const inv = await issued(c.id, { invoiceDate: addDaysKey(TODAY, -20), dueDate: addDaysKey(TODAY, -1) });
    expect(inv.paymentStatus).toBe("OVERDUE");
    const dueToday = await issued(c.id, { dueDate: TODAY });
    expect(dueToday.paymentStatus).toBe("UNPAID");
    const later = addDaysKey(TODAY, 1);
    expect(await markOverdueInvoices(db, later)).toBeGreaterThanOrEqual(1);
    expect((await load(dueToday.id)).paymentStatus).toBe("OVERDUE");
    await markOverdueInvoices(db, later);
    const paid = await issued(c.id, { dueDate: TODAY });
    await pay(c.id, { allocations: [{ invoiceId: paid.id, amount: "1180", tdsAmount: "" }] });
    await markOverdueInvoices(db, later);
    expect((await load(paid.id)).paymentStatus).toBe("PAID");
  });
  it("paying an overdue invoice in part keeps it Overdue", async () => {
    const c = await makeClient();
    const inv = await issued(c.id, { invoiceDate: addDaysKey(TODAY, -20), dueDate: addDaysKey(TODAY, -1) });
    await pay(c.id, { amount: "100", allocations: [{ invoiceId: inv.id, amount: "100", tdsAmount: "" }] });
    expect((await load(inv.id)).paymentStatus).toBe("OVERDUE");
  });
});

describe("credit notes", () => {
  it("a full credit equals the total, even with round-off", async () => {
    const c = await makeClient();
    const inv = await issued(c.id, { items: [{ description: "Odd", sacCode: SAC, quantity: "1", rate: "999.99", gstRate: "18" }] });
    expect(str(inv.roundOff)).not.toBe("0");
    const item = await db.invoiceItem.findFirstOrThrow({ where: { invoiceId: inv.id } });
    const note = await createCreditNote(db, { invoiceId: inv.id, date: TODAY, reason: "Full refund", lines: [{ itemId: item.id, taxable: "999.99" }] }, actor);
    expect(str(note.totalAmount)).toBe(str(inv.grandTotal));
    expect(note.number).toMatch(/^REZ\/CN\//);
    const row = await load(inv.id);
    expect([str(row.balanceDue), row.paymentStatus]).toEqual(["0", "PAID"]);
  });
  it("uses the invoice's tax type, line by line", async () => {
    const c = await makeClient("29");
    const inv = await issued(c.id);
    const item = await db.invoiceItem.findFirstOrThrow({ where: { invoiceId: inv.id } });
    const note = await createCreditNote(db, { invoiceId: inv.id, date: TODAY, reason: "Part", lines: [{ itemId: item.id, taxable: "100" }] }, actor);
    expect([str(note.igstAmount), str(note.cgstAmount), str(note.totalAmount)]).toEqual(["18", "0", "118"]);
    expect((note.lines as { itemId: string; taxable: string }[])[0]).toMatchObject({ itemId: item.id, taxable: "100.00" });
  });
  it("can't credit more than a line has left, or more than is unpaid", async () => {
    const c = await makeClient();
    const inv = await issued(c.id);
    const item = await db.invoiceItem.findFirstOrThrow({ where: { invoiceId: inv.id } });
    await createCreditNote(db, { invoiceId: inv.id, date: TODAY, reason: "First", lines: [{ itemId: item.id, taxable: "600" }] }, actor);
    await expect(createCreditNote(db, { invoiceId: inv.id, date: TODAY, reason: "Too much", lines: [{ itemId: item.id, taxable: "401" }] }, actor)).rejects.toThrow(/left to credit/);
    await pay(c.id, { amount: "300", allocations: [{ invoiceId: inv.id, amount: "300", tdsAmount: "" }] });
    await expect(createCreditNote(db, { invoiceId: inv.id, date: TODAY, reason: "Paid already", lines: [{ itemId: item.id, taxable: "400" }] }, actor)).rejects.toThrow(/Remove the payment/);
  });
  it("needs a real amount, a sensible date, and an issued tax invoice", async () => {
    const c = await makeClient();
    const inv = await issued(c.id, { invoiceDate: addDaysKey(TODAY, -5), dueDate: TODAY });
    const item = await db.invoiceItem.findFirstOrThrow({ where: { invoiceId: inv.id } });
    const note = (over: object) => createCreditNote(db, { invoiceId: inv.id, date: TODAY, reason: "X reason", lines: [{ itemId: item.id, taxable: "10" }], ...over }, actor);
    await expect(note({ lines: [{ itemId: item.id, taxable: "" }] })).rejects.toThrow(/at least one line/);
    await expect(note({ date: addDaysKey(TODAY, 1) })).rejects.toThrow(/future/);
    await expect(note({ date: addDaysKey(TODAY, -6) })).rejects.toThrow(/before the invoice date/);
    const d = await draft(c.id);
    await expect(createCreditNote(db, { invoiceId: d.id, date: TODAY, reason: "Draft", lines: [] }, actor)).rejects.toThrow(/issued tax invoice/);
  });
});

describe("proforma and advances", () => {
  it("converts to a tax invoice with its own number; the proforma stays on record", async () => {
    const c = await makeClient();
    const proforma = await issued(c.id, { type: "PROFORMA" });
    expect(proforma.number).toMatch(/REZ\/PI\//);
    const tax = await convertProforma(db, proforma.id, TODAY, actor);
    expect(tax.number).toMatch(/REZ\/INV\//);
    expect([tax.type, tax.status, tax.convertedFromId, str(tax.grandTotal)]).toEqual(["TAX", "ISSUED", proforma.id, "1180"]);
    expect((await load(proforma.id)).status).toBe("CONVERTED");
    await expect(convertProforma(db, proforma.id, TODAY, actor)).rejects.toThrow(/Only an issued proforma/);
  });
  it("conversion is blocked by the same GST checks", async () => {
    const c = await makeClient();
    const proforma = await issued(c.id, { type: "PROFORMA", items: [{ description: "No SAC", sacCode: "", quantity: "1", rate: "100", gstRate: "18" }] });
    await expect(convertProforma(db, proforma.id, TODAY, actor)).rejects.toThrow(/SAC code/);
    expect((await load(proforma.id)).status).toBe("ISSUED");
  });
  it("an advance can convert the proforma, dated the day the money came, and pay it", async () => {
    const c = await makeClient();
    const proforma = await issued(c.id, { type: "PROFORMA", invoiceDate: addDaysKey(TODAY, -10), dueDate: TODAY });
    const paidOn = addDaysKey(TODAY, -3);
    const p = await pay(c.id, { amount: "500", date: paidOn });
    const tax = await convertAndApplyAdvance(db, { proformaId: proforma.id, paymentId: p.id }, actor);
    const row = await load(tax.id);
    expect(row.invoiceDate.toISOString().slice(0, 10)).toBe(paidOn);
    expect([str(row.amountPaid), str(row.balanceDue), row.paymentStatus]).toEqual(["500", "680", "PARTIALLY_PAID"]);
  });
  it("an advance bigger than the invoice leaves the rest as advance", async () => {
    const c = await makeClient();
    const proforma = await issued(c.id, { type: "PROFORMA" });
    const p = await pay(c.id, { amount: "2000" });
    const tax = await convertAndApplyAdvance(db, { proformaId: proforma.id, paymentId: p.id }, actor);
    expect((await load(tax.id)).paymentStatus).toBe("PAID");
    const allocations = await db.paymentAllocation.findMany({ where: { paymentId: p.id } });
    expect(str(allocations[0].amount)).toBe("1180");
  });
  it("won't use another client's money, and leaves nothing half-done if it can't convert", async () => {
    const c = await makeClient();
    const proforma = await issued(c.id, { type: "PROFORMA" });
    const elsewhere = await pay((await makeClient()).id, { amount: "100" });
    await expect(convertAndApplyAdvance(db, { proformaId: proforma.id, paymentId: elsewhere.id }, actor)).rejects.toThrow(/another client/);
    expect((await load(proforma.id)).status).toBe("ISSUED");
    await db.settings.update({ where: { id: "agency" }, data: { gstin: null } });
    const mine = await pay(c.id, { amount: "100" });
    await expect(convertAndApplyAdvance(db, { proformaId: proforma.id, paymentId: mine.id }, actor)).rejects.toThrow(/GSTIN/);
    expect((await load(proforma.id)).status).toBe("ISSUED");
    expect(await db.paymentAllocation.count({ where: { paymentId: mine.id } })).toBe(0);
  });
});

describe("drafts from existing work", () => {
  it("a milestone bills its share of one-time work, GST on top, retainers left out", async () => {
    const p = await project([webItem, retainerItem], { milestones: [{ name: "Design", dueDate: "", paymentPercent: "50" }, { name: "Launch", dueDate: "", paymentPercent: "50" }] });
    const milestones = await db.milestone.findMany({ where: { projectId: p.id }, orderBy: { sortOrder: "asc" } });
    expect(str(milestones[0].amount!)).toBe("50000");
    const inv = await createMilestoneDraft(db, milestones[0].id, actor);
    expect([inv.source, inv.status, inv.milestoneId, str(inv.taxableTotal), str(inv.grandTotal)]).toEqual(["MILESTONE", "DRAFT", milestones[0].id, "50000", "59000"]);
    const items = await db.invoiceItem.findMany({ where: { invoiceId: inv.id } });
    expect(items[0].description).toBe("Website: Design (50%)");
    expect(items[0].sacCode).toBe(SAC);
    await expect(createMilestoneDraft(db, milestones[0].id, actor)).rejects.toThrow(/already has an invoice/);
    await discardDraft(db, inv.id, actor);
    expect((await createMilestoneDraft(db, milestones[0].id, actor)).id).not.toBe(inv.id);
  });
  it("no percentage, nothing to bill", async () => {
    const p = await project([webItem], { milestones: [{ name: "Design", dueDate: "", paymentPercent: "" }] });
    const m = await db.milestone.findFirstOrThrow({ where: { projectId: p.id } });
    await expect(createMilestoneDraft(db, m.id, actor)).rejects.toThrow(/payment %/);
  });
  it("a project's one-time work is drafted once, and not if it bills by milestone", async () => {
    const plain = await project([webItem, retainerItem]);
    const inv = await createProjectDraft(db, plain.id, actor);
    expect([inv.source, str(inv.taxableTotal)]).toEqual(["PROJECT", "100000"]);
    expect((await createProjectDraft(db, plain.id, actor)).id).toBe(inv.id);
    const staged = await project([webItem], { milestones: [{ name: "A", dueDate: "", paymentPercent: "100" }] });
    await expect(createProjectDraft(db, staged.id, actor)).rejects.toThrow(/bills by milestone/);
  });
  it("a retainer month is drafted once, and honours no-GST offers", async () => {
    const p = await project([retainerItem]);
    const inv = await createRetainerDraft(db, p.id, MONTH, actor);
    expect([inv.source, inv.retainerMonth, inv.status, str(inv.grandTotal)]).toEqual(["RETAINER_MONTH", MONTH, "DRAFT", "23600"]);
    expect((await createRetainerDraft(db, p.id, MONTH, actor)).id).toBe(inv.id);
    expect(await db.invoice.count({ where: { projectId: p.id } })).toBe(1);
    const noGst = await project([retainerItem], {}, false);
    expect((await createRetainerDraft(db, noGst.id, MONTH, actor)).taxMode).toBe("NO_GST");
  });
  it("change requests go on one draft and come off if it's discarded", async () => {
    const p = await project([webItem]);
    const yes = await createChangeRequest(db, { projectId: p.id, deliverableId: "", description: "Extra banner", estimate: "5000", isBillable: true }, actor);
    const pending = await createChangeRequest(db, { projectId: p.id, deliverableId: "", description: "Maybe", estimate: "100", isBillable: true }, actor);
    await decideChangeRequest(db, yes.id, "APPROVED", actor);
    await expect(createChangeRequestDraft(db, { projectId: p.id, ids: [pending.id] }, actor)).rejects.toThrow(/approved, billable/);
    const inv = await createChangeRequestDraft(db, { projectId: p.id, ids: [yes.id, pending.id] }, actor);
    expect(str(inv.taxableTotal)).toBe("5000");
    const row = await db.changeRequest.findUniqueOrThrow({ where: { id: yes.id } });
    expect(row.status).toBe("INVOICED");
    expect(row.invoiceItemId).toBeTruthy();
    await expect(createChangeRequestDraft(db, { projectId: p.id, ids: [yes.id] }, actor)).rejects.toThrow(/approved, billable/);
    await discardDraft(db, inv.id, actor);
    const released = await db.changeRequest.findUniqueOrThrow({ where: { id: yes.id } });
    expect([released.status, released.invoiceItemId]).toEqual(["APPROVED", null]);
  });
});

describe("the daily job", () => {
  const assetInput = (clientId: string, days: number, over: Record<string, unknown> = {}) =>
    assetSchema.parse({ clientId, kind: "DOMAIN", name: `site${Math.random()}.in`, provider: "", plan: "", purchaseDate: "", expiryDate: addDaysKey(TODAY, days), autoRenew: false, costPrice: "500", renewalPrice: "1200", credentialsLocation: "", accountsCount: "", notes: "", ...over });

  it("drafts each retainer month once, for review: never issued or sent", async () => {
    const p = await project([retainerItem], {});
    await db.project.update({ where: { id: p.id }, data: { status: "ACTIVE", retainerTaskDay: 1 } });
    const first = await runInvoiceJob(db, TODAY);
    expect(first.drafts).toBeGreaterThanOrEqual(1);
    const rows = await db.invoice.findMany({ where: { projectId: p.id } });
    expect(rows).toHaveLength(1);
    expect([rows[0].status, rows[0].number, rows[0].retainerMonth]).toEqual(["DRAFT", null, MONTH]);
    expect(await db.notification.count({ where: { href: `/invoices/${rows[0].id}` } })).toBeGreaterThan(0);
    await runInvoiceJob(db, TODAY);
    expect(await db.invoice.count({ where: { projectId: p.id } })).toBe(1);
  });

  it("a discarded retainer draft isn't made again the same month", async () => {
    const p = await project([retainerItem]);
    await db.project.update({ where: { id: p.id }, data: { status: "ACTIVE", retainerTaskDay: 1 } });
    await runInvoiceJob(db, TODAY);
    const inv = await db.invoice.findFirstOrThrow({ where: { projectId: p.id } });
    await discardDraft(db, inv.id, actor);
    await runInvoiceJob(db, TODAY);
    expect(await db.invoice.count({ where: { projectId: p.id, status: { not: "CANCELLED" } } })).toBe(0);
  });

  it("waits for the retainer's day, and stops after it ends", async () => {
    const waiting = await project([retainerItem]);
    const day = Number(TODAY.slice(8, 10));
    await db.project.update({ where: { id: waiting.id }, data: { status: "ACTIVE", retainerTaskDay: day + 1 } });
    await runInvoiceJob(db, TODAY);
    expect(await db.invoice.count({ where: { projectId: waiting.id } })).toBe(0);
    const ended = await project([retainerItem]);
    await db.project.update({ where: { id: ended.id }, data: { status: "ACTIVE", retainerStart: keyToDate(addDaysKey(TODAY, -200)), retainerEnd: keyToDate(addDaysKey(TODAY, -60)) } });
    await runInvoiceJob(db, TODAY);
    expect(await db.invoice.count({ where: { projectId: ended.id } })).toBe(0);
  });

  it("drafts a renewal 30 days before expiry, once, and again after it's renewed", async () => {
    const c = await makeClient();
    const inside = await saveAsset(db, null, assetInput(c.id, 30), actor);
    const outside = await saveAsset(db, null, assetInput(c.id, 31), actor);
    const free = await saveAsset(db, null, assetInput(c.id, 10, { renewalPrice: "0" }), actor);
    await runInvoiceJob(db, TODAY);
    await runInvoiceJob(db, TODAY);
    const rows = await db.invoice.findMany({ where: { assetId: inside.id } });
    expect(rows).toHaveLength(1);
    expect([rows[0].source, rows[0].status, str(rows[0].taxableTotal)]).toEqual(["RENEWAL", "DRAFT", "1200"]);
    expect(await db.invoice.count({ where: { assetId: { in: [outside.id, free.id] } } })).toBe(0);
    await db.domainHostingAsset.update({ where: { id: inside.id }, data: { expiryDate: keyToDate(addDaysKey(TODAY, 25)) } });
    await db.invoice.update({ where: { id: rows[0].id }, data: { invoiceDate: keyToDate(addDaysKey(TODAY, -400)), dueDate: keyToDate(addDaysKey(TODAY, -390)) } });
    await runInvoiceJob(db, TODAY);
    expect(await db.invoice.count({ where: { assetId: inside.id } })).toBe(2);
  });

  it("the button opens the same renewal draft as the job", async () => {
    const c = await makeClient();
    const asset = await saveAsset(db, null, assetInput(c.id, 90), actor);
    const inv = await createRenewalDraft(db, asset.id, actor);
    expect((await createRenewalDraft(db, asset.id, actor)).id).toBe(inv.id);
    const noPrice = await saveAsset(db, null, assetInput(c.id, 90, { renewalPrice: "0" }), actor);
    await expect(createRenewalDraft(db, noPrice.id, actor)).rejects.toThrow(/renewal price/);
  });

  it("runs as part of daily work and marks overdue invoices", async () => {
    const c = await makeClient();
    const inv = await issued(c.id, { invoiceDate: addDaysKey(TODAY, -9), dueDate: TODAY });
    const result = await runDailyWork(db, addDaysKey(TODAY, 1));
    expect(result.overdueInvoices).toBeGreaterThanOrEqual(1);
    expect((await load(inv.id)).paymentStatus).toBe("OVERDUE");
  });
});

describe("statement of account", () => {
  it("matches what's owed, and leaves out proformas, drafts, cancelled and void", async () => {
    const c = await makeClient();
    const inv = await issued(c.id);
    const second = await issued(c.id);
    await issued(c.id, { type: "PROFORMA" });
    await draft(c.id);
    const gone = await issued(c.id);
    await cancelInvoice(db, gone.id, "Mistake", actor);
    await pay(c.id, { amount: "1000", tdsAmount: "100", allocations: [{ invoiceId: inv.id, amount: "1000", tdsAmount: "100" }] });
    const bounced = await pay(c.id, { amount: "500" });
    await voidPayment(db, bounced.id, "Bounced", actor);
    const item = await db.invoiceItem.findFirstOrThrow({ where: { invoiceId: second.id } });
    await createCreditNote(db, { invoiceId: second.id, date: TODAY, reason: "Discount", lines: [{ itemId: item.id, taxable: "100" }] }, actor);

    const ledger = await clientLedger(db, c.id, addDaysKey(TODAY, -1), TODAY);
    expect(str(ledger.totalDebit)).toBe("2360");
    expect(str(ledger.totalCredit)).toBe("1218");
    const open = await db.invoice.aggregate({ where: { clientId: c.id, type: "TAX", status: "ISSUED" }, _sum: { balanceDue: true } });
    expect(str(ledger.closing)).toBe(str(open._sum.balanceDue!));
  });
  it("an unapplied advance shows as a credit balance", async () => {
    const c = await makeClient();
    await pay(c.id, { amount: "500" });
    expect(str((await clientLedger(db, c.id, TODAY, TODAY)).closing)).toBe("-500");
  });
});
