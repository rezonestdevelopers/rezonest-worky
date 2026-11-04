import "server-only";
import type { AssetKind, Prisma } from "@prisma/client";
import { addDaysKey, dateOnlyKey, keyToDate, todayKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { idParam, param, parseListParams, type SearchParams } from "@/lib/list-params";
import { sum, toDecimal } from "@/lib/money/decimal";
import { ASSET_KINDS, renewalMargin } from "@/lib/renewals";

const SORTS = ["expiryDate", "name", "kind", "renewalPrice"] as const;
const LIST = { sorts: SORTS, defaultSort: "expiryDate", defaultDir: "asc" } as const;

function buildWhere(sp: SearchParams, q: string): Prisma.DomainHostingAssetWhereInput {
  const kind = ASSET_KINDS.find((k) => k === param(sp, "kind")) as AssetKind | undefined;
  const within = param(sp, "within");
  const today = todayKey();
  const contains = { contains: q, mode: "insensitive" as const };
  const days = within && ["7", "15", "30", "90"].includes(within) ? Number(within) : null;
  return {
    archivedAt: param(sp, "show") === "archived" ? { not: null } : null,
    ...(kind ? { kind } : {}),
    ...(idParam(sp, "client") ? { clientId: idParam(sp, "client") } : {}),
    ...(within === "expired" ? { expiryDate: { lt: keyToDate(today) } } : {}),
    ...(days ? { expiryDate: { gte: keyToDate(today), lte: keyToDate(addDaysKey(today, days)) } } : {}),
    ...(q ? { OR: [{ name: contains }, { provider: contains }, { plan: contains }, { client: { companyName: contains } }] } : {}),
  };
}

const select = {
  id: true, kind: true, name: true, provider: true, plan: true, expiryDate: true, costPrice: true, renewalPrice: true, autoRenew: true,
  client: { select: { companyName: true } },
} satisfies Prisma.DomainHostingAssetSelect;

function toRow(a: Prisma.DomainHostingAssetGetPayload<{ select: typeof select }>) {
  const margin = renewalMargin(a.costPrice, a.renewalPrice);
  return {
    id: a.id,
    kind: a.kind as string,
    name: a.name,
    provider: a.provider,
    plan: a.plan,
    client: a.client.companyName,
    expiryDate: dateOnlyKey(a.expiryDate),
    cost: a.costPrice.toString(),
    price: a.renewalPrice.toString(),
    margin: margin.amount.toFixed(2),
    marginPercent: margin.percent,
    autoRenew: a.autoRenew,
  };
}
export type RenewalRow = ReturnType<typeof toRow>;

export async function getRenewalList(sp: SearchParams) {
  const params = parseListParams(sp, LIST);
  const where = buildWhere(sp, params.q);
  const total = await db.domainHostingAsset.count({ where });
  const page = Math.min(params.page, Math.max(1, Math.ceil(total / params.pageSize)));
  const rows = await db.domainHostingAsset.findMany({ where, select, orderBy: [{ [params.sort]: params.dir }, { id: "asc" }], skip: (page - 1) * params.pageSize, take: params.pageSize });
  return { rows: rows.map(toRow), total, ...params, page };
}

export async function getRenewalsForExport(sp: SearchParams) {
  const params = parseListParams(sp, LIST);
  const rows = await db.domainHostingAsset.findMany({ where: buildWhere(sp, params.q), select, orderBy: [{ [params.sort]: params.dir }, { id: "asc" }], take: 20_000 });
  return rows.map(toRow);
}

export async function getRenewalSummary() {
  const today = todayKey();
  const active = { archivedAt: null };
  const within = (days: number) => ({ ...active, expiryDate: { gte: keyToDate(today), lte: keyToDate(addDaysKey(today, days)) } });
  const [expired, week, month, totals] = await Promise.all([
    db.domainHostingAsset.count({ where: { ...active, expiryDate: { lt: keyToDate(today) } } }),
    db.domainHostingAsset.count({ where: within(7) }),
    db.domainHostingAsset.count({ where: within(30) }),
    db.domainHostingAsset.aggregate({ where: active, _sum: { costPrice: true, renewalPrice: true } }),
  ]);
  const price = toDecimal(totals._sum.renewalPrice);
  return { expired, week, month, price: price.toFixed(2), margin: sum([price, toDecimal(totals._sum.costPrice).negated()]).toFixed(2) };
}

export const getAsset = (id: string) =>
  db.domainHostingAsset.findUnique({ where: { id }, include: { client: { select: { id: true, companyName: true } } } });

export const getAssetClients = () => db.client.findMany({ where: { archivedAt: null, assets: { some: { archivedAt: null } } }, orderBy: { companyName: "asc" }, select: { id: true, companyName: true } });
