"use server";

import { revalidatePath } from "next/cache";
import { findDuplicates } from "@/lib/contact-match";
import { invalid, type ActionResult } from "@/lib/action-result";
import { db } from "@/lib/db";
import {
  clientCreateSchema,
  clientSchema,
  contactSchema,
  type ClientCreateInput,
  type ClientInput,
  type ContactInput,
} from "@/lib/validators/client";
import { runAction } from "@/server/action-guard";
import { archiveClient, archiveContact, createClient, restoreClient, saveContact, updateClient } from "@/server/services/clients";
import { loadContactables } from "@/server/services/shared";

function refresh(id?: string) {
  revalidatePath("/clients");
  if (id) revalidatePath(`/clients/${id}`);
  revalidatePath("/dashboard");
}

export async function createClientAction(input: ClientCreateInput, confirmDuplicate: boolean): Promise<ActionResult> {
  return runAction("sales.manage", async (user) => {
    const parsed = clientCreateSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const data = parsed.data;
    if (!confirmDuplicate) {
      const existing = await loadContactables(db, { leads: false });
      const duplicates = findDuplicates({ phones: [data.phone, data.whatsapp], emails: [data.email], gstin: data.gstin }, existing);
      if (duplicates.length) return { ok: false, error: "A client with these details may already exist.", duplicates };
    }
    const client = await createClient(db, data, user.id);
    refresh(client.id);
    return { ok: true, id: client.id, message: "Client created." };
  });
}

export async function updateClientAction(id: string, input: ClientInput, confirmDuplicate: boolean): Promise<ActionResult> {
  return runAction("sales.manage", async (user) => {
    const parsed = clientSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const data = parsed.data;
    if (!confirmDuplicate) {
      const existing = await loadContactables(db, { leads: false, excludeClientId: id });
      const duplicates = findDuplicates({ phones: [data.phone, data.whatsapp], emails: [data.email], gstin: data.gstin }, existing);
      if (duplicates.length) return { ok: false, error: "A client with these details may already exist.", duplicates };
    }
    await updateClient(db, id, data, user.id);
    refresh(id);
    return { ok: true, id, message: "Client updated." };
  });
}

export async function setClientArchivedAction(id: string, archived: boolean): Promise<ActionResult> {
  return runAction("sales.manage", async (user) => {
    if (archived) await archiveClient(db, id, user.id);
    else await restoreClient(db, id, user.id);
    refresh(id);
    return { ok: true, message: archived ? "Client archived." : "Client restored." };
  });
}

export async function saveContactAction(clientId: string, contactId: string | null, input: ContactInput): Promise<ActionResult> {
  return runAction("sales.manage", async (user) => {
    const parsed = contactSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await saveContact(db, clientId, contactId ?? undefined, parsed.data, user.id);
    refresh(clientId);
    return { ok: true, message: contactId ? "Contact updated." : "Contact added." };
  });
}

export async function archiveContactAction(clientId: string, contactId: string): Promise<ActionResult> {
  return runAction("sales.manage", async (user) => {
    await archiveContact(db, clientId, contactId, user.id);
    refresh(clientId);
    return { ok: true, message: "Contact removed." };
  });
}
