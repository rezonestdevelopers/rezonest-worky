import { Decimal, round2, toDecimal, type DecimalLike } from "@/lib/money/decimal";
import { isValidDateKey } from "@/lib/validators/common";

/** The client's ad money. Spend here is never agency revenue. */
export type AdEntry = { spend: DecimalLike; impressions: number; clicks: number; leads: number; conversionValue: DecimalLike };
export type AdTotals = { spend: Decimal; impressions: number; clicks: number; leads: number; conversionValue: Decimal };

export function totalEntries(entries: AdEntry[]): AdTotals {
  return entries.reduce<AdTotals>(
    (t, e) => ({
      spend: t.spend.plus(toDecimal(e.spend)),
      impressions: t.impressions + e.impressions,
      clicks: t.clicks + e.clicks,
      leads: t.leads + e.leads,
      conversionValue: t.conversionValue.plus(toDecimal(e.conversionValue)),
    }),
    { spend: new Decimal(0), impressions: 0, clicks: 0, leads: 0, conversionValue: new Decimal(0) },
  );
}

export type AdMetrics = {
  /** Click-through rate, as a percentage. */
  ctr: number | null;
  /** Cost per lead, in rupees. */
  cpl: Decimal | null;
  /** Rupees earned for each rupee spent. */
  roas: number | null;
  /** Share of the budget spent, as a percentage. */
  utilisation: number | null;
};

const ratio = (top: Decimal, bottom: Decimal, dp: number) => top.dividedBy(bottom).toDecimalPlaces(dp).toNumber();

/** A figure that would divide by zero is "not known yet" rather than 0 or infinity. */
export function adMetrics(t: AdTotals, budget: DecimalLike): AdMetrics {
  const plan = toDecimal(budget);
  return {
    ctr: t.impressions > 0 ? ratio(new Decimal(t.clicks).times(100), new Decimal(t.impressions), 2) : null,
    cpl: t.leads > 0 ? round2(t.spend.dividedBy(t.leads)) : null,
    roas: t.spend.greaterThan(0) && t.conversionValue.greaterThan(0) ? ratio(t.conversionValue, t.spend, 2) : null,
    utilisation: plan.greaterThan(0) ? ratio(t.spend.times(100), plan, 1) : null,
  };
}

/** Green while under the alert level, amber from there, red once the budget is used up. */
export function budgetTone(utilisation: number | null, alertPercent: number): "grey" | "green" | "amber" | "red" {
  if (utilisation === null) return "grey";
  if (utilisation >= 100) return "red";
  return utilisation >= alertPercent ? "amber" : "green";
}

/** Both ends count, so 1–7 Nov and 7–14 Nov overlap on the 7th. */
export function periodsOverlap(a: { start: string; end: string }, b: { start: string; end: string }): boolean {
  return a.start <= b.end && b.start <= a.end;
}

const header = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Column headings from a Meta Ads Manager export. Rupee spend only, so a dollar account isn't read as rupees. */
const COLUMNS: Record<string, string[]> = {
  campaign: ["campaignname", "campaign"],
  start: ["reportingstarts", "startdate", "from", "day", "date"],
  end: ["reportingends", "enddate", "to"],
  spend: ["amountspentinr", "amountspent", "spend"],
  impressions: ["impressions"],
  clicks: ["linkclicks", "clicksall", "clicks"],
  leads: ["leads", "metaleads", "websiteleads", "results"],
  value: ["purchasesconversionvalue", "websitepurchasesconversionvalue", "conversionvalue", "resultsvalue"],
};

export type AdColumnMap = { columns: Record<string, number>; ignored: string[]; leadsFromResults: boolean };

export function mapAdColumns(headings: string[]): AdColumnMap {
  const columns: Record<string, number> = {};
  const ignored: string[] = [];
  let leadsFromResults = false;
  const names = headings.map(header);
  for (const [field, aliases] of Object.entries(COLUMNS)) {
    // The first alias is the preferred one, so "Leads" wins over "Results" when both are present.
    const found = aliases.find((a) => names.includes(a));
    if (found) {
      columns[field] = names.indexOf(found);
      if (field === "leads" && found === "results") leadsFromResults = true;
    }
  }
  const used = new Set(Object.values(columns));
  headings.forEach((h, i) => {
    if (h.trim() && !used.has(i)) ignored.push(h.trim());
  });
  return { columns, ignored, leadsFromResults };
}

/** Accepts 2026-11-04, 04-11-2026 and 04/11/2026. Day first, as used in India. */
export function parseReportDate(text: string): string | null {
  const v = text.trim();
  if (isValidDateKey(v)) return v;
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(v);
  if (!m) return null;
  const key = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return isValidDateKey(key) ? key : null;
}

const cleanNumber = (text: string) => text.trim().replace(/[₹,\s]/g, "");

/** Whole counts. Blank means none, since Ads Manager leaves a cell empty when there were no results. */
export function parseCount(text: string): number | null {
  const v = cleanNumber(text);
  if (!v) return 0;
  return /^\d{1,10}$/.test(v) ? Number(v) : null;
}

/** Rupees to two places. Ads Manager can give more, so they're rounded here. */
export function parseMoney(text: string): string | null {
  const v = cleanNumber(text);
  if (!v) return "0.00";
  return /^\d{1,12}(\.\d+)?$/.test(v) ? round2(v).toFixed(2) : null;
}

export type AdImportCampaign = { id: string; name: string };
export type AdExistingPeriod = { campaignId: string; start: string; end: string };

export type AdImportRow = {
  rowNumber: number;
  campaign: string;
  campaignId: string | null;
  periodStart: string;
  periodEnd: string;
  spend: string;
  impressions: number;
  clicks: number;
  leads: number;
  conversionValue: string;
  errors: string[];
};

/**
 * Checks each row of an upload. Rows that overlap a period already entered are refused, because
 * uploading the same report twice would otherwise double the spend. Nothing is saved here.
 */
export function analyseAdRows(input: {
  rows: { rowNumber: number; cells: string[] }[];
  columns: Record<string, number>;
  campaigns: AdImportCampaign[];
  existing: AdExistingPeriod[];
  today: string;
}): AdImportRow[] {
  const byName = new Map(input.campaigns.map((c) => [c.name.trim().toLowerCase(), c]));
  const taken = [...input.existing];
  return input.rows.map(({ rowNumber, cells }) => {
    const cell = (field: string) => (input.columns[field] === undefined ? "" : (cells[input.columns[field]] ?? ""));
    const errors: string[] = [];
    const campaign = cell("campaign").trim();
    const match = byName.get(campaign.toLowerCase());
    if (!campaign) errors.push("No campaign name.");
    else if (!match) errors.push(`No campaign called “${campaign}” for this client. Add it first, using the same name.`);

    const start = parseReportDate(cell("start"));
    const end = input.columns.end === undefined ? start : parseReportDate(cell("end"));
    if (!start || !end) errors.push("The dates couldn't be read. Use a format like 2026-11-04.");
    else if (end < start) errors.push("The end date is before the start date.");
    else if (end > input.today) errors.push("This period hasn't finished yet.");

    const spend = parseMoney(cell("spend"));
    const impressions = parseCount(cell("impressions"));
    const clicks = parseCount(cell("clicks"));
    const leads = parseCount(cell("leads"));
    const value = parseMoney(cell("value"));
    if (spend === null) errors.push("The amount spent isn't a number.");
    if (impressions === null) errors.push("Impressions isn't a whole number.");
    if (clicks === null) errors.push("Clicks isn't a whole number.");
    if (leads === null) errors.push("Leads isn't a whole number.");
    if (value === null) errors.push("Conversion value isn't a number.");
    if (impressions !== null && clicks !== null && clicks > impressions) errors.push("More clicks than impressions.");
    if (spend === "0.00" && !impressions) errors.push("Nothing was spent in this period.");

    if (match && start && end && start <= end) {
      const period = { start, end };
      if (taken.some((t) => t.campaignId === match.id && periodsOverlap(t, period))) errors.push("This period has already been entered for this campaign.");
      else if (!errors.length) taken.push({ campaignId: match.id, ...period });
    }
    return {
      rowNumber,
      campaign,
      campaignId: match?.id ?? null,
      periodStart: start ?? "",
      periodEnd: end ?? "",
      spend: spend ?? "0.00",
      impressions: impressions ?? 0,
      clicks: clicks ?? 0,
      leads: leads ?? 0,
      conversionValue: value ?? "0.00",
      errors,
    };
  });
}
