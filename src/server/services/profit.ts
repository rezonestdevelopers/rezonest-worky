import { dateOnlyKey, keyToDate } from "@/lib/dates";
import { buildProfit, monthlyRevenueVsExpenses, profitOf, timeCost } from "@/lib/profit";
import { sum } from "@/lib/money/decimal";
import type { Db, Tx } from "./shared";

const within = (from: string | null, to: string) => ({ ...(from ? { gte: keyToDate(from) } : {}), lte: keyToDate(to) });

/** Everything that goes into profit in a period. Same rules as the dashboard: before GST, tax invoices only. */
export async function loadProfitFacts(db: Db | Tx, input: { from: string | null; to: string; clientId?: string; projectId?: string }) {
  const scope = { ...(input.clientId ? { clientId: input.clientId } : {}), ...(input.projectId ? { projectId: input.projectId } : {}) };
  const [invoices, credits, expenses, logs] = await Promise.all([
    db.invoice.findMany({ where: { type: "TAX", status: "ISSUED", invoiceDate: within(input.from, input.to), ...scope }, select: { clientId: true, projectId: true, taxableTotal: true } }),
    db.creditNote.findMany({
      where: { date: within(input.from, input.to), invoice: { type: "TAX", ...scope } },
      select: { taxableAmount: true, invoice: { select: { clientId: true, projectId: true } } },
    }),
    db.expense.findMany({ where: { archivedAt: null, date: within(input.from, input.to), ...scope }, select: { clientId: true, projectId: true, amount: true } }),
    db.timeLog.findMany({
      // Time was still spent if the task was later archived, so it still counts, like the dashboard.
      where: { date: within(input.from, input.to), task: scope },
      select: { minutes: true, task: { select: { clientId: true, projectId: true } }, user: { select: { employee: { select: { hourlyCost: true } } } } },
    }),
  ]);
  return {
    invoices: invoices.map((i) => ({ clientId: i.clientId, projectId: i.projectId, taxable: i.taxableTotal })),
    credits: credits.map((c) => ({ clientId: c.invoice.clientId, projectId: c.invoice.projectId, taxable: c.taxableAmount })),
    expenses: expenses.map((e) => ({ clientId: e.clientId, projectId: e.projectId, amount: e.amount })),
    time: logs.map((l) => ({ clientId: l.task.clientId, projectId: l.task.projectId, minutes: l.minutes, hourlyCost: l.user.employee?.hourlyCost ?? 0 })),
  };
}

export async function profitReport(db: Db | Tx, from: string | null, to: string) {
  return buildProfit(await loadProfitFacts(db, { from, to }));
}

/** One client's or project's profit, for its own page. */
export async function profitFor(db: Db | Tx, input: { from: string | null; to: string; clientId?: string; projectId?: string }) {
  const f = await loadProfitFacts(db, input);
  return profitOf({
    revenue: sum(f.invoices.map((i) => i.taxable)).minus(sum(f.credits.map((c) => c.taxable))),
    expenses: sum(f.expenses.map((e) => e.amount)),
    time: sum(f.time.map((t) => timeCost(t.minutes, t.hourlyCost))),
  });
}

export async function monthlyReport(db: Db | Tx, months: string[]) {
  const from = `${months[0]}-01`;
  const [invoices, credits, expenses] = await Promise.all([
    db.invoice.findMany({ where: { type: "TAX", status: "ISSUED", invoiceDate: { gte: keyToDate(from) } }, select: { invoiceDate: true, taxableTotal: true } }),
    db.creditNote.findMany({ where: { date: { gte: keyToDate(from) }, invoice: { type: "TAX" } }, select: { date: true, taxableAmount: true } }),
    db.expense.findMany({ where: { archivedAt: null, date: { gte: keyToDate(from) } }, select: { date: true, amount: true } }),
  ]);
  return monthlyRevenueVsExpenses({
    months,
    invoices: invoices.map((i) => ({ dateKey: dateOnlyKey(i.invoiceDate), taxable: i.taxableTotal })),
    credits: credits.map((c) => ({ dateKey: dateOnlyKey(c.date), taxable: c.taxableAmount })),
    expenses: expenses.map((e) => ({ dateKey: dateOnlyKey(e.date), amount: e.amount })),
  });
}
