import "server-only";
import type { OfferStatus, Prisma } from "@prisma/client";
import { addDaysKey, dateOnlyKey, keyToDate, todayKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { idParam, param, parseListParams, type SearchParams } from "@/lib/list-params";

const SORTS = ["offerDate", "number", "title", "status", "validUntil", "followUpDate", "taxableTotal"] as const;
const STATUSES: OfferStatus[] = ["DRAFT", "SENT", "ON_HOLD", "ACCEPTED", "REJECTED", "EXPIRED"];

export function buildOfferWhere(sp: SearchParams, q: string): Prisma.OfferWhereInput {
  const status = STATUSES.find((s) => s === param(sp, "status"));
  const contains = { contains: q, mode: "insensitive" as const };
  const today = keyToDate(todayKey());
  const open: OfferStatus[] = ["SENT", "ON_HOLD"];
  return {
    isTemplate: false,
    archivedAt: param(sp, "view") === "archived" ? { not: null } : null,
    ...(status ? { status } : {}),
    ...(idParam(sp, "client") ? { clientId: idParam(sp, "client") } : {}),
    ...(idParam(sp, "lead") ? { leadId: idParam(sp, "lead") } : {}),
    ...(param(sp, "attention") === "followup" ? { status: { in: open }, followUpDate: { lte: today } } : {}),
    ...(param(sp, "attention") === "expiring" ? { status: { in: open }, validUntil: { gte: today, lte: keyToDate(addDaysKey(todayKey(), 7)) } } : {}),
    ...(q
      ? {
          OR: [
            { number: contains },
            { title: contains },
            { client: { companyName: contains } },
            { lead: { companyName: contains } },
            { lead: { contactName: contains } },
          ],
        }
      : {}),
  };
}

function orderBy(sort: (typeof SORTS)[number], dir: "asc" | "desc"): Prisma.OfferOrderByWithRelationInput[] {
  const tie = { id: "asc" as const };
  return sort === "followUpDate" ? [{ followUpDate: { sort: dir, nulls: "last" } }, tie] : [{ [sort]: dir }, tie];
}

const listSelect = {
  id: true, number: true, title: true, status: true, currentVersion: true, offerDate: true, validUntil: true, followUpDate: true,
  taxableTotal: true, grandTotal: true, clientId: true, leadId: true,
  client: { select: { companyName: true } },
  lead: { select: { companyName: true, contactName: true } },
} satisfies Prisma.OfferSelect;

function toRow(o: Prisma.OfferGetPayload<{ select: typeof listSelect }>) {
  return {
    id: o.id,
    number: o.number,
    title: o.title,
    status: o.status,
    version: o.currentVersion,
    recipient: o.client?.companyName ?? o.lead?.companyName ?? o.lead?.contactName ?? "—",
    recipientKind: o.clientId ? ("Client" as const) : ("Lead" as const),
    offerDate: dateOnlyKey(o.offerDate),
    validUntil: dateOnlyKey(o.validUntil),
    followUpDate: o.followUpDate ? dateOnlyKey(o.followUpDate) : null,
    taxableTotal: o.taxableTotal.toString(),
    grandTotal: o.grandTotal.toString(),
  };
}
export type OfferRow = ReturnType<typeof toRow>;

export async function getOfferList(sp: SearchParams) {
  const params = parseListParams(sp, { sorts: SORTS, defaultSort: "offerDate", defaultDir: "desc" });
  const where = buildOfferWhere(sp, params.q);
  const total = await db.offer.count({ where });
  const page = Math.min(params.page, Math.max(1, Math.ceil(total / params.pageSize)));
  const rows = await db.offer.findMany({ where, select: listSelect, orderBy: orderBy(params.sort, params.dir), skip: (page - 1) * params.pageSize, take: params.pageSize });
  return { rows: rows.map(toRow), total, ...params, page };
}

export async function getOffersForExport(sp: SearchParams) {
  const params = parseListParams(sp, { sorts: SORTS, defaultSort: "offerDate", defaultDir: "desc" });
  const rows = await db.offer.findMany({ where: buildOfferWhere(sp, params.q), select: listSelect, orderBy: orderBy(params.sort, params.dir), take: 20_000 });
  return rows.map(toRow);
}

export function getOfferHistory(offerId: string) {
  return Promise.all([
    db.offerStatusHistory.findMany({ where: { offerId }, orderBy: { createdAt: "desc" }, include: { changedBy: { select: { name: true } } } }),
    db.offerVersion.findMany({ where: { offerId }, orderBy: { version: "desc" } }),
    db.publicLink.findMany({ where: { offerId, type: "OFFER" }, orderBy: { createdAt: "desc" } }),
  ]);
}

export function getTemplates() {
  return db.offer.findMany({
    where: { isTemplate: true, archivedAt: null },
    orderBy: { templateName: "asc" },
    select: { id: true, templateName: true, title: true, taxableTotal: true, updatedAt: true, _count: { select: { items: true } } },
  });
}

/** Choices for the offer form: who it's for, the catalogue, and the agency's defaults. */
export async function getOfferFormOptions() {
  const [clients, leads, services, settings] = await Promise.all([
    db.client.findMany({ where: { archivedAt: null }, orderBy: { companyName: "asc" }, select: { id: true, companyName: true, stateCode: true, state: true, country: true } }),
    db.lead.findMany({
      where: { archivedAt: null, convertedClientId: null, stage: { notIn: ["WON", "LOST"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, contactName: true, companyName: true },
    }),
    db.service.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      include: { subServices: { where: { isActive: true }, orderBy: { sortOrder: "asc" } } },
    }),
    db.settings.findUniqueOrThrow({ where: { id: "agency" } }),
  ]);
  return {
    clients: clients.map((c) => ({ value: c.id, label: c.companyName, stateCode: c.stateCode, state: c.state, abroad: c.country !== "India" })),
    leads: leads.map((l) => ({ value: l.id, label: l.companyName ? `${l.companyName} (${l.contactName})` : l.contactName })),
    services: services.map((s) => ({
      id: s.id,
      name: s.name,
      billingType: s.billingType,
      price: s.defaultPrice.toString(),
      unit: s.unit,
      gstRate: s.gstRate.toString(),
      sacCode: s.sacCode ?? "",
      subs: s.subServices.map((x) => ({ id: x.id, name: x.name, billingType: x.billingType, price: x.defaultPrice?.toString() ?? null, unit: x.unit })),
    })),
    agencyStateCode: settings.stateCode,
    gstOnByDefault: settings.gstEnabledByDefault,
    defaultGstRate: settings.defaultGstRate.toString(),
    validityDays: settings.offerValidityDays,
    quotationTerms: settings.quotationTerms ?? "",
  };
}
export type OfferFormOptions = Awaited<ReturnType<typeof getOfferFormOptions>>;
