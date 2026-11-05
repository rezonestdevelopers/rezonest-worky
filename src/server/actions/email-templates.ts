"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { renderTemplate, templateDefinition } from "@/lib/email-templates";
import { invalid, type ActionResult } from "@/lib/action-result";
import { db } from "@/lib/db";
import { sendMail } from "@/lib/mailer";
import { runAction } from "@/server/action-guard";
import { syncReminders } from "@/server/services/reminders";
import { sendDigestNow } from "@/server/services/digest";
import { getTemplate, resetTemplate, saveTemplate } from "@/server/services/email-templates";

const schema = z.object({
  key: z.string().min(1).max(60),
  subject: z.string().trim().min(2, "Enter a subject").max(200),
  body: z.string().trim().min(2, "Enter the message").max(10_000),
  whatsapp: z.string().trim().max(2000).optional().or(z.literal("")).transform((v) => v || null),
});
export type TemplateInput = z.input<typeof schema>;

export async function saveTemplateAction(input: TemplateInput): Promise<ActionResult> {
  return runAction("settings.manage", async (user) => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await saveTemplate(db, parsed.data, user.id);
    revalidatePath("/settings/emails");
    revalidatePath(`/settings/emails/${parsed.data.key}`);
    return { ok: true, message: "Template saved." };
  });
}

export async function resetTemplateAction(key: string): Promise<ActionResult> {
  return runAction("settings.manage", async (user) => {
    await resetTemplate(db, key, user.id);
    revalidatePath("/settings/emails");
    revalidatePath(`/settings/emails/${key}`);
    return { ok: true, message: "Back to the original text." };
  });
}

/** Sends the saved template to you, filled with the example values. */
export async function sendTestTemplateAction(key: string): Promise<ActionResult> {
  return runAction("settings.manage", async (user) => {
    const definition = templateDefinition(key);
    if (!definition) return { ok: false, error: "This template no longer exists." };
    const message = renderTemplate(await getTemplate(db, key), definition.placeholders);
    const sent = await sendMail({ to: user.email, subject: `[Test] ${message.subject}`, text: message.text, templateKey: key });
    return sent.ok ? { ok: true, message: `Test sent to ${user.email}.` } : { ok: false, error: `The email couldn't be sent. ${sent.error ?? ""}`.trim() };
  });
}

/** Today's digest, right now. It doesn't stop the regular one going out. */
export async function sendDigestNowAction(): Promise<ActionResult> {
  return runAction("settings.manage", async (user) => {
    await syncReminders(db);
    const sent = await sendDigestNow(db, sendMail, user);
    return sent.ok ? { ok: true, message: `Today's digest sent to ${user.email}.` } : { ok: false, error: `The email couldn't be sent. ${sent.error ?? ""}`.trim() };
  });
}
