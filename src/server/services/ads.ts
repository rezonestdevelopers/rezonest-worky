import { analyseAdRows, mapAdColumns, periodsOverlap, type AdImportRow } from "@/lib/ad-metrics";
import { dateOnlyKey, keyToDate, todayKey } from "@/lib/dates";
import type { CampaignData, SpendEntryData } from "@/lib/validators/delivery";
import { readTable } from "./import";
import { BusinessError, diffChanges, logActivity, type Db, type Tx } from "./shared";

export const MAX_AD_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_AD_IMPORT_ROWS = 2000;

const CAMPAIGN_FIELDS = ["clientId", "projectId", "name", "objective", "status", "startDate", "endDate", "plannedBudget"] as const;

async function assertClientAndProject(tx: Tx, clientId: string, projectId: string | null) {
  const client = await tx.client.findUnique({ where: { id: clientId } });
  if (!client || client.archivedAt) throw new BusinessError("That client is archived. Restore them first.");
  if (projectId) {
    const project = await tx.project.findFirst({ where: { id: projectId, clientId, archivedAt: null } });
    if (!project) throw new BusinessError("That project isn't one of this client's.");
  }
}

export async function saveCampaign(db: Db, id: string | null, data: CampaignData, actorId: string) {
  return db.$transaction(async (tx) => {
    await assertClientAndProject(tx, data.clientId, data.projectId);
    const duplicate = await tx.adCampaign.findFirst({ where: { clientId: data.clientId, name: { equals: data.name, mode: "insensitive" }, archivedAt: null, ...(id ? { id: { not: id } } : {}) } });
    // CSV uploads find a campaign by its name, so it must be unique for the client.
    if (duplicate) throw new BusinessError("This client already has a campaign with that name.");
    const fields = {
      clientId: data.clientId,
      projectId: data.projectId,
      name: data.name,
      objective: data.objective,
      status: data.status,
      startDate: keyToDate(data.startDate),
      endDate: data.endDate ? keyToDate(data.endDate) : null,
      plannedBudget: data.plannedBudget,
    };
    if (!id) {
      const campaign = await tx.adCampaign.create({ data: fields });
      await logActivity(tx, { actorId, action: "ads.campaign_created", entityType: "AdCampaign", entityId: campaign.id, clientId: campaign.clientId, changes: { name: campaign.name, budget: data.plannedBudget } });
      return campaign;
    }
    const before = await tx.adCampaign.findUnique({ where: { id } });
    if (!before || before.archivedAt) throw new BusinessError("This campaign no longer exists.");
    const after = await tx.adCampaign.update({ where: { id }, data: fields });
    const changes = diffChanges(before, after, CAMPAIGN_FIELDS);
    if (Object.keys(changes).length) await logActivity(tx, { actorId, action: "ads.campaign_updated", entityType: "AdCampaign", entityId: id, clientId: after.clientId, changes });
    return after;
  });
}

export async function setCampaignArchived(db: Db, id: string, archived: boolean, actorId: string) {
  await db.$transaction(async (tx) => {
    const campaign = await tx.adCampaign.findUnique({ where: { id } });
    if (!campaign) throw new BusinessError("This campaign no longer exists.");
    await tx.adCampaign.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
    await logActivity(tx, { actorId, action: archived ? "ads.campaign_archived" : "ads.campaign_restored", entityType: "AdCampaign", entityId: id, clientId: campaign.clientId, changes: { name: campaign.name } });
  });
}

/** Holds other saves to this campaign until this one finishes, so two can't both pass the overlap check. */
const lockCampaign = (tx: Tx, campaignId: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${campaignId}))`;

/** Periods can't overlap, because the same day counted twice would overstate the client's spend. */
export async function saveSpendEntry(db: Db, id: string | null, data: SpendEntryData, actorId: string) {
  return db.$transaction(async (tx) => {
    await lockCampaign(tx, data.campaignId);
    const campaign = await tx.adCampaign.findUnique({ where: { id: data.campaignId } });
    if (!campaign || campaign.archivedAt) throw new BusinessError("This campaign is archived. Restore it before making changes.");
    if (data.periodEnd > todayKey()) throw new BusinessError("You can't enter results for dates still to come.");
    const others = await tx.adSpendEntry.findMany({ where: { campaignId: campaign.id, archivedAt: null, ...(id ? { id: { not: id } } : {}) }, select: { periodStart: true, periodEnd: true } });
    const period = { start: data.periodStart, end: data.periodEnd };
    const clash = others.find((o) => periodsOverlap({ start: dateOnlyKey(o.periodStart), end: dateOnlyKey(o.periodEnd) }, period));
    if (clash) throw new BusinessError(`These dates overlap an entry for ${dateOnlyKey(clash.periodStart)} to ${dateOnlyKey(clash.periodEnd)}. Edit that one, or change the dates.`);

    const fields = {
      periodStart: keyToDate(data.periodStart),
      periodEnd: keyToDate(data.periodEnd),
      spend: data.spend,
      impressions: data.impressions,
      clicks: data.clicks,
      leads: data.leads,
      conversionValue: data.conversionValue,
    };
    if (id) {
      const before = await tx.adSpendEntry.findFirst({ where: { id, campaignId: campaign.id, archivedAt: null } });
      if (!before) throw new BusinessError("This entry no longer exists.");
      await tx.adSpendEntry.update({ where: { id }, data: fields });
      await logActivity(tx, { actorId, action: "ads.entry_updated", entityType: "AdCampaign", entityId: campaign.id, clientId: campaign.clientId, changes: { period: `${data.periodStart} to ${data.periodEnd}`, spend: { from: before.spend.toString(), to: data.spend } } });
    } else {
      await tx.adSpendEntry.create({ data: { ...fields, campaignId: campaign.id } });
      await logActivity(tx, { actorId, action: "ads.entry_added", entityType: "AdCampaign", entityId: campaign.id, clientId: campaign.clientId, changes: { period: `${data.periodStart} to ${data.periodEnd}`, spend: data.spend } });
    }
  });
}

/** Taken out of the totals but kept, so a mistaken removal can be traced. */
export async function removeSpendEntry(db: Db, id: string, actorId: string) {
  await db.$transaction(async (tx) => {
    const entry = await tx.adSpendEntry.findUnique({ where: { id }, include: { campaign: { select: { clientId: true } } } });
    if (!entry || entry.archivedAt) throw new BusinessError("This entry no longer exists.");
    await tx.adSpendEntry.update({ where: { id }, data: { archivedAt: new Date() } });
    await logActivity(tx, { actorId, action: "ads.entry_removed", entityType: "AdCampaign", entityId: entry.campaignId, clientId: entry.campaign.clientId, changes: { period: `${dateOnlyKey(entry.periodStart)} to ${dateOnlyKey(entry.periodEnd)}`, spend: entry.spend.toString() } });
  });
}

// ─── Uploading a report from Ads Manager ─────────────────────────────────────

async function analyse(db: Db | Tx, clientId: string, rows: { rowNumber: number; cells: string[] }[], columns: Record<string, number>): Promise<AdImportRow[]> {
  const campaigns = await db.adCampaign.findMany({ where: { clientId, archivedAt: null }, select: { id: true, name: true } });
  const entries = await db.adSpendEntry.findMany({ where: { archivedAt: null, campaignId: { in: campaigns.map((c) => c.id) } }, select: { campaignId: true, periodStart: true, periodEnd: true } });
  return analyseAdRows({
    rows,
    columns,
    campaigns,
    existing: entries.map((e) => ({ campaignId: e.campaignId, start: dateOnlyKey(e.periodStart), end: dateOnlyKey(e.periodEnd) })),
    today: todayKey(),
  });
}

/** Reads the file and reports what would happen. Nothing is saved. */
export async function previewAdImport(db: Db, input: { clientId: string; buffer: Buffer; fileName: string }) {
  const table = (await readTable(input.buffer, input.fileName)).filter((r) => r.cells.some(Boolean));
  if (table.length === 0) throw new BusinessError("This file is empty.");
  const [header, ...body] = table;
  const { columns, ignored, leadsFromResults } = mapAdColumns(header.cells);
  for (const [field, label] of [["campaign", "Campaign name"], ["start", "Reporting starts"], ["spend", "Amount spent (INR)"]]) {
    if (columns[field] === undefined) throw new BusinessError(`No “${label}” column was found in the first row. In Ads Manager, export with that column included.`);
  }
  if (body.length === 0) throw new BusinessError("The file has column headings but no rows of data.");
  if (body.length > MAX_AD_IMPORT_ROWS) throw new BusinessError(`This file has ${body.length} rows. The limit is ${MAX_AD_IMPORT_ROWS} at a time, so please split it.`);
  const rows = body.map((r) => ({ rowNumber: r.number, cells: r.cells }));
  return { rows, columns, ignored, leadsFromResults, analysed: await analyse(db, input.clientId, rows, columns) };
}

/** Saves the good rows. Everything is checked again here, in case someone else entered results meanwhile. */
export async function commitAdImport(db: Db, input: { clientId: string; rows: { rowNumber: number; cells: string[] }[]; columns: Record<string, number>; actorId: string }) {
  return db.$transaction(
    async (tx) => {
      await assertClientAndProject(tx, input.clientId, null);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.clientId}))`;
      const campaigns = await tx.adCampaign.findMany({ where: { clientId: input.clientId, archivedAt: null }, select: { id: true } });
      for (const c of campaigns) await lockCampaign(tx, c.id);
      const analysed = await analyse(tx, input.clientId, input.rows, input.columns);
      const good = analysed.filter((r) => !r.errors.length && r.campaignId);
      if (good.length) {
        await tx.adSpendEntry.createMany({
          data: good.map((r) => ({
            campaignId: r.campaignId!,
            periodStart: keyToDate(r.periodStart),
            periodEnd: keyToDate(r.periodEnd),
            spend: r.spend,
            impressions: r.impressions,
            clicks: r.clicks,
            leads: r.leads,
            conversionValue: r.conversionValue,
            source: "csv",
          })),
        });
      }
      await logActivity(tx, { actorId: input.actorId, action: "ads.report_uploaded", entityType: "Client", entityId: input.clientId, clientId: input.clientId, changes: { imported: good.length, skipped: analysed.length - good.length } });
      return { imported: good.length, skipped: analysed.length - good.length };
    },
    { timeout: 30_000 },
  );
}
