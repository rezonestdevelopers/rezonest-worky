"use server";

import { revalidatePath } from "next/cache";
import { findDuplicates } from "@/lib/contact-match";
import { invalid, type ActionResult } from "@/lib/action-result";
import { db } from "@/lib/db";
import { clientCreateSchema, type ClientCreateInput } from "@/lib/validators/client";
import { leadSchema, stageChangeSchema, type LeadInput, type StageChangeInput } from "@/lib/validators/lead";
import { runAction } from "@/server/action-guard";
import { changeLeadStage, convertLead, createLead, setLeadArchived, updateLead } from "@/server/services/leads";
import { loadContactables } from "@/server/services/shared";

function refresh(id?: string) {
  revalidatePath("/leads");
  if (id) revalidatePath(`/leads/${id}`);
  revalidatePath("/dashboard");
}

export async function saveLeadAction(id: string | null, input: LeadInput, confirmDuplicate: boolean): Promise<ActionResult> {
  return runAction("sales.manage", async (user) => {
    const parsed = leadSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const data = parsed.data;

    if (!confirmDuplicate) {
      const existing = await loadContactables(db, { leads: true, excludeLeadId: id ?? undefined });
      const duplicates = findDuplicates({ phones: [data.phone, data.whatsapp], emails: [data.email] }, existing);
      if (duplicates.length) return { ok: false, error: "This may already exist.", duplicates };
    }

    const lead = id ? await updateLead(db, id, data, user.id) : await createLead(db, data, user.id);
    refresh(lead.id);
    return { ok: true, id: lead.id, message: id ? "Lead updated." : "Lead created." };
  });
}

export async function changeLeadStageAction(input: StageChangeInput): Promise<ActionResult> {
  return runAction("sales.manage", async (user) => {
    const parsed = stageChangeSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await changeLeadStage(db, { ...parsed.data, leadId: parsed.data.leadId, actorId: user.id });
    refresh(parsed.data.leadId);
    return { ok: true, message: "Stage updated." };
  });
}

export async function convertLeadAction(leadId: string, input: ClientCreateInput, confirmDuplicate: boolean): Promise<ActionResult> {
  return runAction("sales.manage", async (user) => {
    const parsed = clientCreateSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const data = parsed.data;

    if (!confirmDuplicate) {
      const existing = await loadContactables(db, { leads: false });
      const duplicates = findDuplicates({ phones: [data.phone, data.whatsapp], emails: [data.email], gstin: data.gstin }, existing);
      if (duplicates.length) return { ok: false, error: "A client with these details may already exist.", duplicates };
    }

    const { clientId } = await convertLead(db, { leadId, client: data, actorId: user.id });
    refresh(leadId);
    revalidatePath("/clients");
    return { ok: true, id: clientId, message: "Lead converted to client." };
  });
}

export async function linkLeadToClientAction(leadId: string, clientId: string): Promise<ActionResult> {
  return runAction("sales.manage", async (user) => {
    const result = await convertLead(db, { leadId, linkClientId: clientId, actorId: user.id });
    refresh(leadId);
    revalidatePath(`/clients/${clientId}`);
    return { ok: true, id: result.clientId, message: "Lead linked to the existing client." };
  });
}

export async function setLeadArchivedAction(id: string, archived: boolean): Promise<ActionResult> {
  return runAction("sales.manage", async (user) => {
    await setLeadArchived(db, id, archived, user.id);
    refresh(id);
    return { ok: true, message: archived ? "Lead archived." : "Lead restored." };
  });
}
