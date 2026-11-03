"use server";

import { revalidatePath } from "next/cache";
import { invalid, type ActionResult } from "@/lib/action-result";
import { db } from "@/lib/db";
import {
  masterItemSchema,
  serviceSchema,
  subServicesSchema,
  taskTemplateSchema,
  type MasterItemInput,
  type ServiceInput,
  type SubServicesInput,
  type TaskTemplateInput,
} from "@/lib/validators/catalogue";
import { runAction } from "@/server/action-guard";
import { saveMasterItem, saveService, saveSubServices, saveTaskTemplate } from "@/server/services/catalogue";

export async function saveServiceAction(id: string | null, input: ServiceInput): Promise<ActionResult> {
  return runAction("settings.manage", async (user) => {
    const parsed = serviceSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const service = await saveService(db, id ?? undefined, parsed.data, user.id);
    revalidatePath("/settings/services");
    revalidatePath(`/settings/services/${service.id}`);
    return { ok: true, id: service.id, message: id ? "Service saved." : "Service created." };
  });
}

export async function saveSubServicesAction(input: SubServicesInput): Promise<ActionResult> {
  return runAction("settings.manage", async (user) => {
    const parsed = subServicesSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the sub-services." };
    await saveSubServices(db, parsed.data, user.id);
    revalidatePath(`/settings/services/${parsed.data.serviceId}`);
    return { ok: true, message: "Sub-services saved." };
  });
}

export async function saveTaskTemplateAction(input: TaskTemplateInput): Promise<ActionResult> {
  return runAction("settings.manage", async (user) => {
    const parsed = taskTemplateSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the template." };
    const template = await saveTaskTemplate(db, parsed.data, user.id);
    revalidatePath(`/settings/services/${parsed.data.serviceId}`);
    return { ok: true, id: template.id, message: "Template saved." };
  });
}

export async function saveMasterItemAction(input: MasterItemInput): Promise<ActionResult> {
  return runAction("settings.manage", async (user) => {
    const parsed = masterItemSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const item = await saveMasterItem(db, parsed.data, user.id);
    revalidatePath("/settings/lists");
    return { ok: true, id: item.id, message: "Saved." };
  });
}
