import "server-only";
import type { ClientStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { idParam, param, parseListParams, type SearchParams } from "@/lib/list-params";

const SORTS = ["companyName", "city", "status", "createdAt"] as const;
const STATUSES: ClientStatus[] = ["ACTIVE", "INACTIVE", "ARCHIVED"];

/** Ids of clients whose phone (or a contact's phone) contains these digits, however the number was typed. */
async function clientIdsByPhone(q: string): Promise<string[]> {
  const digits = q.replace(/\D/g, "");
  if (digits.length < 4 || digits.length < q.replace(/[\s+()-]/g, "").length) return [];
  const like = `%${digits}%`;
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Client"
    WHERE regexp_replace(coalesce("phone", ''), '\D', '', 'g') LIKE ${like}
       OR regexp_replace(coalesce("whatsapp", ''), '\D', '', 'g') LIKE ${like}
    UNION
    SELECT "clientId" FROM "ClientContact"
    WHERE "archivedAt" IS NULL AND (
          regexp_replace(coalesce("phone", ''), '\D', '', 'g') LIKE ${like}
       OR regexp_replace(coalesce("whatsapp", ''), '\D', '', 'g') LIKE ${like})`;
  return rows.map((r) => r.id);
}

export async function buildClientWhere(sp: SearchParams, q: string): Promise<Prisma.ClientWhereInput> {
  const status = STATUSES.find((s) => s === param(sp, "status"));
  const contains = { contains: q, mode: "insensitive" as const };
  const phoneIds = q ? await clientIdsByPhone(q) : [];
  return {
    // Archived clients stay out of the way unless asked for.
    ...(status ? { status } : { archivedAt: null }),
    ...(idParam(sp, "sector") ? { sectorId: idParam(sp, "sector") } : {}),
    ...(idParam(sp, "source") ? { leadSourceId: idParam(sp, "source") } : {}),
    ...(idParam(sp, "manager") ? { accountManagerId: idParam(sp, "manager") } : {}),
    ...(q
      ? {
          OR: [
            { companyName: contains },
            { email: contains },
            { phone: contains },
            { gstin: contains },
            { city: contains },
            { tags: { has: q } },
            { contacts: { some: { archivedAt: null, OR: [{ name: contains }, { email: contains }] } } },
            ...(phoneIds.length ? [{ id: { in: phoneIds } }] : []),
          ],
        }
      : {}),
  };
}

function orderBy(sort: (typeof SORTS)[number], dir: "asc" | "desc"): Prisma.ClientOrderByWithRelationInput[] {
  const tie = { id: "asc" as const };
  return sort === "city" ? [{ city: { sort: dir, nulls: "last" } }, tie] : [{ [sort]: dir }, tie];
}

const listSelect = {
  id: true,
  companyName: true,
  phone: true,
  email: true,
  city: true,
  state: true,
  gstin: true,
  status: true,
  tags: true,
  createdAt: true,
  sector: { select: { name: true } },
  leadSource: { select: { name: true } },
  accountManager: { select: { name: true } },
  contacts: { where: { isPrimary: true, archivedAt: null }, take: 1, select: { name: true } },
  _count: { select: { projects: { where: { status: "ACTIVE" as const, archivedAt: null } } } },
} satisfies Prisma.ClientSelect;

function toRow(c: Prisma.ClientGetPayload<{ select: typeof listSelect }>, outstanding: string | null) {
  return {
    id: c.id,
    companyName: c.companyName,
    contact: c.contacts[0]?.name ?? null,
    phone: c.phone,
    email: c.email,
    city: c.city,
    state: c.state,
    gstin: c.gstin,
    status: c.status,
    tags: c.tags,
    sector: c.sector?.name ?? null,
    source: c.leadSource?.name ?? null,
    manager: c.accountManager?.name ?? null,
    activeProjects: c._count.projects,
    outstanding,
  };
}
export type ClientRow = ReturnType<typeof toRow>;

async function outstandingFor(ids: string[]) {
  const groups = await db.invoice.groupBy({
    by: ["clientId"],
    where: { clientId: { in: ids }, type: "TAX", status: "ISSUED" },
    _sum: { balanceDue: true },
  });
  return new Map(groups.map((g) => [g.clientId, g._sum.balanceDue?.toString() ?? "0"]));
}

/** `showMoney` is only true for roles allowed to see invoices. Others never receive the figures. */
export async function getClientList(sp: SearchParams, showMoney: boolean) {
  const params = parseListParams(sp, { sorts: SORTS, defaultSort: "companyName", defaultDir: "asc" });
  const where = await buildClientWhere(sp, params.q);
  const total = await db.client.count({ where });
  const page = Math.min(params.page, Math.max(1, Math.ceil(total / params.pageSize)));
  const rows = await db.client.findMany({
    where,
    select: listSelect,
    orderBy: orderBy(params.sort, params.dir),
    skip: (page - 1) * params.pageSize,
    take: params.pageSize,
  });
  const money = showMoney ? await outstandingFor(rows.map((r) => r.id)) : null;
  return { rows: rows.map((r) => toRow(r, money ? (money.get(r.id) ?? "0") : null)), total, ...params, page };
}

export async function getClientsForExport(sp: SearchParams, showMoney: boolean) {
  const params = parseListParams(sp, { sorts: SORTS, defaultSort: "companyName", defaultDir: "asc" });
  const rows = await db.client.findMany({
    where: await buildClientWhere(sp, params.q),
    select: listSelect,
    orderBy: orderBy(params.sort, params.dir),
    take: 20_000,
  });
  const money = showMoney ? await outstandingFor(rows.map((r) => r.id)) : null;
  return rows.map((r) => toRow(r, money ? (money.get(r.id) ?? "0") : null));
}

export function getClientHeader(id: string) {
  return db.client.findUnique({
    where: { id },
    include: {
      sector: { select: { name: true } },
      leadSource: { select: { name: true } },
      accountManager: { select: { name: true } },
      contacts: { where: { archivedAt: null }, orderBy: [{ isPrimary: "desc" }, { name: "asc" }] },
      leads: { select: { id: true, contactName: true, convertedAt: true } },
    },
  });
}

const TAKE = 50;

export async function getClientOverview(id: string, showMoney: boolean) {
  const [activeProjects, openTasks, openOffers, money] = await Promise.all([
    db.project.count({ where: { clientId: id, status: "ACTIVE", archivedAt: null } }),
    db.task.count({ where: { clientId: id, archivedAt: null, status: { not: "DONE" } } }),
    db.offer.count({ where: { clientId: id, archivedAt: null, status: { in: ["SENT", "ON_HOLD"] } } }),
    showMoney
      ? db.invoice.aggregate({
          where: { clientId: id, type: "TAX", status: "ISSUED" },
          _sum: { taxableTotal: true, balanceDue: true },
        })
      : null,
  ]);
  return {
    activeProjects,
    openTasks,
    openOffers,
    invoicedExclGst: money?._sum.taxableTotal?.toString() ?? null,
    outstanding: money?._sum.balanceDue?.toString() ?? null,
  };
}

export const clientTabQueries = {
  offers: (clientId: string) =>
    db.offer.findMany({
      where: { clientId, archivedAt: null, isTemplate: false },
      orderBy: { offerDate: "desc" },
      take: TAKE,
      select: { id: true, number: true, title: true, status: true, offerDate: true, validUntil: true, taxableTotal: true },
    }),
  projects: (clientId: string) =>
    db.project.findMany({
      where: { clientId, archivedAt: null },
      orderBy: { startDate: "desc" },
      take: TAKE,
      select: { id: true, code: true, name: true, status: true, healthAuto: true, healthOverride: true, progressPercent: true, startDate: true, deadline: true, retainerEnd: true, manager: { select: { name: true } } },
    }),
  tasks: (clientId: string) =>
    db.task.findMany({
      where: { clientId, archivedAt: null, status: { not: "DONE" } },
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }],
      take: TAKE,
      select: { id: true, title: true, status: true, priority: true, dueDate: true, assignee: { select: { name: true } } },
    }),
  content: (clientId: string) =>
    db.contentCalendarItem.findMany({
      where: { clientId, archivedAt: null },
      orderBy: { publishDate: "desc" },
      take: TAKE,
      select: { id: true, topic: true, format: true, platforms: true, designStatus: true, approvalStatus: true, publishDate: true },
    }),
  ads: (clientId: string) =>
    db.adCampaign.findMany({
      where: { clientId, archivedAt: null },
      orderBy: { startDate: "desc" },
      take: TAKE,
      select: { id: true, name: true, objective: true, status: true, startDate: true, endDate: true, plannedBudget: true, entries: { where: { archivedAt: null }, select: { spend: true, leads: true } } },
    }),
  renewals: (clientId: string) =>
    db.domainHostingAsset.findMany({
      where: { clientId, archivedAt: null },
      orderBy: { expiryDate: "asc" },
      take: TAKE,
      select: { id: true, kind: true, name: true, provider: true, expiryDate: true, autoRenew: true, credentialsLocation: true },
    }),
  invoices: (clientId: string) =>
    db.invoice.findMany({
      where: { clientId, NOT: { status: "CANCELLED", number: null } },
      orderBy: { invoiceDate: "desc" },
      take: TAKE,
      select: { id: true, number: true, type: true, status: true, paymentStatus: true, invoiceDate: true, dueDate: true, grandTotal: true, balanceDue: true },
    }),
  payments: (clientId: string) =>
    db.payment.findMany({
      where: { clientId, voidedAt: null },
      orderBy: { date: "desc" },
      take: TAKE,
      select: { id: true, date: true, amount: true, tdsAmount: true, mode: true, reference: true },
    }),
  expenses: (clientId: string) =>
    db.expense.findMany({
      where: { clientId, archivedAt: null },
      orderBy: { date: "desc" },
      take: TAKE,
      select: { id: true, date: true, category: true, description: true, vendor: true, amount: true },
    }),
  documents: (clientId: string) =>
    db.document.findMany({
      where: { clientId, archivedAt: null },
      orderBy: { createdAt: "desc" },
      take: TAKE,
      select: { id: true, name: true, category: true, createdAt: true, sizeBytes: true },
    }),
  communication: (clientId: string) =>
    db.communicationLog.findMany({
      where: { clientId },
      orderBy: { date: "desc" },
      take: TAKE,
      select: { id: true, type: true, date: true, summary: true, nextAction: true, nextActionDate: true },
    }),
  activity: (clientId: string) =>
    db.activityLog.findMany({
      where: { clientId },
      orderBy: { createdAt: "desc" },
      take: TAKE,
      select: { id: true, action: true, changes: true, createdAt: true, actor: { select: { name: true } } },
    }),
};
