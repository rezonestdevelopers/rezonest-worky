import { addDaysKey, financialYear, monthKeyOf, monthRange, shiftMonth } from "@/lib/dates";
import { Decimal, sum, toDecimal, type DecimalLike } from "@/lib/money/decimal";

export const EXPENSE_CATEGORIES = ["FREELANCER", "STOCK_ASSETS", "SOFTWARE_TOOLS", "DOMAIN_HOSTING", "TRAVEL", "PRINTING", "OTHER"] as const;
const CATEGORY_LABEL: Record<string, string> = { FREELANCER: "Freelancer", STOCK_ASSETS: "Stock assets", SOFTWARE_TOOLS: "Software & tools", DOMAIN_HOSTING: "Domain & hosting cost", TRAVEL: "Travel", PRINTING: "Printing", OTHER: "Other" };
export const expenseCategoryLabel = (category: string) => CATEGORY_LABEL[category] ?? category;

/** Logged minutes at an hourly rate. No rate set means no cost. */
export const timeCost = (minutes: number, hourlyCost: DecimalLike): Decimal => toDecimal(hourlyCost).times(minutes).dividedBy(60);

/** Revenue − expenses − team time. All before GST. The margin is blank when there's no revenue to compare with. */
export function profitOf(input: { revenue: DecimalLike; expenses: DecimalLike; time: DecimalLike }) {
  const revenue = toDecimal(input.revenue);
  const expenses = toDecimal(input.expenses);
  const time = toDecimal(input.time);
  const profit = revenue.minus(expenses).minus(time);
  return { revenue, expenses, time, profit, marginPercent: revenue.greaterThan(0) ? Math.round(profit.dividedBy(revenue).times(1000).toNumber()) / 10 : null };
}

export type ProfitFacts = {
  /** Issued tax invoices, before GST, dated in the period. */
  invoices: { clientId: string; projectId: string | null; taxable: DecimalLike }[];
  /** Credit notes, before GST, dated in the period. They count when raised, like the dashboard. */
  credits: { clientId: string; projectId: string | null; taxable: DecimalLike }[];
  /** Expenses before GST. Without a client they're agency overheads. */
  expenses: { clientId: string | null; projectId: string | null; amount: DecimalLike }[];
  time: { clientId: string | null; projectId: string | null; minutes: number; hourlyCost: DecimalLike }[];
};

type Tally = { revenue: Decimal; expenses: Decimal; time: Decimal };

function add(map: Map<string, Tally>, key: string, field: keyof Tally, amount: Decimal) {
  const row = map.get(key) ?? { revenue: new Decimal(0), expenses: new Decimal(0), time: new Decimal(0) };
  row[field] = row[field].plus(amount);
  map.set(key, row);
}

/** Adds up profit per client and per project. Only money linked to a client or project goes on its row. */
export function buildProfit(facts: ProfitFacts) {
  const clients = new Map<string, Tally>();
  const projects = new Map<string, Tally>();
  const place = (row: { clientId: string | null; projectId: string | null }, field: keyof Tally, amount: Decimal) => {
    if (row.clientId) add(clients, row.clientId, field, amount);
    if (row.projectId) add(projects, row.projectId, field, amount);
  };
  for (const i of facts.invoices) place(i, "revenue", toDecimal(i.taxable));
  for (const c of facts.credits) place(c, "revenue", toDecimal(c.taxable).negated());
  for (const e of facts.expenses) place(e, "expenses", toDecimal(e.amount));
  for (const t of facts.time) place(t, "time", timeCost(t.minutes, t.hourlyCost));
  const finish = (map: Map<string, Tally>) =>
    [...map.entries()].map(([id, tally]) => ({ id, ...profitOf(tally) })).sort((a, b) => b.profit.comparedTo(a.profit) || a.id.localeCompare(b.id));
  return { clients: finish(clients), projects: finish(projects), overheads: sum(facts.expenses.filter((e) => !e.clientId && !e.projectId).map((e) => e.amount)) };
}

/** Revenue against every expense for each month, including overheads, oldest first. */
export function monthlyRevenueVsExpenses(input: { months: string[]; invoices: { dateKey: string; taxable: DecimalLike }[]; credits: { dateKey: string; taxable: DecimalLike }[]; expenses: { dateKey: string; amount: DecimalLike }[] }) {
  const rows = new Map(input.months.map((m) => [m, { month: m, revenue: new Decimal(0), expenses: new Decimal(0) }]));
  for (const i of input.invoices) {
    const r = rows.get(monthKeyOf(i.dateKey));
    if (r) r.revenue = r.revenue.plus(toDecimal(i.taxable));
  }
  for (const c of input.credits) {
    const r = rows.get(monthKeyOf(c.dateKey));
    if (r) r.revenue = r.revenue.minus(toDecimal(c.taxable));
  }
  for (const e of input.expenses) {
    const r = rows.get(monthKeyOf(e.dateKey));
    if (r) r.expenses = r.expenses.plus(toDecimal(e.amount));
  }
  return [...rows.values()].map((r) => ({ ...r, net: r.revenue.minus(r.expenses) }));
}

export const lastMonths = (today: string, count: number) => Array.from({ length: count }, (_, i) => shiftMonth(monthKeyOf(today), i - count + 1));

export const PROFIT_PERIODS = [
  { key: "month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "fy", label: "This financial year" },
  { key: "last-fy", label: "Last financial year" },
  { key: "all", label: "All time" },
] as const;
export type ProfitPeriod = (typeof PROFIT_PERIODS)[number]["key"];

/** The dates a period covers. "All" has no start. A financial year runs April to March. */
export function periodRange(period: string | null | undefined, today: string): { key: ProfitPeriod; from: string | null; to: string } {
  const month = monthKeyOf(today);
  const fyStartYear = Number(today.slice(0, 4)) - (today.slice(5, 7) >= "04" ? 0 : 1);
  switch (period) {
    case "month":
      return { key: "month", from: monthRange(month).start, to: today };
    case "last-month": {
      const r = monthRange(shiftMonth(month, -1));
      return { key: "last-month", from: r.start, to: r.end };
    }
    case "last-fy":
      return { key: "last-fy", from: `${fyStartYear - 1}-04-01`, to: addDaysKey(`${fyStartYear}-04-01`, -1) };
    case "all":
      return { key: "all", from: null, to: today };
    default:
      return { key: "fy", from: `${fyStartYear}-04-01`, to: today };
  }
}

export const financialYearLabel = financialYear;
