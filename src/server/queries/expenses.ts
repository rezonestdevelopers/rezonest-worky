import "server-only";
import type { ExpenseCategory, Prisma } from "@prisma/client";
import { dateOnlyKey, keyToDate, monthKeyOf, monthRange, shiftMonth, todayKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { idParam, param, parseListParams, type SearchParams } from "@/lib/list-params";
import { EXPENSE_CATEGORIES, periodRange } from "@/lib/profit";

const SORTS = ["date", "amount", "category"] as const;
const LIST = { sorts: SORTS, defaultSort: "date", defaultDir: "desc" } as const;

function expenseWhere(sp: SearchParams, q: string): Prisma.ExpenseWhereInput {
  const category = EXPENSE_CATEGORIES.find((c) => c === param(sp, "category")) as ExpenseCategory | undefined;
  const contains = { contains: q, mode: "insensitive" as const };
  const link = param(sp, "link");
  const when = param(sp, "period");
  const period = when ? periodRange(when, todayKey()) : null;
  return {
    archivedAt: param(sp, "show") === "archived" ? { not: null } : null,
    ...(category ? { category } : {}),
    ...(idParam(sp, "client") ? { clientId: idParam(sp, "client") } : {}),
    ...(idParam(sp, "project") ? { projectId: idParam(sp, "project") } : {}),
    ...(link === "overhead" ? { clientId: null, projectId: null } : {}),
    ...(period ? { date: { ...(period.from ? { gte: keyToDate(period.from) } : {}), lte: keyToDate(period.to) } } : {}),
    ...(q ? { OR: [{ description: contains }, { vendor: contains }, { client: { companyName: contains } }, { project: { name: contains } }] } : {}),
  };
}

const select = {
  id: true, date: true, category: true, description: true, vendor: true, amount: true, gstPaid: true, billDocId: true,
  client: { select: { id: true, companyName: true } },
  project: { select: { id: true, name: true } },
} satisfies Prisma.ExpenseSelect;

function toRow(e: Prisma.ExpenseGetPayload<{ select: typeof select }>) {
  return { id: e.id, date: dateOnlyKey(e.date), category: e.category as string, description: e.description, vendor: e.vendor, amount: e.amount.toString(), gstPaid: e.gstPaid.toString(), hasBill: !!e.billDocId, client: e.client?.companyName ?? null, project: e.project?.name ?? null };
}
export type ExpenseRow = ReturnType<typeof toRow>;

export async function getExpenseList(sp: SearchParams) {
  const params = parseListParams(sp, LIST);
  const where = expenseWhere(sp, params.q);
  const total = await db.expense.count({ where });
  const page = Math.min(params.page, Math.max(1, Math.ceil(total / params.pageSize)));
  const rows = await db.expense.findMany({ where, select, orderBy: [{ [params.sort]: params.dir }, { id: "asc" }], skip: (page - 1) * params.pageSize, take: params.pageSize });
  return { rows: rows.map(toRow), total, ...params, page };
}

export async function getExpensesForExport(sp: SearchParams) {
  const params = parseListParams(sp, LIST);
  const rows = await db.expense.findMany({ where: expenseWhere(sp, params.q), select, orderBy: [{ [params.sort]: params.dir }, { id: "asc" }], take: 20_000 });
  return rows.map(toRow);
}

export async function getExpenseSummary(today = todayKey()) {
  const month = monthKeyOf(today);
  const total = (from: string, to: string) => db.expense.aggregate({ where: { archivedAt: null, date: { gte: keyToDate(from), lte: keyToDate(to) } }, _sum: { amount: true, gstPaid: true }, _count: true });
  const prev = monthRange(shiftMonth(month, -1));
  const [current, last, noBill] = await Promise.all([
    total(monthRange(month).start, today),
    total(prev.start, prev.end),
    db.expense.count({ where: { archivedAt: null, billDocId: null, date: { gte: keyToDate(monthRange(month).start) } } }),
  ]);
  return { month: current._sum.amount?.toString() ?? "0", gst: current._sum.gstPaid?.toString() ?? "0", lastMonth: last._sum.amount?.toString() ?? "0", noBill };
}

export async function getExpenseFormOptions(including?: { clientId?: string | null; projectId?: string | null }) {
  const [clients, projects] = await Promise.all([
    db.client.findMany({ where: { OR: [{ archivedAt: null }, ...(including?.clientId ? [{ id: including.clientId }] : [])] }, orderBy: { companyName: "asc" }, select: { id: true, companyName: true } }),
    db.project.findMany({ where: { OR: [{ archivedAt: null }, ...(including?.projectId ? [{ id: including.projectId }] : [])] }, orderBy: { name: "asc" }, select: { id: true, name: true, clientId: true } }),
  ]);
  return { clients: clients.map((c) => ({ value: c.id, label: c.companyName })), projects: projects.map((p) => ({ value: p.id, label: p.name, clientId: p.clientId })) };
}

export const getExpense = (id: string) => db.expense.findUnique({ where: { id }, include: { client: { select: { id: true, companyName: true } }, project: { select: { id: true, name: true } } } });

export const getNames = async (clientIds: string[], projectIds: string[]) => {
  const [clients, projects] = await Promise.all([
    db.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, companyName: true } }),
    db.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true, client: { select: { companyName: true } } } }),
  ]);
  return { clients: new Map(clients.map((c) => [c.id, c.companyName])), projects: new Map(projects.map((p) => [p.id, { name: p.name, client: p.client.companyName }])) };
};
