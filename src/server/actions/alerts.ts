"use server";

import type { ReminderType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertPermission, ForbiddenError } from "@/lib/auth-guard";

const schema = z.object({
  key: z.string().min(3).max(300),
  type: z.string().max(40),
  title: z.string().max(300),
  entityType: z.string().max(40),
  entityId: z.string().max(40),
  href: z.string().max(300).optional(),
  action: z.enum(["snooze", "done"]),
  days: z.number().int().min(1).max(90).optional(),
});

export type AlertActionInput = z.infer<typeof schema>;

/** Snooze (1 / 3 / custom days) or mark an alert done. Stored in Reminder by dedupe key. */
export async function updateAlertAction(input: AlertActionInput): Promise<{ ok: boolean; error?: string }> {
  try {
    const user = await assertPermission("work.own");
    const data = schema.parse(input);
    const snoozedUntil = data.action === "snooze" ? new Date(Date.now() + (data.days ?? 1) * 86_400_000) : null;
    await db.reminder.upsert({
      where: { dedupeKey: data.key },
      create: {
        dedupeKey: data.key,
        type: data.type as ReminderType,
        title: data.title,
        href: data.href,
        entityType: data.entityType,
        entityId: data.entityId,
        assigneeId: user.role === "ADMIN" ? null : user.id,
        status: data.action === "done" ? "DONE" : "SNOOZED",
        snoozedUntil,
        resolvedAt: data.action === "done" ? new Date() : null,
      },
      update: {
        status: data.action === "done" ? "DONE" : "SNOOZED",
        snoozedUntil,
        resolvedAt: data.action === "done" ? new Date() : null,
      },
    });
    await db.activityLog.create({
      data: { actorId: user.id, action: `alert.${data.action}`, entityType: data.entityType, entityId: data.entityId, changes: { key: data.key, days: data.days ?? null } },
    });
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, error: e.message };
    if (e instanceof z.ZodError) return { ok: false, error: "Invalid request." };
    console.error(e);
    return { ok: false, error: "Could not update the alert. Please try again." };
  }
}

/** Bring back all snoozed alerts (handy if something was snoozed by mistake). */
export async function restoreSnoozedAction(): Promise<{ ok: boolean }> {
  await assertPermission("work.own");
  await db.reminder.updateMany({ where: { status: "SNOOZED" }, data: { status: "OPEN", snoozedUntil: null } });
  revalidatePath("/dashboard");
  return { ok: true };
}
