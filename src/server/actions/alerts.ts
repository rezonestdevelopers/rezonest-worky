"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission, ForbiddenError } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { restoreSnoozed, setReminderState } from "@/server/services/reminders";
import { BusinessError } from "@/server/services/shared";
import { loadViewer } from "@/server/services/tasks";

const REMINDER_TYPES = [
  "TASK_DUE_TODAY", "TASK_DUE_SOON", "TASK_OVERDUE", "WAITING_APPROVAL", "MILESTONE_DUE", "PROJECT_DEADLINE", "ONBOARDING_PENDING", "LEAD_FOLLOW_UP", "OFFER_FOLLOW_UP",
  "OFFER_EXPIRING", "INVOICE_DUE", "PAYMENT_OVERDUE", "RENEWAL_DUE", "RETAINER_ENDING", "AD_BUDGET_ALERT", "DELIVERY_SHORTFALL", "COMMUNICATION_NEXT_ACTION",
] as const;

const schema = z.object({
  key: z.string().min(3).max(300),
  type: z.enum(REMINDER_TYPES),
  title: z.string().max(300),
  entityType: z.string().max(40),
  entityId: z.string().max(60),
  href: z.string().max(300).optional(),
  action: z.enum(["snooze", "done", "reopen"]),
  days: z.number().int().min(1).max(90).optional(),
});

export type AlertActionInput = z.input<typeof schema>;

function refresh() {
  revalidatePath("/dashboard");
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
}

/** Snooze (1 day, 3 days or custom), mark done, or reopen. */
export async function updateAlertAction(input: AlertActionInput): Promise<{ ok: boolean; error?: string }> {
  try {
    const user = await assertPermission("work.own");
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid request." };
    await setReminderState(db, parsed.data, await loadViewer(db, user));
    refresh();
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError || e instanceof BusinessError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Could not update the reminder. Please try again." };
  }
}

/** Brings back snoozed reminders, for anything snoozed by mistake. */
export async function restoreSnoozedAction(): Promise<{ ok: boolean }> {
  const user = await assertPermission("work.own");
  await restoreSnoozed(db, await loadViewer(db, user));
  refresh();
  return { ok: true };
}
