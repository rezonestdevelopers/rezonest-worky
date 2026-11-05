import { describe, expect, it } from "vitest";
import { canEdit, canRevise, isOpen, publicResponseError, statusChangeError } from "@/lib/offer-status";
import { buildOfferDocument, type OfferDocInput } from "@/lib/offer-document";
import { hashPublicToken, looksLikeToken, publicToken } from "@/lib/public-token";
import { offerSchema, publicAcceptSchema, publicChangesSchema, templateSchema } from "@/lib/validators/offer";

const base = { todayKey: "2026-11-03", validUntilKey: "2026-11-20", followUpKey: "2026-11-06" };

describe("offer status flow", () => {
  it("allows the normal path", () => {
    expect(statusChangeError({ ...base, from: "DRAFT", to: "SENT" })).toBeNull();
    expect(statusChangeError({ ...base, from: "SENT", to: "ON_HOLD" })).toBeNull();
    expect(statusChangeError({ ...base, from: "ON_HOLD", to: "SENT" })).toBeNull();
    expect(statusChangeError({ ...base, from: "SENT", to: "ACCEPTED", acceptedByName: "Asha" })).toBeNull();
    expect(statusChangeError({ ...base, from: "ON_HOLD", to: "REJECTED", rejectReason: "Too costly" })).toBeNull();
  });
  it("blocks skipping steps and reopening closed offers", () => {
    expect(statusChangeError({ ...base, from: "DRAFT", to: "ACCEPTED", acceptedByName: "Asha" })).toMatch(/can't be changed/);
    for (const from of ["ACCEPTED", "REJECTED", "EXPIRED"] as const) expect(statusChangeError({ ...base, from, to: "SENT" })).toMatch(/can't be changed/);
    expect(statusChangeError({ ...base, from: "SENT", to: "SENT" })).toMatch(/already/);
  });
  it("Sent and On Hold need a follow-up date that isn't past", () => {
    expect(statusChangeError({ ...base, followUpKey: null, from: "DRAFT", to: "SENT" })).toMatch(/follow-up/);
    expect(statusChangeError({ ...base, followUpKey: null, from: "SENT", to: "ON_HOLD" })).toMatch(/follow-up/);
    expect(statusChangeError({ ...base, followUpKey: "2026-11-02", from: "DRAFT", to: "SENT" })).toMatch(/past/);
    expect(statusChangeError({ ...base, followUpKey: "2026-11-03", from: "DRAFT", to: "SENT" })).toBeNull();
  });
  it("can't send once validity has passed", () => {
    expect(statusChangeError({ ...base, validUntilKey: "2026-11-02", from: "DRAFT", to: "SENT" })).toMatch(/validity/);
    expect(statusChangeError({ ...base, validUntilKey: "2026-11-03", from: "DRAFT", to: "SENT" })).toBeNull();
  });
  it("rejection needs a reason; acceptance needs a name", () => {
    expect(statusChangeError({ ...base, from: "SENT", to: "REJECTED", rejectReason: " " })).toMatch(/reason/);
    expect(statusChangeError({ ...base, from: "SENT", to: "ACCEPTED" })).toMatch(/who accepted/);
  });
  it("only drafts edit directly; accepted offers can't be revised", () => {
    expect(canEdit("DRAFT")).toBe(true);
    expect(canEdit("SENT")).toBe(false);
    expect(canRevise("ACCEPTED")).toBe(false);
    expect(canRevise("DRAFT")).toBe(false);
    for (const s of ["SENT", "ON_HOLD", "REJECTED", "EXPIRED"] as const) expect(canRevise(s)).toBe(true);
    expect(isOpen("SENT") && isOpen("ON_HOLD") && !isOpen("DRAFT")).toBe(true);
  });
});

describe("what the client's link allows", () => {
  const open = { status: "SENT" as const, todayKey: "2026-11-03", validUntilKey: "2026-11-20", revoked: false, linkExpired: false };
  it("open offers can be answered, including on the last valid day", () => {
    expect(publicResponseError(open)).toBeNull();
    expect(publicResponseError({ ...open, status: "ON_HOLD" })).toBeNull();
    expect(publicResponseError({ ...open, validUntilKey: "2026-11-03" })).toBeNull();
  });
  it("past validity, revoked, closed or draft offers can't", () => {
    expect(publicResponseError({ ...open, validUntilKey: "2026-11-02" })).toMatch(/validity/);
    expect(publicResponseError({ ...open, linkExpired: true })).toMatch(/validity/);
    expect(publicResponseError({ ...open, revoked: true })).toMatch(/no longer valid/);
    expect(publicResponseError({ ...open, status: "ACCEPTED" })).toMatch(/already been accepted/);
    for (const status of ["DRAFT", "REJECTED", "EXPIRED"] as const) expect(publicResponseError({ ...open, status })).toMatch(/no longer open/);
  });
});

describe("client link tokens", () => {
  process.env.AUTH_SECRET ??= "test-only-secret";
  it("are long, stable, and different for each link", () => {
    const a = publicToken("link-a");
    expect(a).toHaveLength(43);
    expect(looksLikeToken(a)).toBe(true);
    expect(publicToken("link-a")).toBe(a);
    expect(publicToken("link-b")).not.toBe(a);
  });
  it("depend on the server secret", () => {
    const original = process.env.AUTH_SECRET;
    const a = publicToken("link-a");
    process.env.AUTH_SECRET = "another-secret";
    expect(publicToken("link-a")).not.toBe(a);
    process.env.AUTH_SECRET = original;
  });
  it("the stored hash isn't the token", () => expect(hashPublicToken("abc")).not.toContain("abc"));
  it("rejects junk before any database work", () => {
    for (const bad of ["", "short", "x".repeat(44), "../../etc/passwd", "a b".repeat(14)]) expect(looksLikeToken(bad)).toBe(false);
  });
});

const item = { description: "Social media", billingType: "MONTHLY_RETAINER" as const, quantity: "1", unit: "month", rate: "25000", gstRate: "18" };
const offer = { clientId: "client1", leadId: "", title: "Retainer", offerDate: "2026-11-03", validUntil: "2026-11-18", gstEnabled: true, items: [item], milestones: [] };

describe("offer form rules", () => {
  it("accepts a normal offer", () => expect(offerSchema.safeParse(offer).success).toBe(true));
  it("needs exactly one recipient", () => {
    expect(offerSchema.safeParse({ ...offer, clientId: "" }).success).toBe(false);
    expect(offerSchema.safeParse({ ...offer, leadId: "lead1" }).success).toBe(false);
    expect(offerSchema.safeParse({ ...offer, clientId: "", leadId: "lead1" }).success).toBe(true);
  });
  it("needs an item, and valid-until not before the date", () => {
    expect(offerSchema.safeParse({ ...offer, items: [] }).success).toBe(false);
    expect(offerSchema.safeParse({ ...offer, validUntil: "2026-11-01" }).success).toBe(false);
  });
  it("checks each item", () => {
    expect(offerSchema.safeParse({ ...offer, items: [{ ...item, quantity: "0" }] }).success).toBe(false);
    expect(offerSchema.safeParse({ ...offer, items: [{ ...item, rate: "abc" }] }).success).toBe(false);
    expect(offerSchema.safeParse({ ...offer, items: [{ ...item, gstRate: "40" }] }).success).toBe(false);
    expect(offerSchema.safeParse({ ...offer, items: [{ ...item, discountType: "PERCENT", discountValue: "120" }] }).success).toBe(false);
    expect(offerSchema.safeParse({ ...offer, items: [{ ...item, discountType: "AMOUNT", discountValue: "25001" }] }).success).toBe(false);
    expect(offerSchema.safeParse({ ...offer, items: [{ ...item, discountType: "AMOUNT", discountValue: "25000" }] }).success).toBe(true);
  });
  it("drops empty package rows, keeps the rest", () => {
    const parsed = offerSchema.parse({ ...offer, items: [{ ...item, deliverables: [{ format: "REEL", qtyPerMonth: "8" }, { format: "STORY", qtyPerMonth: "0" }] }] });
    expect(parsed.items[0].deliverables).toEqual([{ format: "REEL", qtyPerMonth: 8 }]);
  });
  it("milestones must total exactly 100%, without decimal drift", () => {
    const m = (...p: string[]) => p.map((percent, i) => ({ name: `M${i}`, percent }));
    expect(offerSchema.safeParse({ ...offer, milestones: m("50", "30", "20") }).success).toBe(true);
    expect(offerSchema.safeParse({ ...offer, milestones: m("33.33", "33.33", "33.34") }).success).toBe(true);
    expect(offerSchema.safeParse({ ...offer, milestones: m("10.10", "20.20", "69.70") }).success).toBe(true);
    const bad = offerSchema.safeParse({ ...offer, milestones: m("50", "30") });
    expect(bad.error?.issues[0].message).toMatch(/add up to 80%/);
  });
  it("templates need a name but no recipient", () => {
    const rest = { title: offer.title, offerDate: offer.offerDate, validUntil: offer.validUntil, gstEnabled: true, items: [item], milestones: [] };
    expect(templateSchema.safeParse({ ...rest, templateName: "Starter" }).success).toBe(true);
    expect(templateSchema.safeParse(rest).success).toBe(false);
  });
  it("client acceptance needs a name and the tick", () => {
    expect(publicAcceptSchema.safeParse({ token: "x", name: "Asha", agreed: true }).success).toBe(true);
    expect(publicAcceptSchema.safeParse({ token: "x", name: "Asha", agreed: false }).success).toBe(false);
    expect(publicAcceptSchema.safeParse({ token: "x", name: " ", agreed: true }).success).toBe(false);
    expect(publicChangesSchema.safeParse({ token: "x", name: "Asha", comment: "no" }).success).toBe(false);
  });
});

const docInput = (over: Partial<OfferDocInput> = {}): OfferDocInput => ({
  number: "REZ/QT/2026-27/0001", title: "Retainer", version: 1, offerDate: "2026-11-03", validUntil: "2026-11-18", taxMode: "INTRA_STATE",
  recipient: { name: "Client" }, agency: { name: "Rezonest", address: "Bhosari", state: "Maharashtra" },
  items: [{ description: "SMM", billingType: "MONTHLY_RETAINER", quantity: 1, unit: "month", rate: "25000", gstRate: 18 }], milestones: [], ...over,
});
const row = (doc: ReturnType<typeof buildOfferDocument>, label: string) => doc.summary.find((s) => s.label === label)?.value;

describe("the printed offer", () => {
  it("same state: CGST + SGST, and words", () => {
    const doc = buildOfferDocument(docInput());
    expect(row(doc, "CGST")).toBe("₹2,250.00");
    expect(row(doc, "SGST")).toBe("₹2,250.00");
    expect(row(doc, "IGST")).toBeUndefined();
    expect(doc.grandTotal).toBe("₹29,500.00");
    expect(doc.amountInWords).toBe("Rupees Twenty-Nine Thousand Five Hundred Only");
  });
  it("other state: IGST", () => {
    const doc = buildOfferDocument(docInput({ taxMode: "INTER_STATE" }));
    expect(row(doc, "IGST")).toBe("₹4,500.00");
    expect(row(doc, "CGST")).toBeUndefined();
    expect(doc.grandTotal).toBe("₹29,500.00");
  });
  it("no GST and export say so, with no tax", () => {
    expect(buildOfferDocument(docInput({ taxMode: "NO_GST" })).grandTotal).toBe("₹25,000.00");
    const exp = buildOfferDocument(docInput({ taxMode: "EXPORT" }));
    expect(exp.grandTotal).toBe("₹25,000.00");
    expect(exp.taxNote).toMatch(/Export/);
    expect(exp.lines[0].gst).toBe("—");
  });
  it("discount is before GST; round-off is shown", () => {
    const doc = buildOfferDocument(docInput({
      items: [{ description: "X", billingType: "ONE_TIME", quantity: 3, unit: "post", rate: "333.33", discountType: "PERCENT", discountValue: 10, gstRate: 18 }],
    }));
    expect(row(doc, "Subtotal")).toBe("₹999.99");
    expect(row(doc, "Discount")).toBe("- ₹100.00");
    expect(row(doc, "Taxable value")).toBe("₹899.99");
    expect(row(doc, "CGST")).toBe("₹81.00");
    expect(row(doc, "Round-off")).toBe("₹0.01");
    expect(doc.grandTotal).toBe("₹1,062.00");
  });
  it("milestones always add up to the one-time work, before GST", () => {
    const doc = buildOfferDocument(docInput({
      items: [{ description: "Website", billingType: "MILESTONE", quantity: 1, unit: "project", rate: "25000", gstRate: 18 }],
      milestones: [{ name: "A", percent: "33.33" }, { name: "B", percent: "33.33" }, { name: "C", percent: "33.34" }],
    }));
    const cents = doc.milestones.map((m) => Math.round(Number(m.amount.replace(/[₹,]/g, "")) * 100));
    expect(cents.reduce((a, b) => a + b, 0)).toBe(2500000);
    expect(doc.milestones[0].amount).toBe("₹8,332.50");
  });
  it("shows package, months and SAC; explains monthly totals", () => {
    const doc = buildOfferDocument(docInput({
      items: [{ description: "SMM", billingType: "MONTHLY_RETAINER", quantity: 1, unit: "month", rate: "1000", gstRate: 18, sacCode: "998361", durationMonths: 6, deliverables: [{ format: "STATIC_POST", qtyPerMonth: 12 }, { format: "REEL", qtyPerMonth: 8 }] }],
    }));
    expect(doc.lines[0].details).toBe("Per month · 6 months · 12 posts + 8 reels per month · SAC 998361");
    expect(doc.retainerNote).toMatch(/The total is the amount for one month/);
    const mixed = buildOfferDocument(docInput({
      items: [
        { description: "SMM", billingType: "MONTHLY_RETAINER", quantity: 1, unit: "month", rate: "1000", gstRate: 18 },
        { description: "Website", billingType: "MILESTONE", quantity: 1, unit: "project", rate: "5000", gstRate: 18 },
      ],
    }));
    expect(mixed.retainerNote).toMatch(/includes one month of those items/);
    expect(buildOfferDocument(docInput({ items: [{ description: "Logo", billingType: "ONE_TIME", quantity: 1, unit: "job", rate: "5000", gstRate: 18 }] })).retainerNote).toBeNull();
  });
});
