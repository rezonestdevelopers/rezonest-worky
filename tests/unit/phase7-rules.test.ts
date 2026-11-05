import { describe, expect, it } from "vitest";
import { buildInvoiceDocument, type InvoiceDocInput } from "@/lib/invoice-document";
import { advanceLeft, ageingKey, allocationError, buildLedger, issueProblems, milestoneAmount, milestoneBase, milestoneLines, paymentModeLabel, statementPeriod, suggestAllocations, upiLink, type LedgerEntry } from "@/lib/invoice-rules";
import { buildOfferDocument, type OfferDocInput } from "@/lib/offer-document";
import { creditNoteSchema, invoiceSchema, paymentSchema } from "@/lib/validators/invoice";

const issueInput = (over: Partial<Parameters<typeof issueProblems>[0]> = {}) => ({
  type: "TAX" as const, taxMode: "INTRA_STATE", agencyGstin: "27ABCDE1234F1Z5", lines: [{ description: "SEO", sacCode: "998361" }], invoiceDateKey: "2026-11-05", todayKey: "2026-11-05", grandTotal: "1180", ...over,
});

describe("what blocks issuing an invoice", () => {
  it("a complete GST tax invoice can be issued", () => {
    expect(issueProblems(issueInput())).toEqual([]);
  });
  it("needs your GSTIN and a SAC code on every line", () => {
    expect(issueProblems(issueInput({ agencyGstin: "" })).join()).toMatch(/GSTIN/);
    expect(issueProblems(issueInput({ agencyGstin: null })).join()).toMatch(/GSTIN/);
    const missing = issueProblems(issueInput({ lines: [{ description: "SEO", sacCode: "998361" }, { description: "Logo", sacCode: " " }] }));
    expect(missing.join()).toMatch(/SAC code to: Logo/);
    expect(missing.join()).not.toMatch(/SEO/);
  });
  it("inter-state is held to the same check", () => {
    expect(issueProblems(issueInput({ taxMode: "INTER_STATE", agencyGstin: "" })).join()).toMatch(/GSTIN/);
  });
  it("no-GST, export and proforma invoices don't need them", () => {
    for (const over of [{ taxMode: "NO_GST" }, { taxMode: "EXPORT" }, { type: "PROFORMA" as const }]) {
      expect(issueProblems(issueInput({ agencyGstin: "", lines: [{ description: "SEO", sacCode: "" }], ...over }))).toEqual([]);
    }
  });
  it("refuses an empty, zero or future-dated invoice", () => {
    expect(issueProblems(issueInput({ lines: [] })).join()).toMatch(/at least one line/);
    expect(issueProblems(issueInput({ grandTotal: 0 })).join()).toMatch(/more than zero/);
    expect(issueProblems(issueInput({ invoiceDateKey: "2026-11-06" })).join()).toMatch(/future/);
  });
});

describe("milestones bill one-time work, before GST", () => {
  const items = [
    { billingType: "MILESTONE", description: "Website", taxableValue: "100000" },
    { billingType: "ONE_TIME", description: "Logo", taxableValue: "20000" },
    { billingType: "MONTHLY_RETAINER", description: "SEO", taxableValue: "15000" },
  ];
  it("leaves retainers out of the base", () => {
    expect(milestoneBase(items).toString()).toBe("120000");
    expect(milestoneAmount(milestoneBase(items), "50").toString()).toBe("60000");
  });
  it("makes one line per one-time item at its share", () => {
    const lines = milestoneLines(items, { name: "Design", percent: "30" });
    expect(lines.map((l) => l.rate.toString())).toEqual(["30000", "6000"]);
    expect(lines[0].description).toBe("Website: Design (30%)");
  });
  it("rounds to paise", () => {
    expect(milestoneAmount("100000", "33.33").toString()).toBe("33330");
    expect(milestoneAmount("1000.55", "33.33").toString()).toBe("333.48");
  });
});

const offerInput = (over: Partial<OfferDocInput>): OfferDocInput => ({
  number: "REZ/QT/2026-27/0001", title: "Work", version: 1, offerDate: "2026-11-03", validUntil: "2026-11-18", taxMode: "INTRA_STATE",
  recipient: { name: "Client" }, agency: { name: "Rezonest", address: "Bhosari", state: "Maharashtra" }, items: [], milestones: [], ...over,
});

describe("the offer shows the same milestone amounts", () => {
  it("a mixed offer's milestones cover only the one-time work", () => {
    const doc = buildOfferDocument(offerInput({
      items: [
        { description: "Website", billingType: "MILESTONE", quantity: 1, unit: "project", rate: "100000", gstRate: 18 },
        { description: "SEO", billingType: "MONTHLY_RETAINER", quantity: 1, unit: "month", rate: "20000", gstRate: 18 },
      ],
      milestones: [{ name: "A", percent: "50" }, { name: "B", percent: "30" }, { name: "C", percent: "20" }],
    }));
    expect(doc.milestones.map((m) => m.amount)).toEqual(["₹50,000.00", "₹30,000.00", "₹20,000.00"]);
  });
});

describe("UPI payment link", () => {
  it("carries the ID, payee, exact amount and invoice number", () => {
    expect(upiLink({ upiId: "rezonest@okhdfcbank", payee: "Rezonest Digital & Services", amount: "1180", note: "REZ/INV/2026-27/0001" })).toBe(
      "upi://pay?pa=rezonest%40okhdfcbank&pn=Rezonest%20Digital%20%26%20Services&am=1180.00&cu=INR&tn=REZ%2FINV%2F2026-27%2F0001",
    );
  });
});

describe("splitting a payment", () => {
  const open = [{ id: "a", balance: "1000" }, { id: "b", balance: "500" }, { id: "c", balance: "200" }];
  it("fills the oldest first, and stops when the money runs out", () => {
    expect(suggestAllocations("1200", open)).toEqual([{ invoiceId: "a", amount: "1000.00" }, { invoiceId: "b", amount: "200.00" }]);
    expect(suggestAllocations("0", open)).toEqual([]);
  });
  it("skips invoices with nothing left", () => {
    expect(suggestAllocations("100", [{ id: "a", balance: "0" }, { id: "b", balance: "500" }])).toEqual([{ invoiceId: "b", amount: "100.00" }]);
  });
  it("what's left over is the advance, without floating-point drift", () => {
    expect(advanceLeft("0.30", [{ amount: "0.10" }, { amount: "0.20" }]).toString()).toBe("0");
    expect(advanceLeft("1000", [{ amount: "250.50" }]).toString()).toBe("749.5");
  });
  it("can't apply more than was received, and all TDS must land on invoices", () => {
    expect(allocationError({ amount: "100", tdsAmount: "0", allocations: [{ amount: "101", tdsAmount: "0" }] })).toMatch(/more than the amount received/);
    expect(allocationError({ amount: "100", tdsAmount: "10", allocations: [{ amount: "100", tdsAmount: "5" }] })).toMatch(/TDS/);
    expect(allocationError({ amount: "100", tdsAmount: "10", allocations: [] })).toMatch(/TDS/);
    expect(allocationError({ amount: "100", tdsAmount: "10", allocations: [{ amount: "60", tdsAmount: "4" }, { amount: "40", tdsAmount: "6" }] })).toBeNull();
    expect(allocationError({ amount: "100", tdsAmount: "0", allocations: [] })).toBeNull();
  });
});

describe("client statement", () => {
  const e = (dateKey: string, kind: LedgerEntry["kind"], debit: number, credit: number, reference = "x"): LedgerEntry => ({ dateKey, kind, reference, description: kind, debit, credit });
  const entries = [
    e("2026-03-01", "INVOICE", 1000, 0),
    e("2026-03-10", "PAYMENT", 0, 400),
    e("2026-04-02", "INVOICE", 2000, 0),
    e("2026-04-05", "PAYMENT", 0, 900),
    e("2026-04-05", "TDS", 0, 100),
    e("2026-04-06", "CREDIT_NOTE", 0, 200),
  ];
  it("earlier entries become the opening balance; the rest run on from it", () => {
    const l = buildLedger(entries, "2026-04-01", "2026-04-30");
    expect(l.opening.toString()).toBe("600");
    expect(l.rows.map((r) => r.balance.toString())).toEqual(["2600", "1700", "1600", "1400"]);
    expect(l.closing.toString()).toBe("1400");
    expect(l.totalDebit.toString()).toBe("2000");
    expect(l.totalCredit.toString()).toBe("1200");
  });
  it("on the same day, the invoice comes before the money", () => {
    const l = buildLedger([e("2026-04-01", "PAYMENT", 0, 100), e("2026-04-01", "INVOICE", 100, 0)], "2026-04-01", "2026-04-30");
    expect(l.rows.map((r) => r.kind)).toEqual(["INVOICE", "PAYMENT"]);
  });
  it("leaves out anything after the period", () => {
    expect(buildLedger(entries, "2026-03-01", "2026-03-31").closing.toString()).toBe("600");
  });
  it("an advance shows as a negative balance", () => {
    expect(buildLedger([e("2026-04-01", "PAYMENT", 0, 500)], "2026-04-01", "2026-04-30").closing.toString()).toBe("-500");
  });
});

describe("statement dates", () => {
  it("default to this financial year", () => {
    expect(statementPeriod(null, null, "2026-11-05")).toEqual({ from: "2026-04-01", to: "2026-11-05" });
    expect(statementPeriod(null, null, "2027-02-10")).toEqual({ from: "2026-04-01", to: "2027-02-10" });
    expect(statementPeriod(null, null, "2026-04-01")).toEqual({ from: "2026-04-01", to: "2026-04-01" });
  });
  it("ignore rubbish, and swap if backwards", () => {
    expect(statementPeriod("abc", "<script>", "2026-11-05")).toEqual({ from: "2026-04-01", to: "2026-11-05" });
    expect(statementPeriod("2026-10-01", "2026-09-01", "2026-11-05")).toEqual({ from: "2026-09-01", to: "2026-10-01" });
  });
});

describe("ageing columns", () => {
  it("sort by days past due", () => {
    expect([-5, 0, 1, 30, 31, 60, 61, 90, 91].map(ageingKey)).toEqual(["notDue", "notDue", "d1_30", "d1_30", "d31_60", "d31_60", "d61_90", "d61_90", "d90"]);
  });
});

describe("payment mode names", () => {
  it("reads the way you say it", () => {
    expect(paymentModeLabel("BANK_TRANSFER")).toBe("NEFT/RTGS/IMPS");
    expect(paymentModeLabel("UPI")).toBe("UPI");
  });
});

const docInput = (over: Partial<InvoiceDocInput> = {}): InvoiceDocInput => ({
  type: "TAX", status: "ISSUED", number: "REZ/INV/2026-27/0001", invoiceDateKey: "2026-11-05", dueDateKey: "2026-11-20", placeOfSupply: "Maharashtra (27)", taxMode: "INTRA_STATE",
  agency: { name: "Rezonest" }, client: { name: "Client" }, bank: {},
  items: [{ description: "SEO", sacCode: "998361", quantity: "2", unit: "month", rate: "1000", discountType: "PERCENT", discountValue: "10", taxableValue: "1800", gstRate: "18", cgstAmount: "162", sgstAmount: "162", igstAmount: "0", lineTotal: "2124" }],
  subtotal: "2000", discountTotal: "200", taxableTotal: "1800", cgstTotal: "162", sgstTotal: "162", igstTotal: "0", roundOff: "0", grandTotal: "2124", amountInWords: "Rupees Two Thousand One Hundred Twenty-Four Only",
  amountPaid: "0", tdsTotal: "0", creditedTotal: "0", balanceDue: "2124", terms: null, notes: null, cancelReason: null, ...over,
});
const label = (d: ReturnType<typeof buildInvoiceDocument>) => d.summary.map((s) => s.label);

describe("the printed invoice", () => {
  it("same state: CGST + SGST at half the rate", () => {
    const d = buildInvoiceDocument(docInput());
    expect(d.title).toBe("TAX INVOICE");
    expect(label(d)).toEqual(["Subtotal", "Discount", "Taxable value", "CGST 9%", "SGST 9%"]);
    expect(d.lines[0]).toMatchObject({ sac: "998361", quantity: "2 month", discount: "10%", taxable: "₹1,800.00", gst: "18%", tax: "₹324.00", total: "₹2,124.00" });
    expect(d.showBalance).toBe(false);
  });
  it("other state: IGST", () => {
    const d = buildInvoiceDocument(docInput({ taxMode: "INTER_STATE", cgstTotal: "0", sgstTotal: "0", igstTotal: "324" }));
    expect(label(d)).toContain("IGST 18%");
    expect(label(d)).not.toContain("CGST 9%");
  });
  it("different rates on one invoice don't claim a single rate", () => {
    const item = docInput().items[0];
    const d = buildInvoiceDocument(docInput({ items: [item, { ...item, gstRate: "12" }] }));
    expect(label(d)).toContain("CGST");
  });
  it("no GST: plain title, no tax rows or columns, and a note", () => {
    const d = buildInvoiceDocument(docInput({ taxMode: "NO_GST" }));
    expect(d.title).toBe("INVOICE");
    expect(d.gst).toBe(false);
    expect(d.lines[0].tax).toBe("");
    expect(d.taxNote).toMatch(/GST not charged/);
    expect(buildInvoiceDocument(docInput({ taxMode: "EXPORT" })).taxNote).toMatch(/Export/);
  });
  it("a proforma says it isn't a tax invoice", () => {
    const d = buildInvoiceDocument(docInput({ type: "PROFORMA" }));
    expect(d.title).toBe("PROFORMA INVOICE");
    expect(d.taxNote).toMatch(/not a tax invoice/);
  });
  it("shows round-off with its sign", () => {
    expect(buildInvoiceDocument(docInput({ roundOff: "0.25" })).summary.at(-1)).toEqual({ label: "Round-off", value: "+₹0.25" });
    expect(buildInvoiceDocument(docInput({ roundOff: "-0.25" })).summary.at(-1)).toEqual({ label: "Round-off", value: "−₹0.25" });
  });
  it("shows what's been settled and the balance", () => {
    const d = buildInvoiceDocument(docInput({ amountPaid: "1000", tdsTotal: "100", creditedTotal: "24", balanceDue: "1000" }));
    expect(d.settled.map((s) => s.label)).toEqual(["Paid", "TDS deducted", "Credit notes"]);
    expect(d.showBalance).toBe(true);
    expect(d.balanceDue).toBe("₹1,000.00");
  });
  it("a draft has no number yet", () => {
    expect(buildInvoiceDocument(docInput({ number: null, status: "DRAFT" })).number).toBe("Draft");
  });
});

const line = { description: "SEO work", sacCode: "998361", quantity: "1", rate: "1000", gstRate: "18" };
const invoice = { clientId: "c1", projectId: "", type: "TAX", gstEnabled: true, invoiceDate: "2026-11-05", dueDate: "2026-11-20", terms: "", notes: "", items: [line] };

describe("invoice form checks", () => {
  it("accepts a good invoice", () => {
    expect(invoiceSchema.safeParse(invoice).success).toBe(true);
  });
  it("cleans Indian-format amounts", () => {
    const parsed = invoiceSchema.parse({ ...invoice, items: [{ ...line, rate: "₹1,25,000.50" }] });
    expect(parsed.items[0].rate).toBe("125000.50");
  });
  it("refuses a due date before the invoice date", () => {
    expect(invoiceSchema.safeParse({ ...invoice, dueDate: "2026-11-01" }).success).toBe(false);
  });
  it("refuses no lines, bad SAC codes, too-large GST, and over-discounting", () => {
    expect(invoiceSchema.safeParse({ ...invoice, items: [] }).success).toBe(false);
    expect(invoiceSchema.safeParse({ ...invoice, items: [{ ...line, sacCode: "12" }] }).success).toBe(false);
    expect(invoiceSchema.safeParse({ ...invoice, items: [{ ...line, sacCode: "99836a" }] }).success).toBe(false);
    expect(invoiceSchema.safeParse({ ...invoice, items: [{ ...line, gstRate: "101" }] }).success).toBe(false);
    expect(invoiceSchema.safeParse({ ...invoice, items: [{ ...line, discountType: "PERCENT", discountValue: "101" }] }).success).toBe(false);
    expect(invoiceSchema.safeParse({ ...invoice, items: [{ ...line, discountType: "AMOUNT", discountValue: "1001" }] }).success).toBe(false);
  });
  it("a SAC code can stay blank on a draft", () => {
    expect(invoiceSchema.parse({ ...invoice, items: [{ ...line, sacCode: "" }] }).items[0].sacCode).toBeNull();
  });
});

describe("payment form checks", () => {
  const pay = { clientId: "c1", date: "2026-11-05", amount: "1000", tdsAmount: "", tdsSection: "", mode: "UPI", reference: "", notes: "", allocations: [] };
  it("accepts money with no invoice: that's an advance", () => {
    expect(paymentSchema.safeParse(pay).success).toBe(true);
  });
  it("refuses a zero payment or a negative amount", () => {
    expect(paymentSchema.safeParse({ ...pay, amount: "0" }).success).toBe(false);
    expect(paymentSchema.safeParse({ ...pay, amount: "-5" }).success).toBe(false);
  });
  it("needs a known payment mode", () => {
    expect(paymentSchema.safeParse({ ...pay, mode: "BITCOIN" }).success).toBe(false);
  });
});

describe("credit note form checks", () => {
  it("needs a reason", () => {
    const note = { invoiceId: "i1", date: "2026-11-05", lines: [{ itemId: "l1", taxable: "100" }] };
    expect(creditNoteSchema.safeParse({ ...note, reason: "" }).success).toBe(false);
    expect(creditNoteSchema.safeParse({ ...note, reason: "Discount agreed" }).success).toBe(true);
  });
});
