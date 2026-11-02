import { describe, expect, it } from "vitest";
import { computeLine, computeTotals, determineTaxMode } from "@/lib/money/gst";

const s = (d: { toFixed(n: number): string }) => d.toFixed(2);

describe("determineTaxMode", () => {
  it("same state (Maharashtra 27) → CGST + SGST", () => {
    expect(determineTaxMode({ gstEnabled: true, agencyStateCode: "27", clientStateCode: "27" })).toBe("INTRA_STATE");
  });
  it("different state (Karnataka 29) → IGST", () => {
    expect(determineTaxMode({ gstEnabled: true, agencyStateCode: "27", clientStateCode: "29" })).toBe("INTER_STATE");
  });
  it("GST switched off → NO_GST", () => {
    expect(determineTaxMode({ gstEnabled: false, agencyStateCode: "27", clientStateCode: "29" })).toBe("NO_GST");
  });
  it("client outside India → EXPORT", () => {
    expect(
      determineTaxMode({ gstEnabled: true, agencyStateCode: "27", clientStateCode: null, clientCountry: "UAE" }),
    ).toBe("EXPORT");
  });
});

describe("computeLine", () => {
  it("intra-state 18%: CGST 9% + SGST 9%", () => {
    const r = computeLine({ quantity: 1, rate: "25000", gstRate: 18 }, "INTRA_STATE");
    expect(s(r.taxable)).toBe("25000.00");
    expect(s(r.cgst)).toBe("2250.00");
    expect(s(r.sgst)).toBe("2250.00");
    expect(s(r.igst)).toBe("0.00");
    expect(s(r.total)).toBe("29500.00");
  });

  it("inter-state 18%: IGST 18%", () => {
    const r = computeLine({ quantity: 1, rate: "25000", gstRate: 18 }, "INTER_STATE");
    expect(s(r.igst)).toBe("4500.00");
    expect(s(r.cgst)).toBe("0.00");
    expect(s(r.total)).toBe("29500.00");
  });

  it("percent discount is applied before GST", () => {
    const r = computeLine(
      { quantity: 12, rate: "1500", discountType: "PERCENT", discountValue: 10, gstRate: 18 },
      "INTRA_STATE",
    );
    expect(s(r.gross)).toBe("18000.00");
    expect(s(r.discount)).toBe("1800.00");
    expect(s(r.taxable)).toBe("16200.00");
    expect(s(r.cgst)).toBe("1458.00");
    expect(s(r.total)).toBe("19116.00");
  });

  it("amount discount", () => {
    const r = computeLine({ quantity: 1, rate: "10000", discountType: "AMOUNT", discountValue: 500, gstRate: 18 }, "INTER_STATE");
    expect(s(r.taxable)).toBe("9500.00");
    expect(s(r.igst)).toBe("1710.00");
  });

  it("rounds each tax component half-up to paise and keeps CGST = SGST", () => {
    // 333.33 × 9% = 29.9997 → 30.00
    const r = computeLine({ quantity: 1, rate: "333.33", gstRate: 18 }, "INTRA_STATE");
    expect(s(r.cgst)).toBe("30.00");
    expect(s(r.sgst)).toBe("30.00");
    // 0.05 × 9% = 0.0045 → 0.00 ; 1.25 × 9% = 0.1125 → 0.11
    expect(s(computeLine({ quantity: 1, rate: "1.25", gstRate: 18 }, "INTRA_STATE").cgst)).toBe("0.11");
  });

  it("no floating point drift (0.1 + 0.2 style)", () => {
    const r = computeLine({ quantity: 3, rate: "0.10", gstRate: 0 }, "NO_GST");
    expect(s(r.total)).toBe("0.30");
  });

  it("no tax for NO_GST and EXPORT", () => {
    expect(s(computeLine({ quantity: 1, rate: 1000, gstRate: 18 }, "NO_GST").tax)).toBe("0.00");
    expect(s(computeLine({ quantity: 1, rate: 1000, gstRate: 18 }, "EXPORT").tax)).toBe("0.00");
  });

  it("rejects invalid input", () => {
    expect(() => computeLine({ quantity: 1, rate: 100, discountType: "AMOUNT", discountValue: 101, gstRate: 18 }, "INTRA_STATE")).toThrow();
    expect(() => computeLine({ quantity: 1, rate: 100, discountType: "PERCENT", discountValue: 120, gstRate: 18 }, "INTRA_STATE")).toThrow();
    expect(() => computeLine({ quantity: -1, rate: 100, gstRate: 18 }, "INTRA_STATE")).toThrow();
    expect(() => computeLine({ quantity: 1, rate: 100, gstRate: 150 }, "INTRA_STATE")).toThrow();
  });
});

describe("computeTotals", () => {
  it("sums lines with mixed GST rates and rounds grand total to nearest rupee", () => {
    const t = computeTotals(
      [
        { quantity: 1, rate: "12345.67", gstRate: 18 },
        { quantity: 2, rate: "999.99", gstRate: 5 },
      ],
      "INTRA_STATE",
    );
    // line1: taxable 12345.67, cgst=sgst=1111.11 (1111.1103)
    // line2: taxable 1999.98, cgst=sgst=49.99 (49.9995 → 50.00)
    expect(s(t.taxableTotal)).toBe("14345.65");
    expect(s(t.cgstTotal)).toBe("1161.11");
    expect(s(t.sgstTotal)).toBe("1161.11");
    expect(s(t.totalBeforeRound)).toBe("16667.87");
    expect(s(t.grandTotal)).toBe("16668.00");
    expect(s(t.roundOff)).toBe("0.13");
  });

  it("negative round-off when paise < 50", () => {
    const t = computeTotals([{ quantity: 1, rate: "100.35", gstRate: 0 }], "NO_GST");
    expect(s(t.grandTotal)).toBe("100.00");
    expect(s(t.roundOff)).toBe("-0.35");
  });

  it("exactly 50 paise rounds up", () => {
    const t = computeTotals([{ quantity: 1, rate: "100.50", gstRate: 0 }], "NO_GST");
    expect(s(t.grandTotal)).toBe("101.00");
  });

  it("rounding can be switched off", () => {
    const t = computeTotals([{ quantity: 1, rate: "100.35", gstRate: 0 }], "NO_GST", { roundToRupee: false });
    expect(s(t.grandTotal)).toBe("100.35");
    expect(s(t.roundOff)).toBe("0.00");
  });

  it("empty invoice totals zero", () => {
    const t = computeTotals([], "INTRA_STATE");
    expect(s(t.grandTotal)).toBe("0.00");
  });
});
