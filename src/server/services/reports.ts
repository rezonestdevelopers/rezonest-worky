import { adMetrics, totalEntries } from "@/lib/ad-metrics";
import { addDaysKey, dateOnlyKey, daysBetweenKeys, formatDateKey, formatMonthKey, istDateKey, keyToDate, monthKeyOf, monthRange } from "@/lib/dates";
import { effectiveHealth } from "@/lib/health";
import { AGEING_BUCKETS, AGEING_LABEL, ageingKey, type AgeingKey, advanceLeft, paymentModeLabel } from "@/lib/invoice-rules";
import { Decimal, sum, toDecimal } from "@/lib/money/decimal";
import { formatINR } from "@/lib/money/format";
import { buildProfit, expenseCategoryLabel, timeCost } from "@/lib/profit";
import { assetKindLabel } from "@/lib/renewals";
import {
  buildClientMonthlyDoc,
  conversionRate,
  daysLate,
  deliveryByFormat,
  financialYearMonths,
  gstByMonth,
  isRankingTarget,
  lastMonthsTo,
  mrrTrend,
  onTimeStats,
  safeFileName,
  targetAchievement,
  type Cell,
  type ReportDoc,
  type ReportSection,
} from "@/lib/reports";
import { humanize } from "@/lib/status";
import { BusinessError, type Db, type Tx } from "./shared";
import { loadProfitFacts, profitFor } from "./profit";

type Reader = Db | Tx;
const money = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? null : toDecimal(v).toFixed(2));
const within = (from: string, to: string) => ({ gte: keyToDate(from), lte: keyToDate(to) });
/** A DateTime column compared with whole IST days. */
const withinInstants = (from: string, to: string) => ({ gte: new Date(`${from}T00:00:00+05:30`), lte: new Date(`${to}T23:59:59.999+05:30`) });

// ─── GST summary ─────────────────────────────────────────────────────────────

export async function gstReportDoc(db: Reader, input: { fy?: string | null; today: string }): Promise<ReportDoc> {
  const fy = financialYearMonths(input.fy, input.today);
  const [invoices, credits, items] = await Promise.all([
    db.invoice.findMany({
      where: { type: "TAX", status: "ISSUED", invoiceDate: within(fy.from, fy.to) },
      orderBy: [{ invoiceDate: "asc" }, { number: "asc" }],
      select: { number: true, invoiceDate: true, taxMode: true, placeOfSupply: true, taxableTotal: true, cgstTotal: true, sgstTotal: true, igstTotal: true, grandTotal: true, clientSnapshot: true, client: { select: { companyName: true, gstin: true } } },
    }),
    db.creditNote.findMany({
      where: { date: within(fy.from, fy.to), invoice: { type: "TAX" } },
      orderBy: [{ date: "asc" }, { number: "asc" }],
      select: { number: true, date: true, reason: true, taxableAmount: true, cgstAmount: true, sgstAmount: true, igstAmount: true, totalAmount: true, invoice: { select: { number: true } }, client: { select: { companyName: true, gstin: true } } },
    }),
    db.invoiceItem.findMany({
      where: { invoice: { type: "TAX", status: "ISSUED", invoiceDate: within(fy.from, fy.to), taxMode: { in: ["INTRA_STATE", "INTER_STATE"] } } },
      select: { sacCode: true, gstRate: true, taxableValue: true, cgstAmount: true, sgstAmount: true, igstAmount: true },
    }),
  ]);
  const months = gstByMonth(
    fy.months,
    invoices.map((i) => ({ dateKey: dateOnlyKey(i.invoiceDate), taxMode: i.taxMode, taxable: i.taxableTotal, cgst: i.cgstTotal, sgst: i.sgstTotal, igst: i.igstTotal })),
    credits.map((c) => ({ dateKey: dateOnlyKey(c.date), taxable: c.taxableAmount, cgst: c.cgstAmount, sgst: c.sgstAmount, igst: c.igstAmount })),
  );
  const total = (pick: (r: (typeof months)[number]) => Decimal) => sum(months.map(pick));
  const sac = new Map<string, { sac: string; rate: string; taxable: Decimal; tax: Decimal }>();
  for (const i of items) {
    const key = `${i.sacCode ?? ""}|${i.gstRate.toString()}`;
    const row = sac.get(key) ?? { sac: i.sacCode ?? "Not given", rate: i.gstRate.toString(), taxable: new Decimal(0), tax: new Decimal(0) };
    row.taxable = row.taxable.plus(toDecimal(i.taxableValue));
    row.tax = row.tax.plus(toDecimal(i.cgstAmount)).plus(toDecimal(i.sgstAmount)).plus(toDecimal(i.igstAmount));
    sac.set(key, row);
  }
  const gstinOf = (snapshot: unknown, fallback: string | null) => {
    const stored = (snapshot ?? {}) as { gstin?: string | null };
    return "gstin" in (stored as object) ? (stored.gstin ?? "") : (fallback ?? "");
  };
  const netTaxable = total((r) => r.taxable).minus(total((r) => r.creditTaxable));
  const netTax = total((r) => r.netTax);
  return {
    title: "GST summary",
    subtitle: `Financial year ${fy.fy}`,
    fileName: `gst-summary-${fy.fy}`,
    landscape: true,
    summary: [
      { label: "Taxable value, after credit notes", value: formatINR(netTaxable) },
      { label: "Net output tax", value: formatINR(netTax) },
      { label: "Tax invoices", value: String(months.reduce((n, r) => n + r.count, 0)) },
      { label: "Credit notes", value: String(credits.length) },
    ],
    sections: [
      {
        title: "Output tax by month",
        note: "Issued tax invoices by invoice date. A credit note reduces the month it was raised in. Round-off isn't included.",
        columns: [{ label: "Month" }, { label: "Invoices", kind: "number" }, { label: "Taxable", kind: "money" }, { label: "CGST", kind: "money" }, { label: "SGST", kind: "money" }, { label: "IGST", kind: "money" }, { label: "Credit notes, taxable", kind: "money" }, { label: "Credit notes, tax", kind: "money" }, { label: "Net output tax", kind: "money" }, { label: "No-GST value", kind: "money" }],
        rows: months.map((r) => [formatMonthKey(r.month), r.count, money(r.taxable), money(r.cgst), money(r.sgst), money(r.igst), money(r.creditTaxable), money(r.creditCgst.plus(r.creditSgst).plus(r.creditIgst)), money(r.netTax), money(r.noGst)]),
        total: ["Total", months.reduce((n, r) => n + r.count, 0), money(total((r) => r.taxable)), money(total((r) => r.cgst)), money(total((r) => r.sgst)), money(total((r) => r.igst)), money(total((r) => r.creditTaxable)), money(total((r) => r.creditCgst.plus(r.creditSgst).plus(r.creditIgst))), money(netTax), money(total((r) => r.noGst))],
        empty: "No months in this year yet.",
      },
      {
        title: "By SAC code and rate",
        note: "Before credit notes, since they're listed separately below.",
        columns: [{ label: "SAC" }, { label: "GST rate", kind: "percent" }, { label: "Taxable", kind: "money" }, { label: "Tax", kind: "money" }],
        rows: [...sac.values()].sort((a, b) => a.sac.localeCompare(b.sac) || Number(a.rate) - Number(b.rate)).map((r) => [r.sac, Number(r.rate), money(r.taxable), money(r.tax)]),
        empty: "No GST invoices in this year.",
      },
      {
        title: "Tax invoices",
        columns: [{ label: "Number" }, { label: "Date", kind: "date" }, { label: "Client" }, { label: "Client GSTIN" }, { label: "Place of supply" }, { label: "Taxable", kind: "money" }, { label: "CGST", kind: "money" }, { label: "SGST", kind: "money" }, { label: "IGST", kind: "money" }, { label: "Total", kind: "money" }],
        rows: invoices.map((i) => [i.number, dateOnlyKey(i.invoiceDate), i.client.companyName, gstinOf(i.clientSnapshot, i.client.gstin) || null, i.placeOfSupply, money(i.taxableTotal), money(i.cgstTotal), money(i.sgstTotal), money(i.igstTotal), money(i.grandTotal)]),
        empty: "No tax invoices in this year.",
      },
      {
        title: "Credit notes",
        columns: [{ label: "Number" }, { label: "Date", kind: "date" }, { label: "Against invoice" }, { label: "Client" }, { label: "Client GSTIN" }, { label: "Reason" }, { label: "Taxable", kind: "money" }, { label: "CGST", kind: "money" }, { label: "SGST", kind: "money" }, { label: "IGST", kind: "money" }, { label: "Total", kind: "money" }],
        rows: credits.map((c) => [c.number, dateOnlyKey(c.date), c.invoice.number, c.client.companyName, c.client.gstin, c.reason, money(c.taxableAmount), money(c.cgstAmount), money(c.sgstAmount), money(c.igstAmount), money(c.totalAmount)]),
        empty: "No credit notes in this year.",
      },
    ],
  };
}

// ─── Agency report ───────────────────────────────────────────────────────────

/** Same rule as the dashboard: invoice lines before GST, with each credit note shared across its invoice's lines. */
async function revenueFacts(db: Reader, from: string, to: string) {
  const [items, credits] = await Promise.all([
    db.invoiceItem.findMany({
      where: { invoice: { type: "TAX", status: "ISSUED", invoiceDate: within(from, to) } },
      select: { taxableValue: true, serviceId: true, invoice: { select: { invoiceDate: true, client: { select: { id: true, sectorId: true, leadSourceId: true } } } } },
    }),
    db.creditNote.findMany({
      where: { date: within(from, to), invoice: { status: "ISSUED" } },
      select: { date: true, taxableAmount: true, client: { select: { id: true, sectorId: true, leadSourceId: true } }, invoice: { select: { taxableTotal: true, items: { select: { serviceId: true, taxableValue: true } } } } },
    }),
  ]);
  const facts = items.map((i) => ({ dateKey: dateOnlyKey(i.invoice.invoiceDate), serviceId: i.serviceId, client: i.invoice.client, amount: toDecimal(i.taxableValue) }));
  for (const c of credits) {
    const whole = toDecimal(c.invoice.taxableTotal);
    if (whole.isZero()) continue;
    for (const item of c.invoice.items) {
      facts.push({ dateKey: dateOnlyKey(c.date), serviceId: item.serviceId, client: c.client, amount: toDecimal(c.taxableAmount).times(toDecimal(item.taxableValue).dividedBy(whole)).negated().toDecimalPlaces(2) });
    }
  }
  return facts;
}

const addTo = (map: Map<string, Decimal>, key: string, amount: Decimal) => map.set(key, (map.get(key) ?? new Decimal(0)).plus(amount));

async function ageingSection(db: Reader, today: string): Promise<ReportSection> {
  const [invoices, payments] = await Promise.all([
    db.invoice.findMany({ where: { type: "TAX", status: "ISSUED", balanceDue: { gt: 0 } }, select: { clientId: true, dueDate: true, balanceDue: true, client: { select: { companyName: true } } } }),
    db.payment.findMany({ where: { voidedAt: null }, select: { clientId: true, amount: true, allocations: { select: { amount: true } }, client: { select: { companyName: true } } } }),
  ]);
  const rows = new Map<string, { client: string; buckets: Record<AgeingKey, Decimal>; total: Decimal; advance: Decimal }>();
  const rowFor = (id: string, client: string) => {
    let r = rows.get(id);
    if (!r) {
      r = { client, buckets: Object.fromEntries(AGEING_BUCKETS.map((b) => [b, new Decimal(0)])) as Record<AgeingKey, Decimal>, total: new Decimal(0), advance: new Decimal(0) };
      rows.set(id, r);
    }
    return r;
  };
  for (const i of invoices) {
    const r = rowFor(i.clientId, i.client.companyName);
    const b = ageingKey(daysBetweenKeys(dateOnlyKey(i.dueDate), today));
    r.buckets[b] = r.buckets[b].plus(toDecimal(i.balanceDue));
    r.total = r.total.plus(toDecimal(i.balanceDue));
  }
  for (const p of payments) {
    const left = advanceLeft(p.amount, p.allocations);
    if (left.greaterThan(0)) {
      const r = rowFor(p.clientId, p.client.companyName);
      r.advance = r.advance.plus(left);
    }
  }
  const list = [...rows.values()].sort((a, b) => b.total.comparedTo(a.total) || a.client.localeCompare(b.client));
  return {
    title: "Outstanding and ageing",
    note: `As of ${formatDateKey(today)}, whatever period is chosen, by days past the due date.`,
    columns: [{ label: "Client" }, ...AGEING_BUCKETS.map((b) => ({ label: AGEING_LABEL[b], kind: "money" as const })), { label: "Total", kind: "money" }, { label: "Advance", kind: "money" }],
    rows: list.map((r) => [r.client, ...AGEING_BUCKETS.map((b) => money(r.buckets[b])), money(r.total), money(r.advance)]),
    total: ["Total", ...AGEING_BUCKETS.map((b) => money(sum(list.map((r) => r.buckets[b])))), money(sum(list.map((r) => r.total))), money(sum(list.map((r) => r.advance)))],
    empty: "Nothing is outstanding.",
  };
}

export async function agencyReportDoc(db: Reader, input: { from: string; to: string; today: string }): Promise<ReportDoc> {
  const { from, to, today } = input;
  const [facts, services, sectors, sources, clients, decided, retainers, users, openTasks, doneTasks, assets, profitFacts, serviceTime, serviceExpenses, ageing] = await Promise.all([
    revenueFacts(db, from, to),
    db.service.findMany({ select: { id: true, name: true } }),
    db.sector.findMany({ select: { id: true, name: true } }),
    db.leadSource.findMany({ select: { id: true, name: true } }),
    db.client.findMany({ select: { id: true, companyName: true } }),
    db.offerStatusHistory.findMany({ where: { toStatus: { in: ["ACCEPTED", "REJECTED", "EXPIRED"] }, createdAt: withinInstants(from, to), offer: { isTemplate: false } }, select: { offerId: true, toStatus: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
    db.project.findMany({ where: { isRetainer: true, status: "ACTIVE", archivedAt: null }, select: { retainerStart: true, retainerEnd: true, services: { where: { isActive: true, billingType: "MONTHLY_RETAINER" }, select: { monthlyValue: true } } } }),
    db.user.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.task.findMany({ where: { archivedAt: null, status: { not: "DONE" } }, select: { assigneeId: true, dueDate: true } }),
    db.task.findMany({ where: { archivedAt: null, status: "DONE", completedAt: withinInstants(from, to) }, select: { assigneeId: true, dueDate: true, completedAt: true } }),
    db.domainHostingAsset.findMany({ where: { archivedAt: null, expiryDate: { lte: keyToDate(addDaysKey(today, 365)) } }, orderBy: { expiryDate: "asc" }, select: { name: true, kind: true, expiryDate: true, costPrice: true, renewalPrice: true, autoRenew: true, client: { select: { companyName: true } } } }),
    loadProfitFacts(db, { from, to }),
    db.timeLog.findMany({ where: { date: within(from, to) }, select: { minutes: true, task: { select: { serviceId: true } }, user: { select: { employee: { select: { hourlyCost: true } } } } } }),
    db.expense.findMany({ where: { archivedAt: null, date: within(from, to), projectId: { not: null } }, select: { amount: true, project: { select: { services: { where: { isActive: true }, select: { serviceId: true } } } } } }),
    ageingSection(db, today),
  ]);

  const serviceName = new Map(services.map((s) => [s.id, s.name]));
  const clientName = new Map(clients.map((c) => [c.id, c.companyName]));
  const byMonth = new Map<string, Decimal>();
  const byService = new Map<string, Decimal>();
  const bySector = new Map<string, Decimal>();
  const bySource = new Map<string, Decimal>();
  for (const f of facts) {
    addTo(byMonth, monthKeyOf(f.dateKey), f.amount);
    addTo(byService, f.serviceId ?? "", f.amount);
    addTo(bySector, f.client.sectorId ?? "", f.amount);
    addTo(bySource, f.client.leadSourceId ?? "", f.amount);
  }
  const revenue = sum(facts.map((f) => f.amount));
  const share = (v: Decimal) => (revenue.greaterThan(0) ? Math.round(v.dividedBy(revenue).times(100).toNumber()) : null);
  const sorted = (map: Map<string, Decimal>, names: Map<string, string>, other: string): Cell[][] =>
    [...map.entries()].sort((a, b) => b[1].comparedTo(a[1])).map(([id, v]) => [names.get(id) ?? other, money(v), share(v)]);

  // An offer's latest decision in the period is the one that counts.
  const decision = new Map(decided.map((d) => [d.offerId, d.toStatus as string]));
  const outcome = { accepted: 0, rejected: 0, expired: 0 };
  for (const s of decision.values()) {
    if (s === "ACCEPTED") outcome.accepted++;
    else if (s === "REJECTED") outcome.rejected++;
    else outcome.expired++;
  }
  const rate = conversionRate(outcome);

  const trend = mrrTrend(
    lastMonthsTo(to > today ? today : to, 12),
    today,
    retainers.map((p) => ({ start: p.retainerStart ? dateOnlyKey(p.retainerStart) : null, end: p.retainerEnd ? dateOnlyKey(p.retainerEnd) : null, monthly: sum(p.services.map((s) => s.monthlyValue)) })),
  );

  const workload = users
    .map((u) => {
      const open = openTasks.filter((t) => t.assigneeId === u.id);
      const stats = onTimeStats(doneTasks.filter((t) => t.assigneeId === u.id).map((t) => ({ dueKey: t.dueDate ? dateOnlyKey(t.dueDate) : null, doneKey: t.completedAt ? istDateKey(t.completedAt) : null })));
      return { name: u.name, open: open.length, overdue: open.filter((t) => t.dueDate && dateOnlyKey(t.dueDate) < today).length, ...stats };
    })
    .filter((w) => w.open || w.judged)
    .sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));

  const profit = buildProfit(profitFacts);

  // By service: an expense counts only where its project has just one service. Any split beyond that would be a guess.
  const svcTime = new Map<string, Decimal>();
  for (const l of serviceTime) if (l.task.serviceId) addTo(svcTime, l.task.serviceId, timeCost(l.minutes, l.user.employee?.hourlyCost ?? 0));
  const svcExpense = new Map<string, Decimal>();
  let unsplit = new Decimal(0);
  for (const e of serviceExpenses) {
    const ids = [...new Set(e.project?.services.map((s) => s.serviceId) ?? [])];
    if (ids.length === 1) addTo(svcExpense, ids[0], toDecimal(e.amount));
    else unsplit = unsplit.plus(toDecimal(e.amount));
  }
  const serviceRows = [...new Set([...byService.keys(), ...svcTime.keys(), ...svcExpense.keys()])]
    .map((id) => {
      const r = byService.get(id) ?? new Decimal(0);
      const e = svcExpense.get(id) ?? new Decimal(0);
      const t = svcTime.get(id) ?? new Decimal(0);
      return { name: serviceName.get(id) ?? "Other items", revenue: r, expenses: e, time: t, profit: r.minus(e).minus(t) };
    })
    .sort((a, b) => b.profit.comparedTo(a.profit));

  return {
    title: "Agency report",
    subtitle: `${formatDateKey(from)} to ${formatDateKey(to)}`,
    fileName: `agency-report-${from}-to-${to}`,
    landscape: true,
    summary: [
      { label: "Revenue before GST", value: formatINR(revenue) },
      { label: "MRR now", value: formatINR((trend.at(-1)?.mrr ?? new Decimal(0))) },
      { label: "Offer conversion", value: rate === null ? "—" : `${rate}%` },
    ],
    sections: [
      { title: "Revenue by month", note: "Before GST, after credit notes.", columns: [{ label: "Month" }, { label: "Revenue", kind: "money" }], rows: [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([m, v]) => [formatMonthKey(m), money(v)]), total: ["Total", money(revenue)], empty: "No revenue in this period." },
      { title: "Revenue by service", columns: [{ label: "Service" }, { label: "Revenue", kind: "money" }, { label: "Share", kind: "percent" }], rows: sorted(byService, serviceName, "Other items"), empty: "No revenue in this period." },
      { title: "Revenue by sector", columns: [{ label: "Sector" }, { label: "Revenue", kind: "money" }, { label: "Share", kind: "percent" }], rows: sorted(bySector, new Map(sectors.map((s) => [s.id, s.name])), "No sector"), empty: "No revenue in this period." },
      { title: "Revenue by lead source", columns: [{ label: "Lead source" }, { label: "Revenue", kind: "money" }, { label: "Share", kind: "percent" }], rows: sorted(bySource, new Map(sources.map((s) => [s.id, s.name])), "No source"), empty: "No revenue in this period." },
      { title: "Offer conversion", note: "Offers decided in this period. Those still waiting don't count either way.", columns: [{ label: "Accepted", kind: "number" }, { label: "Rejected", kind: "number" }, { label: "Expired", kind: "number" }, { label: "Conversion", kind: "percent" }], rows: [[outcome.accepted, outcome.rejected, outcome.expired, rate]] },
      { title: "MRR trend", note: "Retainers active today, by their start and end dates. A retainer that's since ended or been paused isn't counted in past months.", columns: [{ label: "Month" }, { label: "MRR", kind: "money" }, { label: "Retainers", kind: "number" }], rows: trend.map((t) => [formatMonthKey(t.month), money(t.mrr), t.count]) },
      ageing,
      { title: "Team workload and on-time delivery", note: "Open tasks today, and tasks finished in this period. Tasks with no due date aren't judged.", columns: [{ label: "Team member" }, { label: "Open", kind: "number" }, { label: "Overdue", kind: "number" }, { label: "Finished on time", kind: "number" }, { label: "Finished late", kind: "number" }, { label: "On-time", kind: "percent" }], rows: workload.map((w) => [w.name, w.open, w.overdue, w.onTime, w.late, w.percent]), empty: "No tasks in this period." },
      { title: "Renewals calendar", note: "Everything expired or expiring within the next 12 months.", columns: [{ label: "Expires", kind: "date" }, { label: "Item" }, { label: "Type" }, { label: "Client" }, { label: "Auto-renew" }, { label: "Our cost", kind: "money" }, { label: "Renewal price", kind: "money" }], rows: assets.map((a) => [dateOnlyKey(a.expiryDate), a.name, assetKindLabel(a.kind), a.client.companyName, a.autoRenew ? "Yes" : "No", money(a.costPrice), money(a.renewalPrice)]), empty: "No renewals coming up." },
      { title: "Profit by client", note: `Before GST, less linked expenses and team time. Agency overheads of ${formatINR(profit.overheads)} aren't taken off any client.`, columns: [{ label: "Client" }, { label: "Revenue", kind: "money" }, { label: "Expenses", kind: "money" }, { label: "Team time", kind: "money" }, { label: "Profit", kind: "money" }, { label: "Margin", kind: "percent" }], rows: profit.clients.map((c) => [clientName.get(c.id) ?? "—", money(c.revenue), money(c.expenses), money(c.time), money(c.profit), c.marginPercent]), empty: "Nothing in this period." },
      { title: "Profit by service", note: `An expense counts against a service only when its project has just that one service. Expenses on projects with several services, ${formatINR(unsplit)}, aren't split.`, columns: [{ label: "Service" }, { label: "Revenue", kind: "money" }, { label: "Expenses", kind: "money" }, { label: "Team time", kind: "money" }, { label: "Profit", kind: "money" }], rows: serviceRows.map((s) => [s.name, money(s.revenue), money(s.expenses), money(s.time), money(s.profit)]), empty: "Nothing in this period." },
    ],
  };
}

// ─── Internal report on one client ───────────────────────────────────────────

export async function clientReportDoc(db: Reader, input: { clientId: string; from: string; to: string; today: string }): Promise<ReportDoc> {
  const { clientId, from, to } = input;
  const client = await db.client.findUnique({
    where: { id: clientId },
    include: { sector: { select: { name: true } }, leadSource: { select: { name: true } }, contacts: { where: { isPrimary: true, archivedAt: null }, take: 1 } },
  });
  if (!client) throw new BusinessError("This client no longer exists.");
  const [offers, projects, deliverables, tasks, changes, campaigns, invoices, payments, expenses, profit, outstanding] = await Promise.all([
    db.offer.findMany({ where: { clientId, isTemplate: false, archivedAt: null, offerDate: within(from, to) }, orderBy: { offerDate: "asc" }, select: { number: true, title: true, status: true, offerDate: true, grandTotal: true, statusHistory: { orderBy: { createdAt: "asc" }, select: { toStatus: true, createdAt: true, note: true } } } }),
    db.project.findMany({
      where: { clientId, archivedAt: null },
      orderBy: { startDate: "asc" },
      select: {
        name: true, code: true, status: true, startDate: true, deadline: true, retainerEnd: true, progressPercent: true, healthAuto: true, healthOverride: true,
        services: { where: { isActive: true }, select: { description: true, billingType: true, rate: true, monthlyValue: true, service: { select: { name: true } } } },
        targets: { orderBy: { sortOrder: "asc" }, select: { metric: true, unit: true, targetValue: true, higherIsBetter: true, progress: { where: { month: { gte: monthKeyOf(from), lte: monthKeyOf(to) } }, orderBy: { month: "desc" }, take: 1, select: { month: true, actualValue: true } } } },
      },
    }),
    db.deliverable.findMany({ where: { project: { clientId }, month: { gte: monthKeyOf(from), lte: monthKeyOf(to) } }, select: { month: true, format: true, deliveredAt: true } }),
    db.task.findMany({
      where: { clientId, archivedAt: null, OR: [{ dueDate: within(from, to) }, { completedAt: withinInstants(from, to) }] },
      orderBy: [{ dueDate: "asc" }, { title: "asc" }],
      take: 500,
      select: { title: true, status: true, startDate: true, dueDate: true, completedAt: true, assignee: { select: { name: true } }, project: { select: { name: true } } },
    }),
    db.changeRequest.findMany({ where: { clientId, createdAt: withinInstants(from, to) }, orderBy: { createdAt: "asc" }, select: { description: true, estimate: true, isBillable: true, status: true, createdAt: true } }),
    db.adCampaign.findMany({ where: { clientId, archivedAt: null }, orderBy: { startDate: "asc" }, select: { name: true, plannedBudget: true, entries: { where: { archivedAt: null, periodStart: within(from, to) }, select: { spend: true, impressions: true, clicks: true, leads: true, conversionValue: true } } } }),
    db.invoice.findMany({ where: { clientId, status: { in: ["ISSUED", "CONVERTED", "CANCELLED"] }, number: { not: null }, invoiceDate: within(from, to) }, orderBy: { invoiceDate: "asc" }, select: { number: true, type: true, status: true, paymentStatus: true, invoiceDate: true, dueDate: true, taxableTotal: true, grandTotal: true, amountPaid: true, tdsTotal: true, creditedTotal: true, balanceDue: true } }),
    db.payment.findMany({ where: { clientId, voidedAt: null, date: within(from, to) }, orderBy: { date: "asc" }, select: { date: true, amount: true, tdsAmount: true, tdsSection: true, mode: true, reference: true } }),
    db.expense.findMany({ where: { clientId, archivedAt: null, date: within(from, to) }, orderBy: { date: "asc" }, select: { date: true, category: true, description: true, vendor: true, amount: true, gstPaid: true } }),
    profitFor(db, { from, to, clientId }),
    db.invoice.aggregate({ where: { clientId, type: "TAX", status: "ISSUED" }, _sum: { balanceDue: true } }),
  ]);

  const deliveryRows = new Map<string, { month: string; rows: { format: string | null; delivered: boolean }[] }>();
  for (const d of deliverables) {
    const row = deliveryRows.get(d.month ?? "") ?? { month: d.month ?? "", rows: [] };
    row.rows.push({ format: d.format, delivered: !!d.deliveredAt });
    deliveryRows.set(d.month ?? "", row);
  }
  const billed = sum(payments.map((p) => p.amount));
  const tds = sum(payments.map((p) => p.tdsAmount));
  const adTotals = campaigns.map((c) => {
    const t = totalEntries(c.entries);
    return { name: c.name, totals: t, metrics: adMetrics(t, c.plannedBudget), budget: c.plannedBudget };
  });
  return {
    title: "Client report (internal)",
    subtitle: `${client.companyName} · ${formatDateKey(from)} to ${formatDateKey(to)}`,
    fileName: safeFileName(`${client.companyName}-internal-${from}-to-${to}`),
    landscape: true,
    summary: [
      { label: "Revenue before GST", value: formatINR(profit.revenue) },
      { label: "Profit", value: formatINR(profit.profit) },
      { label: "Received", value: formatINR(billed) },
      { label: "Outstanding today", value: formatINR(toDecimal(outstanding._sum.balanceDue)) },
    ],
    sections: [
      {
        title: "Profile",
        columns: [{ label: "Detail" }, { label: "Value" }],
        rows: [
          ["Contact", client.contacts[0]?.name ?? null], ["Phone", client.phone], ["Email", client.email], ["Sector", client.sector?.name ?? null], ["Lead source", client.leadSource?.name ?? null],
          ["City", client.city], ["State", `${client.state} (${client.stateCode})`], ["GSTIN", client.gstin], ["PAN", client.pan], ["Status", humanize(client.status)],
        ],
      },
      { title: "Offers", columns: [{ label: "Number" }, { label: "Title" }, { label: "Date", kind: "date" }, { label: "Status" }, { label: "Total", kind: "money" }], rows: offers.map((o) => [o.number, o.title, dateOnlyKey(o.offerDate), humanize(o.status), money(o.grandTotal)]), empty: "No offers in this period." },
      { title: "Offer status history", columns: [{ label: "Offer" }, { label: "Status" }, { label: "When", kind: "date" }, { label: "Note" }], rows: offers.flatMap((o) => o.statusHistory.map((h): Cell[] => [o.number, humanize(h.toStatus), istDateKey(h.createdAt), h.note])), empty: "No status changes in this period." },
      { title: "Projects", columns: [{ label: "Project" }, { label: "Status" }, { label: "Health" }, { label: "Progress", kind: "percent" }, { label: "Started", kind: "date" }, { label: "Deadline or retainer end", kind: "date" }], rows: projects.map((p) => [`${p.code} ${p.name}`, humanize(p.status), humanize(effectiveHealth(p.healthAuto, p.healthOverride)), p.progressPercent, dateOnlyKey(p.startDate), p.deadline ? dateOnlyKey(p.deadline) : p.retainerEnd ? dateOnlyKey(p.retainerEnd) : null]), empty: "No projects." },
      { title: "Services", columns: [{ label: "Project" }, { label: "Service" }, { label: "Billing" }, { label: "Value", kind: "money" }], rows: projects.flatMap((p) => p.services.map((s): Cell[] => [p.name, s.description ?? s.service.name, humanize(s.billingType), money(s.billingType === "MONTHLY_RETAINER" ? s.monthlyValue : s.rate)])), empty: "No services." },
      { title: "Targets vs actual", note: "The latest figure entered in this period.", columns: [{ label: "Project" }, { label: "Target" }, { label: "Goal", kind: "number" }, { label: "Actual", kind: "number" }, { label: "Month" }, { label: "Achieved", kind: "percent" }], rows: projects.flatMap((p) => p.targets.map((t): Cell[] => [p.name, t.metric, t.targetValue.toString(), t.progress[0]?.actualValue.toString() ?? null, t.progress[0] ? formatMonthKey(t.progress[0].month) : null, targetAchievement({ target: t.targetValue, actual: t.progress[0]?.actualValue, higherIsBetter: t.higherIsBetter })])), empty: "No targets set." },
      { title: "Deliverables committed vs delivered", columns: [{ label: "Month" }, { label: "Type" }, { label: "Committed", kind: "number" }, { label: "Delivered", kind: "number" }], rows: [...deliveryRows.values()].sort((a, b) => a.month.localeCompare(b.month)).flatMap((m) => deliveryByFormat(m.rows).map((d): Cell[] => [m.month ? formatMonthKey(m.month) : "One-off", d.label, d.committed, d.delivered])), empty: "No deliverables in this period." },
      { title: "Task timeline", note: tasks.length >= 500 ? "The first 500 tasks in this period." : "Planned against actual.", columns: [{ label: "Task" }, { label: "Project" }, { label: "Assigned to" }, { label: "Status" }, { label: "Due", kind: "date" }, { label: "Finished", kind: "date" }, { label: "Days late", kind: "number" }], rows: tasks.map((t) => { const due = t.dueDate ? dateOnlyKey(t.dueDate) : null; const done = t.completedAt ? istDateKey(t.completedAt) : null; return [t.title, t.project?.name ?? null, t.assignee?.name ?? null, humanize(t.status), due, done, daysLate(due, done)]; }), empty: "No tasks in this period." },
      { title: "Change requests", columns: [{ label: "Raised", kind: "date" }, { label: "Request" }, { label: "Billable" }, { label: "Status" }, { label: "Estimate", kind: "money" }], rows: changes.map((c) => [istDateKey(c.createdAt), c.description, c.isBillable ? "Yes" : "No", humanize(c.status), money(c.estimate)]), empty: "No change requests in this period." },
      { title: "Ad spend and results", note: "Ad spend is the client's budget, not your revenue.", columns: [{ label: "Campaign" }, { label: "Budget", kind: "money" }, { label: "Spend", kind: "money" }, { label: "Impressions", kind: "number" }, { label: "Clicks", kind: "number" }, { label: "CTR", kind: "percent" }, { label: "Leads", kind: "number" }, { label: "Cost per lead", kind: "money" }, { label: "ROAS" }], rows: adTotals.filter((a) => a.totals.spend.greaterThan(0) || a.totals.impressions > 0).map((a) => [a.name, money(a.budget), money(a.totals.spend), a.totals.impressions, a.totals.clicks, a.metrics.ctr, a.totals.leads, money(a.metrics.cpl), a.metrics.roas === null ? null : `${a.metrics.roas}x`]), empty: "No ad results in this period." },
      { title: "Invoices", columns: [{ label: "Number" }, { label: "Type" }, { label: "Status" }, { label: "Payment" }, { label: "Date", kind: "date" }, { label: "Due", kind: "date" }, { label: "Taxable", kind: "money" }, { label: "Total", kind: "money" }, { label: "Paid", kind: "money" }, { label: "TDS", kind: "money" }, { label: "Credit notes", kind: "money" }, { label: "Balance", kind: "money" }], rows: invoices.map((i) => { const live = i.type === "TAX" && i.status === "ISSUED"; return [i.number, humanize(i.type), humanize(i.status), live ? humanize(i.paymentStatus) : null, dateOnlyKey(i.invoiceDate), dateOnlyKey(i.dueDate), money(i.taxableTotal), money(i.grandTotal), money(i.amountPaid), money(i.tdsTotal), money(i.creditedTotal), live ? money(i.balanceDue) : null]; }), empty: "No invoices in this period." },
      { title: "Payments and TDS", columns: [{ label: "Date", kind: "date" }, { label: "Mode" }, { label: "Reference" }, { label: "Received", kind: "money" }, { label: "TDS", kind: "money" }, { label: "TDS section" }], rows: payments.map((p) => [dateOnlyKey(p.date), paymentModeLabel(p.mode), p.reference, money(p.amount), money(p.tdsAmount), p.tdsSection]), total: ["Total", null, null, money(billed), money(tds), null], empty: "No payments in this period." },
      { title: "Expenses", columns: [{ label: "Date", kind: "date" }, { label: "Category" }, { label: "Description" }, { label: "Paid to" }, { label: "Amount", kind: "money" }, { label: "GST paid", kind: "money" }], rows: expenses.map((e) => [dateOnlyKey(e.date), expenseCategoryLabel(e.category), e.description, e.vendor, money(e.amount), money(e.gstPaid)]), empty: "No expenses in this period." },
      { title: "Profit", columns: [{ label: "Revenue before GST", kind: "money" }, { label: "Expenses", kind: "money" }, { label: "Team time", kind: "money" }, { label: "Profit", kind: "money" }, { label: "Margin", kind: "percent" }], rows: [[money(profit.revenue), money(profit.expenses), money(profit.time), money(profit.profit), profit.marginPercent]] },
    ],
  };
}

// ─── Monthly report for the client ───────────────────────────────────────────

/** Reads only what a client may see. Fees, costs and team names are never fetched, so they can't reach the page. */
export async function clientMonthlyDoc(db: Reader, input: { clientId: string; month: string }): Promise<ReportDoc> {
  const { clientId, month } = input;
  const range = monthRange(month);
  const [client, settings, note, deliverables, targets, campaigns, published] = await Promise.all([
    db.client.findUnique({ where: { id: clientId }, select: { companyName: true } }),
    db.settings.findUniqueOrThrow({ where: { id: "agency" }, select: { agencyName: true } }),
    db.clientReportNote.findUnique({ where: { clientId_month: { clientId, month } }, select: { highlights: true, nextPlan: true } }),
    db.deliverable.findMany({ where: { project: { clientId, archivedAt: null }, month }, select: { format: true, deliveredAt: true } }),
    db.target.findMany({ where: { project: { clientId, archivedAt: null } }, orderBy: [{ projectId: "asc" }, { sortOrder: "asc" }], select: { metric: true, unit: true, targetValue: true, higherIsBetter: true, progress: { where: { month }, select: { actualValue: true } } } }),
    db.adCampaign.findMany({ where: { clientId, archivedAt: null }, orderBy: { startDate: "asc" }, select: { name: true, entries: { where: { archivedAt: null, periodStart: within(range.start, range.end) }, select: { spend: true, impressions: true, clicks: true, leads: true, conversionValue: true } } } }),
    db.contentCalendarItem.findMany({ where: { clientId, publishedAt: withinInstants(range.start, range.end) }, orderBy: { publishedAt: "asc" }, select: { publishedAt: true, format: true, topic: true, publishedLink: true } }),
  ]);
  if (!client) throw new BusinessError("This client no longer exists.");
  const withActual = targets.map((t) => ({ metric: t.metric, unit: t.unit, target: t.targetValue, actual: t.progress[0]?.actualValue ?? null, higherIsBetter: t.higherIsBetter }));
  return buildClientMonthlyDoc({
    agencyName: settings.agencyName,
    clientName: client.companyName,
    month,
    highlights: note?.highlights ?? null,
    nextPlan: note?.nextPlan ?? null,
    deliverables: deliverables.map((d) => ({ format: d.format, delivered: !!d.deliveredAt })),
    kpis: withActual.filter((t) => t.actual !== null && !isRankingTarget(t)),
    rankings: withActual.filter((t) => t.actual !== null && isRankingTarget(t)),
    ads: campaigns.filter((c) => c.entries.length).map((c) => {
      const totals = totalEntries(c.entries);
      const m = adMetrics(totals, 0);
      return { campaign: c.name, spend: totals.spend, impressions: totals.impressions, clicks: totals.clicks, ctr: m.ctr, leads: totals.leads, cpl: m.cpl, roas: m.roas };
    }),
    published: published.map((p) => ({ dateKey: p.publishedAt ? istDateKey(p.publishedAt) : null, format: formatPluralSingle(p.format), topic: p.topic, link: p.publishedLink })),
  });
}

const SINGLE: Record<string, string> = { STATIC_POST: "Post", CAROUSEL: "Carousel", REEL: "Reel", STORY: "Story", VIDEO: "Video" };
const formatPluralSingle = (format: string) => SINGLE[format] ?? format;

export async function saveReportNote(db: Db, input: { clientId: string; month: string; highlights: string | null; nextPlan: string | null }, actorId: string) {
  if (!(await db.client.count({ where: { id: input.clientId } }))) throw new BusinessError("This client no longer exists.");
  const fields = { highlights: input.highlights, nextPlan: input.nextPlan, updatedById: actorId };
  return db.clientReportNote.upsert({ where: { clientId_month: { clientId: input.clientId, month: input.month } }, update: fields, create: { clientId: input.clientId, month: input.month, ...fields } });
}

