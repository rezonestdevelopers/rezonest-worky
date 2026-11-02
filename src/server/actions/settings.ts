"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertPermission, ForbiddenError } from "@/lib/auth-guard";
import { settingsSchema, type SettingsInput } from "@/lib/validators/settings";
import { putFile, sniffImage } from "@/lib/storage";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

export async function saveSettingsAction(input: SettingsInput): Promise<ActionResult> {
  try {
    const user = await assertPermission("settings.manage");
    const parsed = settingsSchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
      return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
    }
    const data = parsed.data;
    const before = await db.settings.findUniqueOrThrow({ where: { id: "agency" } });

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [k, v] of Object.entries(data)) {
      const old = (before as Record<string, unknown>)[k];
      const oldNorm = old !== null && typeof old === "object" && "toString" in old && !Array.isArray(old) ? Number(old.toString()) : old;
      if (JSON.stringify(oldNorm) !== JSON.stringify(v)) changes[k] = { from: oldNorm, to: v };
    }
    if (Object.keys(changes).length === 0) return { ok: true, message: "No changes to save." };

    await db.$transaction([
      db.settings.update({ where: { id: "agency" }, data }),
      db.activityLog.create({ data: { actorId: user.id, action: "settings.updated", entityType: "Settings", entityId: "agency", changes: changes as object } }),
    ]);
    revalidatePath("/", "layout");
    return { ok: true, message: `Saved ${Object.keys(changes).length} change${Object.keys(changes).length === 1 ? "" : "s"}.` };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Could not save settings. Please try again." };
  }
}

const MAX_BYTES = 2 * 1024 * 1024;

export async function uploadBrandAssetAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await assertPermission("settings.manage");
    const kind = z.enum(["logo", "signature"]).parse(formData.get("kind"));
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Please choose an image file." };
    if (file.size > MAX_BYTES) return { ok: false, error: "Image must be 2 MB or smaller." };
    const buf = Buffer.from(await file.arrayBuffer());
    const ext = sniffImage(buf);
    if (!ext) return { ok: false, error: "Only PNG, JPG or WebP images are allowed." };

    // logo is public (shown on public offer pages); signature stays private
    const key = `${kind === "logo" ? "public" : "private"}/brand/${kind}-${Date.now()}.${ext}`;
    await putFile(key, buf, ext === "jpg" ? "image/jpeg" : `image/${ext}`);
    const field = kind === "logo" ? "logoKey" : "signatureKey";
    await db.$transaction([
      db.settings.update({ where: { id: "agency" }, data: { [field]: key } }),
      db.activityLog.create({ data: { actorId: user.id, action: `settings.${kind}_uploaded`, entityType: "Settings", entityId: "agency", changes: { [field]: key } } }),
    ]);
    revalidatePath("/settings");
    return { ok: true, message: kind === "logo" ? "Logo uploaded." : "Signature uploaded." };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Upload failed. Please try again." };
  }
}
