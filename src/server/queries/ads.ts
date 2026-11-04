import "server-only";
import type { AdCampaignStatus, Prisma } from "@prisma/client";
import { adMetrics, totalEntries } from "@/lib/ad-metrics";
import { dateOnlyKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { idParam, param, parseListParams, type SearchParams } from "@/lib/list-params";
import { CAMPAIGN_STATUSES } from "@/lib/validators/delivery";

const SORTS = ["startDate", "name", "plannedBudget", "status"] as const;
const LIST = { sorts: SORTS, defaultSort: "startDate", defaultDir: "desc" } as const;

function buildWhere(sp: SearchParams, q: string): Prisma.AdCampaignWhereInput {
  const status = CAMPAIGN_STATUSES.find((s) => s === param(sp, "status")) as AdCampaignStatus | undefined;
  const contains = { contains: q, mode: "insensitive" as const };
  return {
    archivedAt: param(sp, "show") === "archived" ? { not: null } : null,
    ...(status ? { status } : {}),
    ...(idParam(sp, "client") ? { clientId: idParam(sp, "client") } : {}),
    ...(q ? { OR: [{ name: contains }, { objective: contains }, { client: { companyName: contains } }] } : {}),
  };
}

const select = {
  id: true, name: true, objective: true, status: true, startDate: true, endDate: true, plannedBudget: true,
  client: { select: { companyName: true } },
} satisfies Prisma.AdCampaignSelect;

/** Totals are added up by the database, for only the campaigns being shown. */
async function withTotals(rows: Prisma.AdCampaignGetPayload<{ select: typeof select }>[]) {
  const totals = await db.adSpendEntry.groupBy({
    by: ["campaignId"],
    where: { archivedAt: null, campaignId: { in: rows.map((r) => r.id) } },
    _sum: { spend: true, impressions: true, clicks: true, leads: true, conversionValue: true },
  });
  const byId = new Map(totals.map((t) => [t.campaignId, t._sum]));
  return rows.map((c) => {
    const s = byId.get(c.id);
    const total = totalEntries([{ spend: s?.spend ?? 0, impressions: s?.impressions ?? 0, clicks: s?.clicks ?? 0, leads: s?.leads ?? 0, conversionValue: s?.conversionValue ?? 0 }]);
    const m = adMetrics(total, c.plannedBudget);
    return {
      id: c.id,
      name: c.name,
      client: c.client.companyName,
      objective: c.objective,
      status: c.status as string,
      startDate: dateOnlyKey(c.startDate),
      endDate: c.endDate ? dateOnlyKey(c.endDate) : null,
      budget: c.plannedBudget.toString(),
      spend: total.spend.toFixed(2),
      impressions: total.impressions,
      clicks: total.clicks,
      leads: total.leads,
      ctr: m.ctr,
      cpl: m.cpl?.toFixed(2) ?? null,
      roas: m.roas,
      utilisation: m.utilisation,
    };
  });
}
export type CampaignRow = Awaited<ReturnType<typeof withTotals>>[number];

export async function getCampaignList(sp: SearchParams) {
  const params = parseListParams(sp, LIST);
  const where = buildWhere(sp, params.q);
  const total = await db.adCampaign.count({ where });
  const page = Math.min(params.page, Math.max(1, Math.ceil(total / params.pageSize)));
  const rows = await db.adCampaign.findMany({ where, select, orderBy: [{ [params.sort]: params.dir }, { id: "asc" }], skip: (page - 1) * params.pageSize, take: params.pageSize });
  return { rows: await withTotals(rows), total, ...params, page };
}

export async function getCampaignsForExport(sp: SearchParams) {
  const params = parseListParams(sp, LIST);
  const rows = await db.adCampaign.findMany({ where: buildWhere(sp, params.q), select, orderBy: [{ [params.sort]: params.dir }, { id: "asc" }], take: 20_000 });
  return withTotals(rows);
}

export const getCampaign = (id: string) =>
  db.adCampaign.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, companyName: true } },
      project: { select: { id: true, name: true } },
      entries: { where: { archivedAt: null }, orderBy: { periodStart: "desc" } },
    },
  });

export const getAdClients = () => db.client.findMany({ where: { archivedAt: null, adCampaigns: { some: { archivedAt: null } } }, orderBy: { companyName: "asc" }, select: { id: true, companyName: true } });
