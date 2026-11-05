import "server-only";
import type { LeadStage, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { dateOnlyKey, keyToDate, todayKey } from "@/lib/dates";
import { LEAD_STAGES } from "@/lib/lead-stage";
import { idParam, param, parseListParams, type SearchParams } from "@/lib/list-params";

const SORTS = ["createdAt", "contactName", "companyName", "stage", "nextFollowUpDate", "approxBudget"] as const;

/** Ids of records whose phone contains these digits, however the number was typed. */
async function leadIdsByPhone(q: string): Promise<string[]> {
  const digits = q.replace(/\D/g, "");
  if (digits.length < 4 || digits.length < q.replace(/[\s+()-]/g, "").length) return [];
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Lead"
    WHERE regexp_replace(coalesce("phone", ''), '\D', '', 'g') LIKE ${`%${digits}%`}
       OR regexp_replace(coalesce("whatsapp", ''), '\D', '', 'g') LIKE ${`%${digits}%`}`;
  return rows.map((r) => r.id);
}

export async function buildLeadWhere(sp: SearchParams, q: string): Promise<Prisma.LeadWhereInput> {
  const stage = LEAD_STAGES.find((s) => s === param(sp, "stage")) as LeadStage | undefined;
  const contains = { contains: q, mode: "insensitive" as const };
  const phoneIds = q ? await leadIdsByPhone(q) : [];
  return {
    archivedAt: param(sp, "view") === "archived" ? { not: null } : null,
    ...(stage ? { stage } : {}),
    ...(idParam(sp, "sector") ? { sectorId: idParam(sp, "sector") } : {}),
    ...(idParam(sp, "source") ? { leadSourceId: idParam(sp, "source") } : {}),
    ...(idParam(sp, "owner") ? { ownerId: idParam(sp, "owner") } : {}),
    ...(param(sp, "followup") === "due" ? { stage: { notIn: ["WON", "LOST"] as LeadStage[] }, nextFollowUpDate: { lte: keyToDate(todayKey()) } } : {}),
    ...(q
      ? {
          OR: [
            { contactName: contains },
            { companyName: contains },
            { email: contains },
            { phone: contains },
            { whatsapp: contains },
            { city: contains },
            ...(phoneIds.length ? [{ id: { in: phoneIds } }] : []),
          ],
        }
      : {}),
  };
}

function orderBy(sort: (typeof SORTS)[number], dir: "asc" | "desc"): Prisma.LeadOrderByWithRelationInput[] {
  const tie = { id: "asc" as const };
  switch (sort) {
    case "companyName":
    case "nextFollowUpDate":
    case "approxBudget":
      return [{ [sort]: { sort: dir, nulls: "last" } }, tie];
    default:
      return [{ [sort]: dir }, tie];
  }
}

const listSelect = {
  id: true,
  contactName: true,
  companyName: true,
  phone: true,
  email: true,
  city: true,
  stage: true,
  approxBudget: true,
  nextFollowUpDate: true,
  createdAt: true,
  archivedAt: true,
  convertedClientId: true,
  sector: { select: { name: true } },
  leadSource: { select: { name: true } },
  owner: { select: { name: true } },
} satisfies Prisma.LeadSelect;

function toRow(l: Prisma.LeadGetPayload<{ select: typeof listSelect }>) {
  return {
    id: l.id,
    contactName: l.contactName,
    companyName: l.companyName,
    phone: l.phone,
    email: l.email,
    city: l.city,
    stage: l.stage,
    approxBudget: l.approxBudget?.toString() ?? null,
    nextFollowUpDate: l.nextFollowUpDate ? dateOnlyKey(l.nextFollowUpDate) : null,
    createdAt: l.createdAt.toISOString(),
    converted: !!l.convertedClientId,
    archived: !!l.archivedAt,
    sector: l.sector?.name ?? null,
    source: l.leadSource?.name ?? null,
    owner: l.owner?.name ?? null,
  };
}
export type LeadRow = ReturnType<typeof toRow>;

export async function getLeadList(sp: SearchParams) {
  const params = parseListParams(sp, { sorts: SORTS, defaultSort: "createdAt", defaultDir: "desc" });
  const where = await buildLeadWhere(sp, params.q);
  const total = await db.lead.count({ where });
  // If filters shrink the list, don't strand the user on an empty page.
  const page = Math.min(params.page, Math.max(1, Math.ceil(total / params.pageSize)));
  const rows = await db.lead.findMany({
    where,
    select: listSelect,
    orderBy: orderBy(params.sort, params.dir),
    skip: (page - 1) * params.pageSize,
    take: params.pageSize,
  });
  return { rows: rows.map(toRow), total, ...params, page };
}

export async function getLeadsForExport(sp: SearchParams) {
  const params = parseListParams(sp, { sorts: SORTS, defaultSort: "createdAt", defaultDir: "desc" });
  const rows = await db.lead.findMany({
    where: await buildLeadWhere(sp, params.q),
    select: { ...listSelect, whatsapp: true, requirementNotes: true, lostReason: true },
    orderBy: orderBy(params.sort, params.dir),
    take: 20_000,
  });
  return rows.map((l) => ({ ...toRow(l), whatsapp: l.whatsapp, requirementNotes: l.requirementNotes, lostReason: l.lostReason }));
}

export async function getLeadDetail(id: string) {
  return db.lead.findUnique({
    where: { id },
    include: {
      sector: { select: { name: true } },
      leadSource: { select: { name: true } },
      owner: { select: { name: true } },
      convertedClient: { select: { id: true, companyName: true } },
      stageHistory: { orderBy: { createdAt: "desc" }, include: { changedBy: { select: { name: true } } } },
      offers: { where: { archivedAt: null }, orderBy: { offerDate: "desc" }, select: { id: true, number: true, title: true, status: true, offerDate: true } },
      communications: { where: { archivedAt: null }, orderBy: { date: "desc" }, take: 50 },
    },
  });
}
