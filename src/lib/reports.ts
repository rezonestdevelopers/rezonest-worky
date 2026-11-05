import { formatDateKey, formatMonthKey, monthKeyOf, monthRange, shiftMonth } from "@/lib/dates";
import { Decimal, sum, toDecimal, type DecimalLike } from "@/lib/money/decimal";
import { formatINR, formatNumberIN } from "@/lib/money/format";

// ─── A report, ready for the screen, a PDF or Excel ──────────────────────────

export type ColumnKind = "text" | "money" | "number" | "percent" | "date";
export type Cell = string | number | null;
export type ReportColumn = { label: string; kind?: ColumnKind; /** Share of the width in a PDF, where text columns are usually 2. */ weight?: number };
export type ReportSection = { title: string; note?: string; columns: ReportColumn[]; rows: Cell[][]; total?: Cell[]; empty?: string };
export type ReportDoc = { title: string; subtitle: string; fileName: string; landscape?: boolean; summary?: { label: string; value: string }[]; sections: ReportSection[] };

/** One way of showing a value, so the screen and the PDF always match. */
export function formatCell(kind: ColumnKind | undefined, value: Cell): string {
  if (value === null || value === "") return "—";
  switch (kind) {
    case "money":
      return formatINR(value);
    case "number":
      return formatNumberIN(Number(value));
    case "percent":
      return `${value}%`;
    case "date":
      return formatDateKey(String(value));
    default:
      return String(value);
  }
}

/** Excel gets real numbers it can add up. */
export function excelCell(kind: ColumnKind | undefined, value: Cell): string | number | null {
  if (value === null) return null;
  if (kind === "money" || kind === "number" || kind === "percent") return Number(value);
  if (kind === "date") return formatDateKey(String(value));
  return value;
}

export const safeFileName = (name: string) => name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 120) || "report";

// ─── GST ─────────────────────────────────────────────────────────────────────

export type GstInvoiceFact = { dateKey: string; taxMode: string; taxable: DecimalLike; cgst: DecimalLike; sgst: DecimalLike; igst: DecimalLike };
export type GstCreditFact = { dateKey: string; taxable: DecimalLike; cgst: DecimalLike; sgst: DecimalLike; igst: DecimalLike };

const charged = (mode: string) => mode === "INTRA_STATE" || mode === "INTER_STATE";

/**
 * Output tax by month. A credit note reduces the month it's raised in, so a closed month never changes.
 * Invoices with no GST are shown as their own value and carry no tax. Round-off isn't tax, so it isn't here.
 */
export function gstByMonth(months: string[], invoices: GstInvoiceFact[], credits: GstCreditFact[]) {
  const zero = () => new Decimal(0);
  const rows = new Map(
    months.map((month) => [month, { month, count: 0, taxable: zero(), cgst: zero(), sgst: zero(), igst: zero(), noGst: zero(), creditCount: 0, creditTaxable: zero(), creditCgst: zero(), creditSgst: zero(), creditIgst: zero() }]),
  );
  for (const i of invoices) {
    const r = rows.get(monthKeyOf(i.dateKey));
    if (!r) continue;
    if (!charged(i.taxMode)) {
      r.noGst = r.noGst.plus(toDecimal(i.taxable));
      continue;
    }
    r.count++;
    r.taxable = r.taxable.plus(toDecimal(i.taxable));
    r.cgst = r.cgst.plus(toDecimal(i.cgst));
    r.sgst = r.sgst.plus(toDecimal(i.sgst));
    r.igst = r.igst.plus(toDecimal(i.igst));
  }
  for (const c of credits) {
    const r = rows.get(monthKeyOf(c.dateKey));
    if (!r) continue;
    r.creditCount++;
    r.creditTaxable = r.creditTaxable.plus(toDecimal(c.taxable));
    r.creditCgst = r.creditCgst.plus(toDecimal(c.cgst));
    r.creditSgst = r.creditSgst.plus(toDecimal(c.sgst));
    r.creditIgst = r.creditIgst.plus(toDecimal(c.igst));
  }
  return [...rows.values()].map((r) => ({ ...r, netTax: r.cgst.plus(r.sgst).plus(r.igst).minus(r.creditCgst).minus(r.creditSgst).minus(r.creditIgst) }));
}

/** The months of a financial year up to today, April first. "2026-27" means Apr 2026 to Mar 2027. */
export function financialYearMonths(fy: string | null | undefined, today: string) {
  const currentStart = Number(today.slice(0, 4)) - (today.slice(5, 7) >= "04" ? 0 : 1);
  const match = fy?.match(/^(\d{4})-(\d{2})$/);
  const asked = match && (Number(match[1]) + 1) % 100 === Number(match[2]) ? Number(match[1]) : currentStart;
  const start = asked > currentStart ? currentStart : asked;
  const months = Array.from({ length: 12 }, (_, i) => shiftMonth(`${start}-04`, i)).filter((m) => m <= monthKeyOf(today));
  return { fy: `${start}-${String((start + 1) % 100).padStart(2, "0")}`, startYear: start, months, from: `${start}-04-01`, to: months.length ? monthRange(months[months.length - 1]).end : `${start}-04-30` };
}

export const financialYearOptions = (today: string, count = 4) => {
  const current = financialYearMonths(null, today).startYear;
  return Array.from({ length: count }, (_, i) => {
    const y = current - i;
    return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
  });
};

// ─── Delivery and tasks ──────────────────────────────────────────────────────

/** Days late, or 0 if it was on time or early. Unknown if there was no due date or it isn't finished. */
export function daysLate(dueKey: string | null, doneKey: string | null): number | null {
  if (!dueKey || !doneKey) return null;
  const ms = Date.parse(doneKey) - Date.parse(dueKey);
  return Math.max(0, Math.round(ms / 86_400_000));
}

/** On-time share of finished tasks. A task with no due date can't be on time or late, so it isn't counted. */
export function onTimeStats(tasks: { dueKey: string | null; doneKey: string | null }[]) {
  const judged = tasks.filter((t) => t.dueKey && t.doneKey);
  const onTime = judged.filter((t) => daysLate(t.dueKey, t.doneKey) === 0).length;
  return { judged: judged.length, onTime, late: judged.length - onTime, percent: judged.length ? Math.round((onTime / judged.length) * 100) : null };
}

/** How close a target is. Where lower is better, like cost per lead, beating it goes over 100%. */
export function targetAchievement(input: { target: DecimalLike; actual: DecimalLike | null | undefined; higherIsBetter: boolean }): number | null {
  if (input.actual === null || input.actual === undefined) return null;
  const target = toDecimal(input.target);
  const actual = toDecimal(input.actual);
  const top = input.higherIsBetter ? actual : target;
  const bottom = input.higherIsBetter ? target : actual;
  if (!bottom.greaterThan(0)) return null;
  return Math.round(top.dividedBy(bottom).times(100).toNumber());
}

/** Accepted out of those decided. Offers still waiting don't count either way. */
export function conversionRate(input: { accepted: number; rejected: number; expired: number }): number | null {
  const decided = input.accepted + input.rejected + input.expired;
  return decided ? Math.round((input.accepted / decided) * 100) : null;
}

export type RetainerFact = { start: string | null; end: string | null; monthly: DecimalLike };

/** Monthly retainer value in force on the last day of each month, or today for this month. */
export function mrrTrend(months: string[], today: string, retainers: RetainerFact[]) {
  return months.map((month) => {
    const end = monthRange(month).end;
    const on = end > today ? today : end;
    const live = retainers.filter((r) => r.start && r.start <= on && (!r.end || r.end >= on));
    return { month, mrr: sum(live.map((r) => r.monthly)), count: live.length };
  });
}

export const lastMonthsTo = (toKey: string, count: number) => Array.from({ length: count }, (_, i) => shiftMonth(monthKeyOf(toKey), i - count + 1));

/** Keyword and ranking targets are shown as SEO rankings; the rest are KPIs. */
export const isRankingTarget = (t: { metric: string; unit: string | null }) => /position|rank/i.test(t.unit ?? "") || /keyword|\branking|\brank\b/i.test(t.metric);

/** Which day-to-day format label to show. */
const FORMAT_PLURAL: Record<string, string> = { STATIC_POST: "Posts", CAROUSEL: "Carousels", REEL: "Reels", STORY: "Stories", VIDEO: "Videos" };
export const formatPlural = (format: string | null | undefined) => (format ? (FORMAT_PLURAL[format] ?? format) : "Other deliverables");

/** Committed vs delivered for a set of deliverables, by format. */
export function deliveryByFormat(rows: { format: string | null; delivered: boolean }[]) {
  const map = new Map<string, { label: string; committed: number; delivered: number }>();
  for (const r of rows) {
    const label = formatPlural(r.format);
    const row = map.get(label) ?? { label, committed: 0, delivered: 0 };
    row.committed++;
    if (r.delivered) row.delivered++;
    map.set(label, row);
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** Only ever these fields reach the client's report. It has nowhere to put a fee, a cost or a team member's name. */
export type ClientMonthlyData = {
  agencyName: string;
  clientName: string;
  month: string;
  highlights: string | null;
  nextPlan: string | null;
  deliverables: { format: string | null; delivered: boolean }[];
  kpis: { metric: string; unit: string | null; target: DecimalLike; actual: DecimalLike | null; higherIsBetter: boolean }[];
  rankings: { metric: string; unit: string | null; target: DecimalLike; actual: DecimalLike | null; higherIsBetter: boolean }[];
  ads: { campaign: string; spend: DecimalLike; impressions: number; clicks: number; ctr: number | null; leads: number; cpl: DecimalLike | null; roas: number | null }[];
  published: { dateKey: string | null; format: string; topic: string; link: string | null }[];
};

const metricValue = (v: DecimalLike | null, unit: string | null) => (v === null || v === undefined ? "—" : `${unit === "₹" ? "₹" : ""}${formatNumberIN(toDecimal(v).toNumber())}${unit === "%" ? "%" : ""}`);

export function buildClientMonthlyDoc(d: ClientMonthlyData): ReportDoc {
  const label = formatMonthKey(d.month);
  const delivery = deliveryByFormat(d.deliverables);
  const committed = sum(delivery.map((x) => x.committed)).toNumber();
  const delivered = sum(delivery.map((x) => x.delivered)).toNumber();
  const adSpend = sum(d.ads.map((a) => a.spend));
  const adLeads = d.ads.reduce((n, a) => n + a.leads, 0);
  const sections: ReportSection[] = [];
  if (d.highlights) sections.push({ title: "Highlights", columns: [{ label: "" }], rows: [[d.highlights]] });
  sections.push({ title: "Deliverables", columns: [{ label: "Type" }, { label: "Committed", kind: "number" }, { label: "Delivered", kind: "number" }], rows: delivery.map((x) => [x.label, x.committed, x.delivered]), empty: "No deliverables were planned for this month." });
  if (d.published.length) sections.push({ title: "Published this month", columns: [{ label: "Date", kind: "date" }, { label: "Type", weight: 1 }, { label: "Topic", weight: 3 }, { label: "Link", weight: 4 }], rows: d.published.map((p) => [p.dateKey, p.format, p.topic, p.link]) });
  const targetRow = (t: ClientMonthlyData["kpis"][number]): Cell[] => [t.metric, metricValue(t.target, t.unit), metricValue(t.actual, t.unit), targetAchievement(t)];
  if (d.kpis.length) sections.push({ title: "KPIs", columns: [{ label: "Measure" }, { label: "Target" }, { label: "Actual" }, { label: "Achieved", kind: "percent" }], rows: d.kpis.map(targetRow) });
  if (d.rankings.length) sections.push({ title: "SEO rankings", columns: [{ label: "Keyword or measure" }, { label: "Target" }, { label: "Actual" }, { label: "Achieved", kind: "percent" }], rows: d.rankings.map(targetRow) });
  if (d.ads.length) {
    sections.push({
      title: "Ads results",
      note: "Spend is your ad budget, paid to the ad platform.",
      columns: [{ label: "Campaign" }, { label: "Ad spend", kind: "money" }, { label: "Impressions", kind: "number" }, { label: "Clicks", kind: "number" }, { label: "CTR", kind: "percent" }, { label: "Leads", kind: "number" }, { label: "Cost per lead", kind: "money" }, { label: "ROAS" }],
      rows: d.ads.map((a) => [a.campaign, toDecimal(a.spend).toFixed(2), a.impressions, a.clicks, a.ctr, a.leads, a.cpl === null ? null : toDecimal(a.cpl).toFixed(2), a.roas === null ? null : `${a.roas}x`]),
    });
  }
  if (d.nextPlan) sections.push({ title: "Plan for next month", columns: [{ label: "" }], rows: [[d.nextPlan]] });
  return {
    title: `${label} performance report`,
    subtitle: d.clientName,
    fileName: safeFileName(`${d.clientName}-report-${d.month}`),
    summary: [
      { label: "Deliverables", value: `${delivered} of ${committed}` },
      ...(d.ads.length ? [{ label: "Ad spend", value: formatINR(adSpend, { decimals: false }) }, { label: "Leads from ads", value: formatNumberIN(adLeads) }] : []),
    ],
    sections,
  };
}

