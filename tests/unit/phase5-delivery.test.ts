import { describe, expect, it } from "vitest";
import { adMetrics, analyseAdRows, budgetTone, mapAdColumns, parseCount, parseMoney, parseReportDate, periodsOverlap, totalEntries } from "@/lib/ad-metrics";
import { approvalNeedsReset, contentLinkError, contentResponseError, summariseDelivery } from "@/lib/content-plan";
import { looksLikePassword, oneYearAfter, renewalMargin, renewalUrgency } from "@/lib/renewals";
import { assetSchema, campaignSchema, contentItemSchema, contentResponseSchema, spendEntrySchema } from "@/lib/validators/delivery";

const entry = (spend: string, impressions = 0, clicks = 0, leads = 0, conversionValue = "0") => ({ spend, impressions, clicks, leads, conversionValue });

describe("ad metrics", () => {
  it("adds up money exactly, without floating-point drift", () => {
    const t = totalEntries([entry("0.10"), entry("0.20")]);
    expect(t.spend.toFixed(2)).toBe("0.30");
    expect(t.spend.equals("0.3")).toBe(true);
  });
  it("works out CTR, CPL, ROAS and budget used", () => {
    const t = totalEntries([entry("8500", 100000, 1500, 34, "25500")]);
    const m = adMetrics(t, "10000");
    expect(m.ctr).toBe(1.5);
    expect(m.cpl?.toFixed(2)).toBe("250.00");
    expect(m.roas).toBe(3);
    expect(m.utilisation).toBe(85);
  });
  it("rounds CPL to paise", () => {
    expect(adMetrics(totalEntries([entry("100", 10, 1, 3)]), "100").cpl?.toFixed(2)).toBe("33.33");
  });
  it("says 'not known' instead of dividing by zero", () => {
    const m = adMetrics(totalEntries([entry("0")]), "0");
    expect(m).toEqual({ ctr: null, cpl: null, roas: null, utilisation: null });
    const noSales = adMetrics(totalEntries([entry("500", 100, 5, 0)]), "1000");
    expect(noSales.cpl).toBeNull();
    expect(noSales.roas).toBeNull();
  });
  it("colours the budget at the alert level and at 100%", () => {
    expect(budgetTone(null, 85)).toBe("grey");
    expect(budgetTone(84.9, 85)).toBe("green");
    expect(budgetTone(85, 85)).toBe("amber");
    expect(budgetTone(99.9, 85)).toBe("amber");
    expect(budgetTone(100, 85)).toBe("red");
    expect(budgetTone(130, 85)).toBe("red");
  });
  it("counts a shared day as an overlap", () => {
    expect(periodsOverlap({ start: "2026-11-01", end: "2026-11-07" }, { start: "2026-11-07", end: "2026-11-14" })).toBe(true);
    expect(periodsOverlap({ start: "2026-11-01", end: "2026-11-07" }, { start: "2026-11-08", end: "2026-11-14" })).toBe(false);
    expect(periodsOverlap({ start: "2026-11-05", end: "2026-11-05" }, { start: "2026-11-01", end: "2026-11-30" })).toBe(true);
  });
});

describe("reading an Ads Manager report", () => {
  const headings = ["Campaign name", "Reporting starts", "Reporting ends", "Amount spent (INR)", "Impressions", "Link clicks", "Leads", "Purchases conversion value", "Reach"];
  const { columns } = mapAdColumns(headings);
  const campaigns = [{ id: "c1", name: "Lead Generation" }];
  const row = (cells: string[], rowNumber = 2) => ({ rowNumber, cells });
  const good = ["lead generation ", "2026-11-01", "2026-11-03", "1,234.567", "10,000", "150", "12", "", "9000"];
  const analyse = (rows: { rowNumber: number; cells: string[] }[], existing: { campaignId: string; start: string; end: string }[] = []) => analyseAdRows({ rows, columns, campaigns, existing, today: "2026-11-04" });

  it("recognises Meta's column names and lists the rest as unused", () => {
    const map = mapAdColumns(headings);
    expect(map.ignored).toEqual(["Reach"]);
    expect(map.leadsFromResults).toBe(false);
  });
  it("prefers Leads over Results, and flags when it had to use Results", () => {
    expect(mapAdColumns(["Campaign name", "Results", "Leads"]).columns.leads).toBe(2);
    const fallback = mapAdColumns(["Campaign name", "Results"]);
    expect(fallback.columns.leads).toBe(1);
    expect(fallback.leadsFromResults).toBe(true);
  });
  it("doesn't read a dollar account's spend as rupees", () => {
    expect(mapAdColumns(["Amount spent (USD)"]).columns.spend).toBeUndefined();
  });
  it("reads dates in the common forms, day first", () => {
    expect(parseReportDate("2026-11-04")).toBe("2026-11-04");
    expect(parseReportDate("04-11-2026")).toBe("2026-11-04");
    expect(parseReportDate("4/11/2026")).toBe("2026-11-04");
    expect(parseReportDate("31/02/2026")).toBeNull();
    expect(parseReportDate("11/25/2026")).toBeNull();
    expect(parseReportDate("yesterday")).toBeNull();
  });
  it("reads numbers with commas, and treats blanks as none", () => {
    expect(parseCount("10,000")).toBe(10000);
    expect(parseCount("")).toBe(0);
    expect(parseCount("12.5")).toBeNull();
    expect(parseMoney("₹1,234.567")).toBe("1234.57");
    expect(parseMoney("")).toBe("0.00");
    expect(parseMoney("-5")).toBeNull();
  });
  it("accepts a good row, matching the campaign whatever its case", () => {
    const [r] = analyse([row(good)]);
    expect(r.errors).toEqual([]);
    expect(r.campaignId).toBe("c1");
    expect(r.spend).toBe("1234.57");
    expect(r.impressions).toBe(10000);
  });
  it("uses the same date for both ends when the report is daily", () => {
    const { columns: daily } = mapAdColumns(["Campaign name", "Day", "Amount spent (INR)", "Impressions"]);
    const [r] = analyseAdRows({ rows: [row(["Lead Generation", "2026-11-02", "500", "1000"])], columns: daily, campaigns, existing: [], today: "2026-11-04" });
    expect(r.errors).toEqual([]);
    expect(r.periodEnd).toBe("2026-11-02");
  });
  it("refuses an unknown campaign, bad dates, future periods and impossible numbers", () => {
    expect(analyse([row(["Other", ...good.slice(1)])])[0].errors[0]).toMatch(/No campaign called/);
    expect(analyse([row([good[0], "soon", ...good.slice(2)])])[0].errors[0]).toMatch(/dates/);
    expect(analyse([row([good[0], "2026-11-03", "2026-11-01", ...good.slice(3)])])[0].errors[0]).toMatch(/before the start/);
    expect(analyse([row([good[0], "2026-11-03", "2026-11-09", ...good.slice(3)])])[0].errors[0]).toMatch(/hasn't finished/);
    expect(analyse([row([...good.slice(0, 4), "10", "50", ...good.slice(6)])])[0].errors[0]).toMatch(/More clicks/);
    expect(analyse([row([...good.slice(0, 3), "abc", ...good.slice(4)])])[0].errors[0]).toMatch(/isn't a number/);
    expect(analyse([row([...good.slice(0, 3), "", "", "", "", "", ""])])[0].errors[0]).toMatch(/Nothing was spent/);
  });
  it("refuses a period already entered, so uploading twice can't double the spend", () => {
    const [r] = analyse([row(good)], [{ campaignId: "c1", start: "2026-11-03", end: "2026-11-05" }]);
    expect(r.errors[0]).toMatch(/already been entered/);
  });
  it("refuses a row overlapping an earlier row in the same file, but only the later one", () => {
    const rows = analyse([row(good, 2), row(good, 3)]);
    expect(rows[0].errors).toEqual([]);
    expect(rows[1].errors[0]).toMatch(/already been entered/);
  });
  it("lets another campaign use the same dates", () => {
    const [r] = analyse([row(good)], [{ campaignId: "c2", start: "2026-11-01", end: "2026-11-03" }]);
    expect(r.errors).toEqual([]);
  });
});

describe("renewals", () => {
  it("is red when expired or within 7 days, amber to 30, then green", () => {
    expect(renewalUrgency(-3)).toEqual({ tone: "red", label: "Expired 3 days ago" });
    expect(renewalUrgency(-1).label).toBe("Expired 1 day ago");
    expect(renewalUrgency(0)).toEqual({ tone: "red", label: "Expires today" });
    expect(renewalUrgency(1).label).toBe("1 day left");
    expect(renewalUrgency(7).tone).toBe("red");
    expect(renewalUrgency(8).tone).toBe("amber");
    expect(renewalUrgency(30).tone).toBe("amber");
    expect(renewalUrgency(31).tone).toBe("green");
  });
  it("works out the margin, including a loss", () => {
    const m = renewalMargin("799", "1200");
    expect(m.amount.toFixed(2)).toBe("401.00");
    expect(m.percent).toBe(33.4);
    expect(renewalMargin("1000", "800").amount.toFixed(2)).toBe("-200.00");
    expect(renewalMargin("100", "0").percent).toBeNull();
  });
  it("moves a year on, handling 29 February", () => {
    expect(oneYearAfter("2026-11-04")).toBe("2027-11-04");
    expect(oneYearAfter("2028-02-29")).toBe("2029-02-28");
  });
  it("spots a typed password but not a note about where they're kept", () => {
    expect(looksLikePassword("password: abc123")).toBe(true);
    expect(looksLikePassword("Pwd=abc")).toBe(true);
    expect(looksLikePassword("the password is hunter2")).toBe(true);
    expect(looksLikePassword("Agency password manager → Clients / urban")).toBe(false);
    expect(looksLikePassword("Passwords are in 1Password")).toBe(false);
    expect(looksLikePassword(null)).toBe(false);
  });
});

describe("approval rules", () => {
  const now = new Date("2026-11-04T10:00:00Z");
  it("rejects withdrawn and expired links", () => {
    expect(contentLinkError({ revokedAt: new Date(), expiresAt: new Date("2030-01-01") }, now)).toMatch(/withdrawn/);
    expect(contentLinkError({ revokedAt: null, expiresAt: new Date("2026-11-03") }, now)).toMatch(/expired/);
    expect(contentLinkError({ revokedAt: null, expiresAt: new Date("2026-11-05") }, now)).toBeNull();
  });
  it("only lets the client answer on what's awaiting them", () => {
    const base = { approvalStatus: "PENDING", publishedAt: null, archivedAt: null };
    expect(contentResponseError(base)).toBeNull();
    expect(contentResponseError({ ...base, approvalStatus: "APPROVED" })).toMatch(/already been approved/);
    expect(contentResponseError({ ...base, approvalStatus: "CHANGES_REQUESTED" })).toMatch(/already have your changes/);
    expect(contentResponseError({ ...base, publishedAt: now })).toMatch(/published/);
    expect(contentResponseError({ ...base, archivedAt: now })).toMatch(/no longer/);
  });
  it("needs approval again only if what the client saw changed", () => {
    const a = { topic: "T", caption: "C", creativeUrl: null };
    expect(approvalNeedsReset(a, a)).toBe(false);
    expect(approvalNeedsReset(a, { ...a, caption: "" })).toBe(true);
    expect(approvalNeedsReset(a, { ...a, topic: "New" })).toBe(true);
    expect(approvalNeedsReset({ ...a, caption: null }, { ...a, caption: "" })).toBe(false);
  });
  it("adds up committed vs delivered by client and format", () => {
    const rows = [
      { clientId: "2", client: "Zen", format: "REEL", delivered: true },
      { clientId: "1", client: "Asha", format: "REEL", delivered: false },
      { clientId: "1", client: "Asha", format: "REEL", delivered: true },
      { clientId: "1", client: "Asha", format: "STATIC_POST", delivered: true },
    ];
    const s = summariseDelivery(rows);
    expect(s.map((c) => c.client)).toEqual(["Asha", "Zen"]);
    expect(s[0].committed).toBe(3);
    expect(s[0].delivered).toBe(2);
    expect(s[0].formats).toEqual([{ format: "REEL", committed: 2, delivered: 1 }, { format: "STATIC_POST", committed: 1, delivered: 1 }]);
  });
});

describe("validators", () => {
  it("content needs a client, topic, platform and valid date", () => {
    const c = { clientId: "c1", projectId: "", format: "REEL", platforms: ["INSTAGRAM"], topic: "Launch", caption: "", publishDate: "2026-11-04" };
    expect(contentItemSchema.safeParse(c).success).toBe(true);
    expect(contentItemSchema.safeParse({ ...c, clientId: "" }).success).toBe(false);
    expect(contentItemSchema.safeParse({ ...c, platforms: [] }).success).toBe(false);
    expect(contentItemSchema.safeParse({ ...c, publishDate: "2026-02-30" }).success).toBe(false);
  });
  it("a client must say what to change, and give a name", () => {
    const r = { token: "t", itemId: "i", decision: "CHANGES_REQUESTED", name: "Asha", comment: "" };
    expect(contentResponseSchema.safeParse(r).success).toBe(false);
    expect(contentResponseSchema.safeParse({ ...r, comment: "New photo" }).success).toBe(true);
    expect(contentResponseSchema.safeParse({ ...r, decision: "APPROVED" }).success).toBe(true);
    expect(contentResponseSchema.safeParse({ ...r, decision: "APPROVED", name: "" }).success).toBe(false);
    expect(contentResponseSchema.safeParse({ ...r, decision: "PENDING", comment: "New photo" }).success).toBe(false);
  });
  it("a campaign needs a budget and sensible dates", () => {
    const c = { clientId: "c1", projectId: "", name: "Leads", objective: "", status: "ACTIVE", startDate: "2026-11-01", endDate: "", plannedBudget: "50,000" };
    expect(campaignSchema.parse(c).plannedBudget).toBe("50000");
    expect(campaignSchema.safeParse({ ...c, plannedBudget: "0" }).success).toBe(false);
    expect(campaignSchema.safeParse({ ...c, endDate: "2026-10-31" }).success).toBe(false);
  });
  it("results can't have more clicks than impressions, or backwards dates", () => {
    const e = { campaignId: "c", periodStart: "2026-11-01", periodEnd: "2026-11-07", spend: "100", impressions: 1000, clicks: 10, leads: 1, conversionValue: "" };
    expect(spendEntrySchema.parse(e).conversionValue).toBe("0");
    expect(spendEntrySchema.safeParse({ ...e, clicks: 1001 }).success).toBe(false);
    expect(spendEntrySchema.safeParse({ ...e, periodEnd: "2026-10-31" }).success).toBe(false);
    expect(spendEntrySchema.safeParse({ ...e, spend: "-1" }).success).toBe(false);
    expect(spendEntrySchema.safeParse({ ...e, leads: 1.5 }).success).toBe(false);
  });
  it("assets check the domain, the dates, and refuse passwords", () => {
    const a = { clientId: "c", kind: "DOMAIN", name: "example.co.in", provider: "", plan: "", purchaseDate: "", expiryDate: "2027-01-01", emailAccounts: "", costPrice: "500", renewalPrice: "900", autoRenew: false, credentialsLocation: "Password manager", notes: "" };
    expect(assetSchema.safeParse(a).success).toBe(true);
    expect(assetSchema.safeParse({ ...a, name: "not a domain" }).success).toBe(false);
    expect(assetSchema.safeParse({ ...a, kind: "HOSTING", name: "Shared plan" }).success).toBe(true);
    expect(assetSchema.safeParse({ ...a, purchaseDate: "2027-06-01" }).success).toBe(false);
    expect(assetSchema.safeParse({ ...a, credentialsLocation: "password: abc123" }).success).toBe(false);
    expect(assetSchema.safeParse({ ...a, notes: "login pwd=abc" }).success).toBe(false);
  });
});
