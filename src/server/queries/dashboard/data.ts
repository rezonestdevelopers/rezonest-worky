import "server-only";
import type { LeadStage, OfferStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { Decimal, toDecimal, toNumber, ageingBucket, formatINRCompact } from "@/lib/money";
import { addDaysKey, daysBetweenKeys, dateOnlyKey, istDateKey, keyToDate, monthKeyOf, shiftMonth, formatMonthKey, monthRange } from "@/lib/dates";
import { effectiveHealth, type Health } from "@/lib/health";
import { dateRange, instantRange, type Scope } from "./filters";
import { grossInvoicedByMonth, mrrOn, outstandingAsOf, outstandingNow, receivedByMonth, receivedTotals, revenueFacts, sumFacts } from "./money";

export function pctChange(cur: number, prev: number): number | null {
  if (prev === 0) return cur === 0 ? 0 : null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

// ─── Today strip ─────────────────────────────────────────────────────────────
export async function getTodayStrip(scope: Scope) {
  const t = keyToDate(scope.today);
  const week = keyToDate(addDaysKey(scope.today, 7));
  const [dueToday, approvals, leadFollow, offerFollow, paymentsDue, renewals] = await Promise.all([
    db.task.count({ where: { ...scope.taskWhere, status: { not: "DONE" }, dueDate: t } }),
    db.task.count({ where: { ...scope.taskWhere, status: "WAITING_CLIENT_APPROVAL" } }),
    db.lead.count({
      where: {
        archivedAt: null,
        stage: { notIn: ["WON", "LOST"] },
        nextFollowUpDate: { lte: t },
        ...(scope.f.sectorId ? { sectorId: scope.f.sectorId } : {}),
      },
    }),
    db.offer.count({ where: { archivedAt: null, isTemplate: false, status: { in: ["SENT", "ON_HOLD"] }, followUpDate: { lte: t } } }),
    db.invoice.aggregate({
      where: { type: "TAX", status: "ISSUED", balanceDue: { gt: 0 }, dueDate: { lte: t }, client: scope.clientWhere },
      _count: true,
      _sum: { balanceDue: true },
    }),
    db.domainHostingAsset.count({ where: { archivedAt: null, expiryDate: { gte: t, lte: week }, client: scope.clientWhere } }),
  ]);
  return {
    dueToday,
    approvals,
    followUps: leadFollow + offerFollow,
    paymentsDue: { count: paymentsDue._count, amount: toNumber(paymentsDue._sum.balanceDue) },
    renewals,
  };
}

// ─── KPI cards ───────────────────────────────────────────────────────────────
export type Kpi = {
  key: string;
  label: string;
  value: number;
  format: "inr" | "count";
  delta: number | null;
  goodWhenUp: boolean;
  sub?: string;
  money?: boolean;
};

export async function getKpis(scope: Scope): Promise<Kpi[]> {
  const { f, today } = scope;
  const t = keyToDate(today);
  const prevEnd = keyToDate(f.prevTo);

  const [
    totalClients,
    totalClientsPrev,
    activeClients,
    activeProjects,
    openLeads,
    pending,
    accepted,
    acceptedPrev,
    mrr,
    mrrPrev,
    facts,
    factsPrev,
    gross,
    received,
    receivedPrev,
    outstanding,
    outstandingPrev,
    overdueTasks,
    overdueTasksPrev,
    projects,
  ] = await Promise.all([
    db.client.count({ where: scope.clientWhere }),
    db.client.count({ where: { ...scope.clientWhere, createdAt: { lte: instantRange(f.prevTo, f.prevTo).lte } } }),
    db.client.count({ where: { ...scope.clientWhere, status: "ACTIVE" } }),
    db.project.count({ where: { ...scope.projectWhere, status: "ACTIVE" } }),
    db.lead.count({
      where: { archivedAt: null, stage: { notIn: ["WON", "LOST"] }, ...(scope.f.sectorId ? { sectorId: scope.f.sectorId } : {}) },
    }),
    db.offer.aggregate({
      where: { archivedAt: null, isTemplate: false, status: { in: ["SENT", "ON_HOLD"] }, ...offerScope(scope) },
      _count: true,
      _sum: { taxableTotal: true },
    }),
    db.offer.aggregate({
      where: { isTemplate: false, status: "ACCEPTED", acceptedAt: instantRange(f.from, f.to), ...offerScope(scope) },
      _count: true,
      _sum: { taxableTotal: true },
    }),
    db.offer.count({ where: { isTemplate: false, status: "ACCEPTED", acceptedAt: instantRange(f.prevFrom, f.prevTo), ...offerScope(scope) } }),
    mrrOn(scope, today, true),
    mrrOn(scope, f.prevTo, false),
    revenueFacts(scope, f.from, f.to),
    revenueFacts(scope, f.prevFrom, f.prevTo),
    grossInvoicedByMonth(scope, f.from, f.to),
    receivedTotals(scope, f.from, f.to),
    receivedTotals(scope, f.prevFrom, f.prevTo),
    outstandingNow(scope),
    outstandingAsOf(scope, f.prevTo),
    db.task.count({ where: { ...scope.taskWhere, status: { notIn: ["DONE", "WAITING_CLIENT_APPROVAL"] }, dueDate: { lt: t } } }),
    db.task.count({
      where: {
        ...scope.taskWhere,
        dueDate: { lt: prevEnd },
        createdAt: { lte: prevEnd },
        OR: [{ completedAt: null }, { completedAt: { gt: instantRange(f.prevTo, f.prevTo).lte } }],
      },
    }),
    db.project.findMany({ where: { ...scope.projectWhere, status: "ACTIVE" }, select: { healthAuto: true, healthOverride: true } }),
  ]);

  const invoiced = toNumber(sumFacts(facts));
  const invoicedPrev = toNumber(sumFacts(factsPrev));
  const grossTotal = Array.from(gross.values()).reduce((s, v) => s.plus(v), new Decimal(0));
  const atRisk = projects.filter((p) => effectiveHealth(p.healthAuto, p.healthOverride) !== "ON_TRACK").length;
  const delayed = projects.filter((p) => effectiveHealth(p.healthAuto, p.healthOverride) === "DELAYED").length;

  return [
    { key: "totalClients", label: "Total clients", value: totalClients, format: "count", delta: pctChange(totalClients, totalClientsPrev), goodWhenUp: true },
    { key: "activeClients", label: "Active clients", value: activeClients, format: "count", delta: null, goodWhenUp: true },
    { key: "activeProjects", label: "Active projects", value: activeProjects, format: "count", delta: null, goodWhenUp: true },
    { key: "openLeads", label: "Open leads", value: openLeads, format: "count", delta: null, goodWhenUp: true },
    {
      key: "offersPending", label: "Offers pending", value: toNumber(pending._sum.taxableTotal), format: "inr", delta: null, goodWhenUp: true,
      sub: `${pending._count} offer${pending._count === 1 ? "" : "s"} · excl. GST`, money: true,
    },
    {
      key: "offersAccepted", label: "Offers accepted", value: accepted._count, format: "count", delta: pctChange(accepted._count, acceptedPrev), goodWhenUp: true,
      sub: `Worth ${formatINRCompact(accepted._sum.taxableTotal)} excl. GST`, money: true,
    },
    { key: "mrr", label: "MRR (retainers)", value: toNumber(mrr), format: "inr", delta: pctChange(toNumber(mrr), toNumber(mrrPrev)), goodWhenUp: true, sub: "Monthly, excl. GST", money: true },
    {
      key: "invoiced", label: "Invoiced", value: invoiced, format: "inr", delta: pctChange(invoiced, invoicedPrev), goodWhenUp: true,
      sub: `Excl. GST · ${formatINRCompact(grossTotal)} with GST`, money: true,
    },
    {
      key: "received", label: "Received", value: toNumber(received.cash), format: "inr", delta: pctChange(toNumber(received.cash), toNumber(receivedPrev.cash)), goodWhenUp: true,
      sub: received.tds.greaterThan(0) ? `+ ${formatINRCompact(received.tds)} TDS deducted` : "Money in the bank", money: true,
    },
    {
      key: "outstanding", label: "Total outstanding", value: toNumber(outstanding.amount), format: "inr", delta: pctChange(toNumber(outstanding.amount), toNumber(outstandingPrev)), goodWhenUp: false,
      sub: `${outstanding.count} unpaid invoice${outstanding.count === 1 ? "" : "s"}`, money: true,
    },
    { key: "overdueTasks", label: "Overdue tasks", value: overdueTasks, format: "count", delta: pctChange(overdueTasks, overdueTasksPrev), goodWhenUp: false },
    { key: "atRisk", label: "Projects at risk", value: atRisk, format: "count", delta: null, goodWhenUp: false, sub: `${delayed} delayed · ${atRisk - delayed} at risk` },
  ];
}

function offerScope(scope: Scope) {
  return {
    ...(scope.f.sectorId ? { OR: [{ client: { sectorId: scope.f.sectorId } }, { lead: { sectorId: scope.f.sectorId } }] } : {}),
    ...(scope.serviceIds ? { items: { some: { serviceId: { in: scope.serviceIds } } } } : {}),
  };
}

// ─── Pipeline ────────────────────────────────────────────────────────────────
const LEAD_STAGES: LeadStage[] = ["NEW", "CONTACTED", "REQUIREMENT_DISCUSSED", "OFFER_SENT", "WON", "LOST"];
const OFFER_STATUSES: OfferStatus[] = ["DRAFT", "SENT", "ON_HOLD", "ACCEPTED", "REJECTED", "EXPIRED"];

export async function getPipeline(scope: Scope) {
  const { f } = scope;
  const leadWhere = {
    archivedAt: null,
    ...(f.sectorId ? { sectorId: f.sectorId } : {}),
    ...(f.serviceId ? { servicesInterested: { has: f.serviceId } } : {}),
  };
  const range = instantRange(f.from, f.to);

  const [leadGroups, wonLost, openOffers, closed, acceptedRows] = await Promise.all([
    db.lead.groupBy({ by: ["stage"], where: { ...leadWhere, stage: { notIn: ["WON", "LOST"] } }, _count: true, _sum: { approxBudget: true } }),
    // Won/Lost: only those that closed in the selected period
    db.lead.groupBy({
      by: ["stage"],
      where: { ...leadWhere, stage: { in: ["WON", "LOST"] }, updatedAt: range },
      _count: true,
      _sum: { approxBudget: true },
    }),
    db.offer.groupBy({
      by: ["status"],
      where: { archivedAt: null, isTemplate: false, status: { in: ["DRAFT", "SENT", "ON_HOLD"] }, ...offerScope(scope) },
      _count: true,
      _sum: { taxableTotal: true },
    }),
    Promise.all(
      (["ACCEPTED", "REJECTED", "EXPIRED"] as const).map((s) =>
        db.offer.aggregate({
          where: { isTemplate: false, status: s, statusHistory: { some: { toStatus: s, createdAt: range } }, ...offerScope(scope) },
          _count: true,
          _sum: { taxableTotal: true },
        }),
      ),
    ),
    db.offer.findMany({
      where: { isTemplate: false, status: "ACCEPTED", acceptedAt: range, ...offerScope(scope) },
      select: { offerDate: true, acceptedAt: true },
    }),
  ]);

  const leadMap = new Map([...leadGroups, ...wonLost].map((g) => [g.stage, g]));
  const leads = LEAD_STAGES.map((stage) => ({
    stage,
    count: leadMap.get(stage)?._count ?? 0,
    value: toNumber(leadMap.get(stage)?._sum.approxBudget),
  }));

  const closedMap = { ACCEPTED: closed[0], REJECTED: closed[1], EXPIRED: closed[2] };
  const offers = OFFER_STATUSES.map((status) => {
    if (status in closedMap) {
      const a = closedMap[status as keyof typeof closedMap];
      return { status, count: a._count, value: toNumber(a._sum.taxableTotal) };
    }
    const g = openOffers.find((o) => o.status === status);
    return { status, count: g?._count ?? 0, value: toNumber(g?._sum.taxableTotal) };
  });

  const acc = closedMap.ACCEPTED._count;
  const decided = acc + closedMap.REJECTED._count + closedMap.EXPIRED._count;
  const conversion = decided ? (acc / decided) * 100 : null;
  const avgDays = acceptedRows.length
    ? acceptedRows.reduce((s, o) => s + daysBetweenKeys(dateOnlyKey(o.offerDate), istDateKey(o.acceptedAt!)), 0) / acceptedRows.length
    : null;

  return { leads, offers, conversion, decided, avgDays };
}

// ─── Charts ──────────────────────────────────────────────────────────────────
export async function getCharts(scope: Scope, opts: { profit: boolean }) {
  const { f } = scope;
  const endMonth = monthKeyOf(f.to);
  const startMonth = shiftMonth(endMonth, -11);
  const twelveFrom = `${startMonth}-01`;
  const twelveTo = monthRange(`${endMonth}-01`).end;

  const [grossByMonth, recvByMonth, facts, clients, services, sectors, sources] = await Promise.all([
    grossInvoicedByMonth(scope, twelveFrom, twelveTo),
    receivedByMonth(scope, twelveFrom, twelveTo),
    revenueFacts(scope, f.from, f.to),
    db.client.findMany({ where: scope.clientWhere, select: { id: true, companyName: true, sectorId: true, leadSourceId: true, status: true } }),
    db.service.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.sector.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.leadSource.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
  ]);
  const clientById = new Map(clients.map((c) => [c.id, c]));

  // 1. invoiced vs received — last 12 months (incl. GST both sides)
  const revenue12 = Array.from({ length: 12 }, (_, i) => {
    const m = shiftMonth(startMonth, i);
    return { month: formatMonthKey(m, true), invoiced: toNumber(grossByMonth.get(m) ?? 0), received: toNumber(recvByMonth.get(m) ?? 0) };
  });

  // 2. revenue by service (excl. GST)
  const bySvc = new Map<string, Decimal>();
  for (const fct of facts) bySvc.set(fct.serviceId ?? "none", (bySvc.get(fct.serviceId ?? "none") ?? new Decimal(0)).plus(fct.amount));
  const revenueByService = services
    .map((s) => ({ name: s.name, value: toNumber(bySvc.get(s.id) ?? 0) }))
    .concat(bySvc.has("none") ? [{ name: "Other items", value: toNumber(bySvc.get("none")!) }] : [])
    .sort((a, b) => b.value - a.value);

  // 3. sector-wise: clients, active projects, revenue
  const projBySector = await db.project.findMany({ where: { ...scope.projectWhere, status: "ACTIVE" }, select: { client: { select: { sectorId: true } } } });
  const revByClient = new Map<string, Decimal>();
  for (const fct of facts) revByClient.set(fct.clientId, (revByClient.get(fct.clientId) ?? new Decimal(0)).plus(fct.amount));
  const sectorRows = sectors
    .map((s) => {
      const cs = clients.filter((c) => c.sectorId === s.id);
      return {
        name: s.name,
        clients: cs.length,
        activeProjects: projBySector.filter((p) => p.client.sectorId === s.id).length,
        revenue: toNumber(cs.reduce((sum, c) => sum.plus(revByClient.get(c.id) ?? 0), new Decimal(0))),
      };
    })
    .filter((r) => r.clients || r.activeProjects || r.revenue)
    .sort((a, b) => b.revenue - a.revenue || b.clients - a.clients);

  // 4. lead source: leads, conversions (in period) and revenue
  const leadWhere = { archivedAt: null, ...(f.sectorId ? { sectorId: f.sectorId } : {}) };
  const [leadsBySource, convBySource] = await Promise.all([
    db.lead.groupBy({ by: ["leadSourceId"], where: { ...leadWhere, createdAt: instantRange(f.from, f.to) }, _count: true }),
    db.lead.groupBy({ by: ["leadSourceId"], where: { ...leadWhere, convertedAt: instantRange(f.from, f.to) }, _count: true }),
  ]);
  const sourceRows = sources
    .map((s) => ({
      name: s.name,
      leads: leadsBySource.find((x) => x.leadSourceId === s.id)?._count ?? 0,
      conversions: convBySource.find((x) => x.leadSourceId === s.id)?._count ?? 0,
      revenue: toNumber(
        clients.filter((c) => c.leadSourceId === s.id).reduce((sum, c) => sum.plus(revByClient.get(c.id) ?? 0), new Decimal(0)),
      ),
    }))
    .filter((r) => r.leads || r.conversions || r.revenue);

  // 5. team workload
  const [openByUser, completed, users, openByDept, departments] = await Promise.all([
    db.task.findMany({
      where: { ...scope.taskWhere, status: { not: "DONE" }, assigneeId: { not: null } },
      select: { assigneeId: true, dueDate: true, status: true },
    }),
    db.task.findMany({
      where: { ...scope.taskWhere, status: "DONE", completedAt: instantRange(f.from, f.to), dueDate: { not: null }, assigneeId: { not: null } },
      select: { assigneeId: true, dueDate: true, completedAt: true },
    }),
    db.user.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    db.task.groupBy({ by: ["departmentId"], where: { ...scope.taskWhere, status: { not: "DONE" } }, _count: true }),
    db.department.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
  ]);
  const todayDate = keyToDate(scope.today);
  const workload = users
    .map((u) => {
      const open = openByUser.filter((t) => t.assigneeId === u.id);
      const overdue = open.filter((t) => t.dueDate && t.dueDate < todayDate && t.status !== "WAITING_CLIENT_APPROVAL").length;
      const done = completed.filter((t) => t.assigneeId === u.id);
      const onTime = done.filter((t) => istDateKey(t.completedAt!) <= dateOnlyKey(t.dueDate!)).length;
      return { name: u.name.split(" ")[0], fullName: u.name, onSchedule: open.length - overdue, overdue, onTime, late: done.length - onTime };
    })
    .filter((w) => w.onSchedule + w.overdue + w.onTime + w.late > 0)
    .sort((a, b) => b.onSchedule + b.overdue - (a.onSchedule + a.overdue));
  const deptWorkload = departments
    .map((d) => ({ name: d.name, open: openByDept.find((x) => x.departmentId === d.id)?._count ?? 0 }))
    .filter((d) => d.open > 0)
    .sort((a, b) => b.open - a.open);

  // 6. deliverables this month: committed vs delivered
  const curMonth = monthKeyOf(scope.today);
  const deliverables = await db.deliverable.findMany({
    where: {
      month: curMonth,
      project: { ...scope.projectWhere, status: { not: "CANCELLED" } },
      ...(scope.serviceIds ? { serviceId: { in: scope.serviceIds } } : {}),
    },
    select: { format: true, deliveredAt: true },
  });
  const GROUPS: { label: string; match: (f: string | null) => boolean }[] = [
    { label: "Posts", match: (x) => x === "STATIC_POST" || x === "CAROUSEL" },
    { label: "Reels", match: (x) => x === "REEL" },
    { label: "Stories", match: (x) => x === "STORY" },
    { label: "Videos", match: (x) => x === "VIDEO" },
    { label: "Reports & other", match: (x) => x === null },
  ];
  const deliverableRows = GROUPS.map((g) => {
    const rows = deliverables.filter((d) => g.match(d.format));
    return { label: g.label, committed: rows.length, delivered: rows.filter((r) => r.deliveredAt).length };
  }).filter((r) => r.committed > 0);

  // 7. top clients by revenue & profit (period)
  const topRevenue = Array.from(revByClient.entries())
    .map(([id, v]) => ({ id, name: clientById.get(id)?.companyName ?? "—", value: toNumber(v) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  let topProfit: { id: string; name: string; value: number; revenue: number; cost: number }[] = [];
  if (opts.profit) {
    const [expenses, timeLogs] = await Promise.all([
      db.expense.groupBy({ by: ["clientId"], where: { archivedAt: null, date: dateRange(f.from, f.to), clientId: { not: null }, client: scope.clientWhere }, _sum: { amount: true } }),
      db.timeLog.findMany({
        where: { date: dateRange(f.from, f.to), task: { client: scope.clientWhere } },
        select: { minutes: true, task: { select: { clientId: true } }, user: { select: { employee: { select: { hourlyCost: true } } } } },
      }),
    ]);
    const cost = new Map<string, Decimal>();
    for (const e of expenses) cost.set(e.clientId!, (cost.get(e.clientId!) ?? new Decimal(0)).plus(toDecimal(e._sum.amount)));
    for (const tl of timeLogs) {
      const cid = tl.task.clientId;
      if (!cid) continue;
      const c = toDecimal(tl.user.employee?.hourlyCost).times(tl.minutes).dividedBy(60);
      cost.set(cid, (cost.get(cid) ?? new Decimal(0)).plus(c));
    }
    const ids = new Set([...revByClient.keys(), ...cost.keys()]);
    topProfit = Array.from(ids)
      .map((id) => {
        const revenue = revByClient.get(id) ?? new Decimal(0);
        const c = cost.get(id) ?? new Decimal(0);
        return { id, name: clientById.get(id)?.companyName ?? "—", value: toNumber(revenue.minus(c)), revenue: toNumber(revenue), cost: toNumber(c) };
      })
      .filter((r) => r.revenue > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }

  // 8. outstanding ageing (as of today)
  const unpaid = await db.invoice.findMany({
    where: { type: "TAX", status: "ISSUED", balanceDue: { gt: 0 }, client: scope.clientWhere },
    select: { dueDate: true, balanceDue: true },
  });
  const buckets: Record<string, { label: string; amount: Decimal; count: number }> = {
    notDue: { label: "Not yet due", amount: new Decimal(0), count: 0 },
    "0-30": { label: "1–30 days", amount: new Decimal(0), count: 0 },
    "31-60": { label: "31–60 days", amount: new Decimal(0), count: 0 },
    "61-90": { label: "61–90 days", amount: new Decimal(0), count: 0 },
    "90+": { label: "90+ days", amount: new Decimal(0), count: 0 },
  };
  for (const inv of unpaid) {
    const days = daysBetweenKeys(dateOnlyKey(inv.dueDate), scope.today);
    const key = days <= 0 ? "notDue" : ageingBucket(days);
    buckets[key].amount = buckets[key].amount.plus(toDecimal(inv.balanceDue));
    buckets[key].count++;
  }
  const ageing = Object.entries(buckets).map(([key, b]) => ({ key, label: b.label, amount: toNumber(b.amount), count: b.count }));

  return { revenue12, revenueByService, sectorRows, sourceRows, workload, deptWorkload, deliverableRows, topRevenue, topProfit, ageing, curMonth };
}

// ─── Client work table ───────────────────────────────────────────────────────
export type ClientWorkRow = {
  id: string;
  client: string;
  sector: string;
  services: string[];
  activeProject: string;
  projectCount: number;
  target: string;
  deadline: string | null;
  progress: number | null;
  health: Health | null;
  team: string[];
  paymentStatus: "OVERDUE" | "PARTIALLY_PAID" | "UNPAID" | "PAID" | "NONE";
  outstanding: number;
  nextAction: string;
  nextActionDate: string | null;
};

const HEALTH_RANK: Record<Health, number> = { ON_TRACK: 0, AT_RISK: 1, DELAYED: 2 };

export async function getClientWork(scope: Scope): Promise<ClientWorkRow[]> {
  const today = keyToDate(scope.today);
  const clients = await db.client.findMany({
    where: { ...scope.clientWhere, OR: [{ status: "ACTIVE" }, { projects: { some: { status: "ACTIVE" } } }] },
    orderBy: { companyName: "asc" },
    select: {
      id: true,
      companyName: true,
      sector: { select: { name: true } },
      projects: {
        where: { ...scope.projectWhere, status: "ACTIVE" },
        orderBy: { startDate: "desc" },
        select: {
          name: true,
          deadline: true,
          retainerEnd: true,
          progressPercent: true,
          healthAuto: true,
          healthOverride: true,
          services: { where: { isActive: true }, select: { service: { select: { name: true } } } },
          targets: { orderBy: { sortOrder: "asc" }, take: 1, select: { metric: true, targetValue: true, unit: true } },
        },
      },
      invoices: {
        where: { type: "TAX", status: "ISSUED" },
        select: { paymentStatus: true, balanceDue: true },
      },
      tasks: {
        where: { ...scope.taskWhere, status: { not: "DONE" } },
        orderBy: { dueDate: "asc" },
        select: { title: true, dueDate: true, assignee: { select: { name: true } } },
      },
      communications: {
        where: { nextActionDate: { not: null, gte: keyToDate(addDaysKey(scope.today, -30)) } },
        orderBy: { nextActionDate: "asc" },
        take: 1,
        select: { nextAction: true, nextActionDate: true },
      },
    },
  });

  return clients.map((c) => {
    const services = Array.from(new Set(c.projects.flatMap((p) => p.services.map((s) => s.service.name))));
    const healths = c.projects.map((p) => effectiveHealth(p.healthAuto, p.healthOverride));
    const worst = healths.length ? healths.reduce((a, b) => (HEALTH_RANK[b] > HEALTH_RANK[a] ? b : a)) : null;
    const deadlines = c.projects.map((p) => p.deadline ?? p.retainerEnd).filter((x): x is Date => !!x).sort((a, b) => a.getTime() - b.getTime());
    const target = c.projects.flatMap((p) => p.targets)[0];
    const outstanding = c.invoices.reduce((s, i) => s.plus(toDecimal(i.balanceDue)), new Decimal(0));
    const statuses = new Set(c.invoices.filter((i) => toDecimal(i.balanceDue).greaterThan(0)).map((i) => i.paymentStatus));
    const paymentStatus: ClientWorkRow["paymentStatus"] = statuses.has("OVERDUE")
      ? "OVERDUE"
      : statuses.has("PARTIALLY_PAID")
        ? "PARTIALLY_PAID"
        : statuses.has("UNPAID")
          ? "UNPAID"
          : c.invoices.length
            ? "PAID"
            : "NONE";
    const overdueTask = c.tasks.find((t) => t.dueDate && t.dueDate < today);
    const nextTask = overdueTask ?? c.tasks.find((t) => t.dueDate);
    const comm = c.communications[0];
    let nextAction = "—";
    let nextActionDate: string | null = null;
    if (comm?.nextActionDate && (!nextTask?.dueDate || comm.nextActionDate <= nextTask.dueDate)) {
      nextAction = comm.nextAction ?? "Follow up";
      nextActionDate = dateOnlyKey(comm.nextActionDate);
    } else if (nextTask) {
      nextAction = nextTask.title;
      nextActionDate = nextTask.dueDate ? dateOnlyKey(nextTask.dueDate) : null;
    }
    const progresses = c.projects.map((p) => p.progressPercent);
    return {
      id: c.id,
      client: c.companyName,
      sector: c.sector?.name ?? "—",
      services,
      activeProject: c.projects[0]?.name ?? "—",
      projectCount: c.projects.length,
      target: target ? `${target.metric}: ${toNumber(target.targetValue).toLocaleString("en-IN")}${target.unit === "%" ? "%" : ""}` : "—",
      deadline: deadlines[0] ? dateOnlyKey(deadlines[0]) : null,
      progress: progresses.length ? Math.round(progresses.reduce((a, b) => a + b, 0) / progresses.length) : null,
      health: worst,
      team: Array.from(new Set(c.tasks.map((t) => t.assignee?.name).filter((n): n is string => !!n))),
      paymentStatus,
      outstanding: toNumber(outstanding),
      nextAction,
      nextActionDate,
    };
  });
}

// ─── Upcoming deadlines (next 30 days) ───────────────────────────────────────
export type DeadlineItem = { id: string; date: string; type: string; title: string; client?: string; href: string; tone: "red" | "amber" | "blue" | "violet" | "grey" | "green" };

export async function getDeadlines(scope: Scope, opts: { money: boolean }): Promise<DeadlineItem[]> {
  const from = keyToDate(scope.today);
  const to = keyToDate(addDaysKey(scope.today, 30));
  const range = { gte: from, lte: to };
  const [tasks, milestones, projects, retainers, renewals, invoices, offers] = await Promise.all([
    db.task.findMany({
      where: { ...scope.taskWhere, status: { not: "DONE" }, priority: { in: ["HIGH", "URGENT"] }, dueDate: range },
      select: { id: true, title: true, dueDate: true, client: { select: { companyName: true } } },
      take: 60,
    }),
    db.milestone.findMany({
      where: { status: { not: "COMPLETED" }, dueDate: range, project: scope.projectWhere },
      select: { id: true, name: true, dueDate: true, project: { select: { id: true, name: true, client: { select: { companyName: true } } } } },
    }),
    db.project.findMany({ where: { ...scope.projectWhere, status: "ACTIVE", deadline: range }, select: { id: true, name: true, deadline: true, client: { select: { companyName: true } } } }),
    db.project.findMany({ where: { ...scope.projectWhere, status: "ACTIVE", isRetainer: true, retainerEnd: range }, select: { id: true, name: true, retainerEnd: true, client: { select: { companyName: true } } } }),
    db.domainHostingAsset.findMany({ where: { archivedAt: null, expiryDate: range, client: scope.clientWhere }, select: { id: true, name: true, kind: true, expiryDate: true, client: { select: { companyName: true } } } }),
    opts.money
      ? db.invoice.findMany({ where: { type: "TAX", status: "ISSUED", balanceDue: { gt: 0 }, dueDate: range, client: scope.clientWhere }, select: { id: true, number: true, dueDate: true, client: { select: { companyName: true } } } })
      : [],
    db.offer.findMany({ where: { archivedAt: null, status: { in: ["SENT", "ON_HOLD"] }, validUntil: range }, select: { id: true, number: true, title: true, validUntil: true } }),
  ]);

  const items: DeadlineItem[] = [
    ...tasks.map((t) => ({ id: `t-${t.id}`, date: dateOnlyKey(t.dueDate!), type: "Task", title: t.title, client: t.client?.companyName, href: `/tasks/${t.id}`, tone: "blue" as const })),
    ...milestones.map((m) => ({ id: `m-${m.id}`, date: dateOnlyKey(m.dueDate!), type: "Milestone", title: `${m.name} – ${m.project.name}`, client: m.project.client.companyName, href: `/projects/${m.project.id}`, tone: "violet" as const })),
    ...projects.map((p) => ({ id: `p-${p.id}`, date: dateOnlyKey(p.deadline!), type: "Project deadline", title: p.name, client: p.client.companyName, href: `/projects/${p.id}`, tone: "red" as const })),
    ...retainers.map((p) => ({ id: `r-${p.id}`, date: dateOnlyKey(p.retainerEnd!), type: "Retainer ends", title: p.name, client: p.client.companyName, href: `/projects/${p.id}`, tone: "amber" as const })),
    ...renewals.map((a) => ({ id: `a-${a.id}`, date: dateOnlyKey(a.expiryDate), type: `${a.kind === "BUSINESS_EMAIL" ? "Email" : a.kind.charAt(0) + a.kind.slice(1).toLowerCase()} renewal`, title: a.name, client: a.client.companyName, href: "/renewals", tone: "amber" as const })),
    ...invoices.map((i) => ({ id: `i-${i.id}`, date: dateOnlyKey(i.dueDate), type: "Invoice due", title: i.number ?? "Invoice", client: i.client.companyName, href: `/invoices/${i.id}`, tone: "green" as const })),
    ...offers.map((o) => ({ id: `o-${o.id}`, date: dateOnlyKey(o.validUntil), type: "Offer expires", title: `${o.number} · ${o.title}`, href: `/offers/${o.id}`, tone: "grey" as const })),
  ];
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type));
}

// ─── Employee view: own tasks ────────────────────────────────────────────────
export async function getMyTasks(userId: string, todayKey: string) {
  const today = keyToDate(todayKey);
  const tasks = await db.task.findMany({
    where: { assigneeId: userId, archivedAt: null, status: { not: "DONE" } },
    orderBy: [{ dueDate: "asc" }, { priority: "desc" }],
    take: 100,
    select: { id: true, title: true, status: true, priority: true, dueDate: true, client: { select: { companyName: true } } },
  });
  const rows = tasks.map((t) => ({ ...t, dueKey: t.dueDate ? dateOnlyKey(t.dueDate) : null, client: t.client?.companyName ?? "" }));
  return {
    overdue: rows.filter((t) => t.dueDate && t.dueDate < today),
    today: rows.filter((t) => t.dueKey === todayKey),
    upcoming: rows.filter((t) => !t.dueDate || t.dueDate > today),
  };
}
