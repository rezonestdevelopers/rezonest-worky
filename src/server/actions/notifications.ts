"use server";

import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/auth-guard";
import { db } from "@/lib/db";

/** Marks the signed-in user's own notifications as read: one, or all of them. */
export async function markNotificationsReadAction(id?: string): Promise<void> {
  const user = await assertPermission("work.own");
  await db.notification.updateMany({ where: { userId: user.id, readAt: null, ...(id ? { id } : {}) }, data: { readAt: new Date() } });
  revalidatePath("/", "layout");
}
