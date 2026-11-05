"use server";

import { revalidatePath } from "next/cache";
import { invalid, type ActionResult } from "@/lib/action-result";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { changePasswordSchema, profileSchema, type ChangePasswordInput, type ProfileInput } from "@/lib/validators/account";
import { runAction } from "@/server/action-guard";
import { changePassword, updateMyProfile } from "@/server/services/account";

export async function changePasswordAction(input: ChangePasswordInput): Promise<ActionResult> {
  return runAction("work.own", async (user) => {
    if (!rateLimit(`change-password:${user.id}`, 10, 15 * 60_000).ok) return { ok: false, error: "Too many tries. Please wait a few minutes." };
    const parsed = changePasswordSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await changePassword(db, { userId: user.id, current: parsed.data.current, next: parsed.data.next });
    return { ok: true, message: "Password changed." };
  });
}

export async function updateMyProfileAction(input: ProfileInput): Promise<ActionResult> {
  return runAction("work.own", async (user) => {
    const parsed = profileSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await updateMyProfile(db, user.id, parsed.data);
    revalidatePath("/account");
    revalidatePath("/", "layout");
    return { ok: true, message: "Saved." };
  });
}
