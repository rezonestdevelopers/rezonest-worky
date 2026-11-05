import { describe, expect, it } from "vitest";
import { columnsOf, csvCell, exportValue, toCsv } from "@/lib/csv";
import { buildClientMonthlyDoc, conversionRate, daysLate, deliveryByFormat, excelCell, financialYearMonths, financialYearOptions, formatCell, gstByMonth, isRankingTarget, lastMonthsTo, mrrTrend, onTimeStats, safeFileName, targetAchievement, type ClientMonthlyData } from "@/lib/reports";

describe("one way of showing a value", () => {
  it("money, numbers, percent and dates", () => {
    expect(formatCell("money", "125000.5")).toBe("₹1,25,000.50");
    expect(formatCell("number", 125000)).toBe("1,25,000");
    expect(formatCell("percent", 95)).toBe("95%");
    expect(formatCell("date", "2026-11-05")).toBe("05 Nov 2026");
    expect(formatCell(undefined, "Plain")).toBe("Plain");
  });
  it("nothing shows as a dash, but zero is a real value", () => {
    expect(formatCell("money", null)).toBe("—");
    expect(formatCell("number", 0)).toBe("0");
    expect(formatCell("money", "0.00")).toBe("₹0.00");
  });
  it("Excel gets numbers it can add up", () => {
    expect(excelCell("money", "1250.50")).toBe(1250.5);
    expect(excelCell("percent", 95)).toBe(95);
    expect(excelCell("date", "2026-11-05")).toBe("05 Nov 2026");
    expect(excelCell("text", "Hello")).toBe("Hello");
    expect(excelCell("money", null)).toBeNull();
  });
  it("file names are safe", () => {
    expect(safeFileName("Shree Ganesh / Precision & Co-report-2026-10")).toBe("Shree-Ganesh-Precision-Co-report-2026-10");
    expect(safeFileName("///")).toBe("report");
  });
});

describe("GST by month", () => {
  const inv = (dateKey: string, taxMode: string, taxable: string, cgst: string, sgst: string, igst: string) => ({ dateKey, taxMode, taxable, cgst, sgst, igst });
  it("adds CGST, SGST and IGST by invoice month", () => {
    const [oct, nov] = gstByMonth(["2026-10", "2026-11"], [inv("2026-10-05", "INTRA_STATE", "1000", "90", "90", "0"), inv("2026-10-31", "INTER_STATE", "2000", "0", "0", "360"), inv("2026-11-01", "INTRA_STATE", "500", "45", "45", "0")], []);
    expect([oct.count, oct.taxable, oct.cgst, oct.sgst, oct.igst, oct.netTax].map(String)).toEqual(["2", "3000", "90", "90", "360", "540"]);
    expect([nov.count, nov.taxable, nov.netTax].map(String)).toEqual(["1", "500", "90"]);
  });
  it("a credit note reduces the month it's raised in, not the invoice's month", () => {
    const [oct, nov] = gstByMonth(["2026-10", "2026-11"], [inv("2026-10-05", "INTRA_STATE", "1000", "90", "90", "0")], [{ dateKey: "2026-11-03", taxable: "100", cgst: "9", sgst: "9", igst: "0" }]);
    expect(oct.netTax.toString()).toBe("180");
    expect(oct.creditCount).toBe(0);
    expect(nov.netTax.toString()).toBe("-18");
    expect(nov.creditTaxable.toString()).toBe("100");
  });
  it("no-GST and export invoices carry no tax, and show as their own value", () => {
    const [m] = gstByMonth(["2026-10"], [inv("2026-10-05", "NO_GST", "1000", "0", "0", "0"), inv("2026-10-06", "EXPORT", "500", "0", "0", "0")], []);
    expect([m.count, m.taxable, m.noGst, m.netTax].map(String)).toEqual(["0", "0", "1500", "0"]);
  });
  it("leaves out anything outside the months asked for", () => {
    const [m] = gstByMonth(["2026-10"], [inv("2026-09-30", "INTRA_STATE", "1000", "90", "90", "0")], [{ dateKey: "2026-11-01", taxable: "1", cgst: "1", sgst: "1", igst: "0" }]);
    expect(m.netTax.toString()).toBe("0");
  });
  it("has no floating-point drift", () => {
    const [m] = gstByMonth(["2026-10"], [inv("2026-10-01", "INTER_STATE", "0.10", "0", "0", "0.10"), inv("2026-10-02", "INTER_STATE", "0.20", "0", "0", "0.20")], []);
    expect(m.igst.toString()).toBe("0.3");
  });
});

describe("financial years", () => {
  it("run April to March, and stop at this month", () => {
    const fy = financialYearMonths(null, "2026-11-05");
    expect(fy.fy).toBe("2026-27");
    expect(fy.months[0]).toBe("2026-04");
    expect(fy.months.at(-1)).toBe("2026-11");
    expect(fy.from).toBe("2026-04-01");
    expect(fy.to).toBe("2026-11-30");
  });
  it("January to March belong to the year before", () => {
    expect(financialYearMonths(null, "2027-02-10").fy).toBe("2026-27");
    expect(financialYearMonths(null, "2027-04-01").fy).toBe("2027-28");
  });
  it("a past year is complete", () => {
    const fy = financialYearMonths("2025-26", "2026-11-05");
    expect(fy.months).toHaveLength(12);
    expect(fy.months.at(-1)).toBe("2026-03");
    expect(fy.to).toBe("2026-03-31");
  });
  it("ignores rubbish, mismatched years and the future", () => {
    for (const bad of ["abc", "2026-99", "2030-31", "<x>"]) expect(financialYearMonths(bad, "2026-11-05").fy).toBe("2026-27");
  });
  it("offers this year and the ones before", () => {
    expect(financialYearOptions("2026-11-05", 3)).toEqual(["2026-27", "2025-26", "2024-25"]);
  });
});

describe("delivery measures", () => {
  it("days late", () => {
    expect(daysLate("2026-11-05", "2026-11-05")).toBe(0);
    expect(daysLate("2026-11-05", "2026-11-03")).toBe(0);
    expect(daysLate("2026-11-05", "2026-11-08")).toBe(3);
    expect(daysLate(null, "2026-11-08")).toBeNull();
    expect(daysLate("2026-11-05", null)).toBeNull();
  });
  it("on-time share only judges tasks with a due date that are finished", () => {
    const s = onTimeStats([
      { dueKey: "2026-11-05", doneKey: "2026-11-05" },
      { dueKey: "2026-11-05", doneKey: "2026-11-04" },
      { dueKey: "2026-11-05", doneKey: "2026-11-06" },
      { dueKey: null, doneKey: "2026-11-06" },
      { dueKey: "2026-11-05", doneKey: null },
    ]);
    expect(s).toEqual({ judged: 3, onTime: 2, late: 1, percent: 67 });
    expect(onTimeStats([]).percent).toBeNull();
  });
  it("targets: higher or lower is better", () => {
    expect(targetAchievement({ target: 100, actual: 80, higherIsBetter: true })).toBe(80);
    expect(targetAchievement({ target: 400, actual: 500, higherIsBetter: false })).toBe(80);
    expect(targetAchievement({ target: 400, actual: 200, higherIsBetter: false })).toBe(200);
  });
  it("targets with no figure yet aren't scored", () => {
    expect(targetAchievement({ target: 100, actual: null, higherIsBetter: true })).toBeNull();
    expect(targetAchievement({ target: 0, actual: 5, higherIsBetter: true })).toBeNull();
    expect(targetAchievement({ target: 5, actual: 0, higherIsBetter: false })).toBeNull();
  });
  it("conversion counts only decided offers", () => {
    expect(conversionRate({ accepted: 3, rejected: 1, expired: 0 })).toBe(75);
    expect(conversionRate({ accepted: 0, rejected: 0, expired: 0 })).toBeNull();
  });
  it("MRR by month follows retainer dates", () => {
    const r = mrrTrend(["2026-09", "2026-10", "2026-11"], "2026-11-05", [
      { start: "2026-09-15", end: null, monthly: "1000" },
      { start: "2026-10-15", end: "2026-11-01", monthly: "500" },
      { start: "2026-11-20", end: null, monthly: "700" },
      { start: null, end: null, monthly: "900" },
    ]);
    expect(r.map((x) => [x.month, x.mrr.toString(), x.count])).toEqual([["2026-09", "1000", 1], ["2026-10", "1500", 2], ["2026-11", "1000", 1]]);
  });
  it("lists months ending at the one chosen", () => {
    expect(lastMonthsTo("2027-01-20", 3)).toEqual(["2026-11", "2026-12", "2027-01"]);
  });
  it("sorts keyword targets into rankings", () => {
    expect(isRankingTarget({ metric: "Keyword: cnc machine pune", unit: null })).toBe(true);
    expect(isRankingTarget({ metric: "Keywords in top 10", unit: "count" })).toBe(true);
    expect(isRankingTarget({ metric: "Home page", unit: "position" })).toBe(true);
    expect(isRankingTarget({ metric: "Leads", unit: "count" })).toBe(false);
    expect(isRankingTarget({ metric: "Pranking reels", unit: "count" })).toBe(false);
  });
  it("committed vs delivered by format", () => {
    expect(deliveryByFormat([{ format: "REEL", delivered: true }, { format: "REEL", delivered: false }, { format: "STATIC_POST", delivered: true }, { format: null, delivered: false }])).toEqual([
      { label: "Other deliverables", committed: 1, delivered: 0 },
      { label: "Posts", committed: 1, delivered: 1 },
      { label: "Reels", committed: 2, delivered: 1 },
    ]);
  });
});

const monthly = (over: Partial<ClientMonthlyData> = {}): ClientMonthlyData => ({
  agencyName: "Rezonest", clientName: "Asha Foods", month: "2026-10", highlights: "Great month", nextPlan: "More reels",
  deliverables: [{ format: "REEL", delivered: true }, { format: "REEL", delivered: false }],
  kpis: [{ metric: "Leads", unit: "count", target: 100, actual: 80, higherIsBetter: true }],
  rankings: [{ metric: "Keyword: momos pune", unit: "position", target: 3, actual: 6, higherIsBetter: false }],
  ads: [{ campaign: "Diwali", spend: "5000", impressions: 10000, clicks: 200, ctr: 2, leads: 25, cpl: "200", roas: 3.5 }],
  published: [{ dateKey: "2026-10-05", format: "Reel", topic: "Launch", link: "https://x.in/1" }],
  ...over,
});

describe("the client's monthly report", () => {
  it("has the sections from the brief, in order", () => {
    expect(buildClientMonthlyDoc(monthly()).sections.map((s) => s.title)).toEqual(["Highlights", "Deliverables", "Published this month", "KPIs", "SEO rankings", "Ads results", "Plan for next month"]);
  });
  it("leaves out what has nothing to say", () => {
    const doc = buildClientMonthlyDoc(monthly({ highlights: null, nextPlan: null, kpis: [], rankings: [], ads: [], published: [] }));
    expect(doc.sections.map((s) => s.title)).toEqual(["Deliverables"]);
    expect(doc.summary?.map((x) => x.label)).toEqual(["Deliverables"]);
  });
  it("sums up deliverables and ads", () => {
    const doc = buildClientMonthlyDoc(monthly());
    expect(doc.summary).toEqual([{ label: "Deliverables", value: "1 of 2" }, { label: "Ad spend", value: "₹5,000" }, { label: "Leads from ads", value: "25" }]);
    expect(doc.title).toBe("Oct 2026 performance report");
    expect(doc.fileName).toBe("Asha-Foods-report-2026-10");
  });
  it("says the spend is their ad budget", () => {
    expect(buildClientMonthlyDoc(monthly()).sections.find((s) => s.title === "Ads results")?.note).toMatch(/your ad budget/);
  });
});

describe("CSV", () => {
  it("quotes commas, quotes and new lines", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell(null)).toBe("");
  });
  it("stops a value running as a formula in Excel", () => {
    for (const bad of ["=HYPERLINK(1)", "+1+1", "-1+cmd", "@SUM(A1)"]) expect(csvCell(bad).startsWith("'") || csvCell(bad).startsWith(`"'`)).toBe(true);
  });
  it("leaves real negative numbers alone", () => {
    expect(csvCell("-1250.50")).toBe("-1250.50");
    expect(csvCell(-5)).toBe("-5");
  });
  it("starts with a byte-order mark so Excel reads ₹ correctly", () => {
    const csv = toCsv(["a", "b"], [{ a: "₹1", b: null }]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe("a,b\r\n₹1,\r\n");
  });
  it("turns stored values into text", () => {
    expect(exportValue(new Date("2026-11-05T00:00:00.000Z"))).toBe("2026-11-05T00:00:00.000Z");
    expect(exportValue({ a: 1 })).toBe('{"a":1}');
    expect(exportValue(["x"])).toBe('["x"]');
    expect(exportValue(undefined)).toBeNull();
    expect(exportValue(true)).toBe(true);
  });
  it("gathers every column", () => {
    expect(columnsOf([{ a: 1 }, { b: 2 }])).toEqual(["a", "b"]);
  });
});
