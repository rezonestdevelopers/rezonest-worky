import type { Prisma } from "@prisma/client";
import { keyToDate } from "@/lib/dates";
import { stageChangeError, type LeadStage } from "@/lib/lead-stage";
import type { ClientCreateData } from "@/lib/validators/client";
import type { LeadData } from "@/lib/validators/lead";
import { createClientInTx } from "./clients";
import { ensureOfferOnboarding } from "./onboarding";
import { BusinessError, diffChanges, logActivity, type Db, type Tx } from "./shared";

const LEAD_FIELDS = [
  "contactName", "companyName", "phone", "whatsapp", "email", "sectorId", "city", "leadSourceId",
  "servicesInterested", "approxBudget", "requirementNotes", "nextFollowUpDate", "ownerId",
] as const;

function leadColumns(d: LeadData) {
  return {
    contactName: d.contactName,
    companyName: d.companyName,
    phone: d.phone,
    whatsapp: d.whatsapp,
    email: d.email,
    sectorId: d.sectorId,
    city: d.city,
    leadSourceId: d.leadSourceId,
    servicesInterested: d.servicesInterested,
    approxBudget: d.approxBudget,
    requirementNotes: d.requirementNotes,
    nextFollowUpDate: d.nextFollowUpDate ? keyToDate(d.nextFollowUpDate) : null,
    ownerId: d.ownerId,
  } satisfies Prisma.LeadUncheckedCreateInput;
}

export async function createLeadInTx(tx: Tx, data: LeadData, actorId: string, action = "lead.created") {
  const lead = await tx.lead.create({
    data: {
      ...leadColumns(data),
      ownerId: data.ownerId ?? actorId,
      createdById: actorId,
      stageHistory: { create: { toStage: "NEW", changedById: actorId } },
    },
  });
  await logActivity(tx, { actorId, action, entityType: "Lead", entityId: lead.id });
  return lead;
}

export function createLead(db: Db, data: LeadData, actorId: string) {
  return db.$transaction((tx) => createLeadInTx(tx, data, actorId));
}

export async function updateLead(db: Db, id: string, data: LeadData, actorId: string) {
  return db.$transaction(async (tx) => {
    const before = await tx.lead.findUnique({ where: { id } });
    if (!before) throw new BusinessError("This lead no longer exists.");
    if (before.archivedAt) throw new BusinessError("This lead is archived. Restore it before making changes.");
    const after = await tx.lead.update({ where: { id }, data: leadColumns(data) });
    const changes = diffChanges(before, after, LEAD_FIELDS);
    if (Object.keys(changes).length) {
      await logActivity(tx, { actorId, action: "lead.updated", entityType: "Lead", entityId: id, clientId: before.convertedClientId, changes });
    }
    return after;
  });
}

export async function changeLeadStage(db: Db, input: { leadId: string; stage: LeadStage; lostReason: string | null; actorId: string }) {
  return db.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({ where: { id: input.leadId } });
    if (!lead) throw new BusinessError("This lead no longer exists.");
    if (lead.archivedAt) throw new BusinessError("This lead is archived. Restore it before making changes.");
    const problem = stageChangeError({
      from: lead.stage,
      to: input.stage,
      converted: !!lead.convertedClientId,
      lostReason: input.lostReason,
    });
    if (problem) throw new BusinessError(problem);

    const lost = input.stage === "LOST";
    await tx.lead.update({
      where: { id: lead.id },
      data: { stage: input.stage, lostReason: lost ? input.lostReason : null, ...(lost ? { nextFollowUpDate: null } : {}) },
    });
    await tx.leadStageHistory.create({
      data: { leadId: lead.id, fromStage: lead.stage, toStage: input.stage, note: lost ? input.lostReason : null, changedById: input.actorId },
    });
    await logActivity(tx, {
      actorId: input.actorId, action: "lead.stage_changed", entityType: "Lead", entityId: lead.id,
      changes: { stage: { from: lead.stage, to: input.stage } },
    });
  });
}

/**
 * Turns a lead into a client, or links it to a client that already exists.
 * The lead becomes Won, and its offers and notes move to the client. Everything
 * happens together or not at all, and a lead can only ever be converted once,
 * even if the button is clicked twice at the same moment.
 */
export async function convertLead(
  db: Db,
  input: { leadId: string; actorId: string } & ({ client: ClientCreateData } | { linkClientId: string }),
) {
  return db.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({ where: { id: input.leadId } });
    if (!lead) throw new BusinessError("This lead no longer exists.");
    if (lead.archivedAt) throw new BusinessError("This lead is archived. Restore it before converting.");
    if (lead.convertedClientId) throw new BusinessError("This lead has already been converted to a client.");

    let clientId: string;
    if ("client" in input) {
      clientId = (await createClientInTx(tx, input.client, input.actorId, "client.created_from_lead")).id;
    } else {
      const existing = await tx.client.findFirst({ where: { id: input.linkClientId, archivedAt: null } });
      if (!existing) throw new BusinessError("That client can't be linked. It may have been archived.");
      clientId = existing.id;
    }

    const { count } = await tx.lead.updateMany({
      where: { id: lead.id, convertedClientId: null },
      data: { convertedClientId: clientId, convertedAt: new Date(), stage: "WON", lostReason: null, nextFollowUpDate: null },
    });
    if (!count) throw new BusinessError("This lead has already been converted to a client.");

    await tx.offer.updateMany({ where: { leadId: lead.id, clientId: null }, data: { clientId } });
    await tx.communicationLog.updateMany({ where: { leadId: lead.id, clientId: null }, data: { clientId } });
    const accepted = await tx.offer.findMany({ where: { leadId: lead.id, status: "ACCEPTED" }, select: { id: true } });
    for (const offer of accepted) await ensureOfferOnboarding(tx, offer.id);
    if (lead.stage !== "WON") {
      await tx.leadStageHistory.create({
        data: { leadId: lead.id, fromStage: lead.stage, toStage: "WON", note: "Converted to client", changedById: input.actorId },
      });
    }
    await logActivity(tx, {
      actorId: input.actorId, action: "lead.converted", entityType: "Lead", entityId: lead.id, clientId,
      changes: { stage: { from: lead.stage, to: "WON" } },
    });
    return { clientId };
  });
}

export async function setLeadArchived(db: Db, id: string, archived: boolean, actorId: string) {
  await db.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({ where: { id } });
    if (!lead) throw new BusinessError("This lead no longer exists.");
    if (!!lead.archivedAt === archived) return;
    await tx.lead.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
    await logActivity(tx, { actorId, action: archived ? "lead.archived" : "lead.restored", entityType: "Lead", entityId: id, clientId: lead.convertedClientId });
  });
}
