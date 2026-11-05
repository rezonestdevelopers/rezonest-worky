"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { formatMonthKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { renderTemplate } from "@/lib/email-templates";
import { sendMail } from "@/lib/mailer";
import { renderReportPdf } from "@/lib/pdf/report-pdf";
import { optionalText } from "@/lib/validators/common";
import { runAction } from "@/server/action-guard";
import { runBackupJob } from "@/server/backup-job";
import { agencyLetterhead } from "@/server/report-loader";
import { getTemplate } from "@/server/services/email-templates";
import { clientMonthlyDoc, saveReportNote } from "@/server/services/reports";
import { logActivity } from "@/server/services/shared";

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose a month");
const noteSchema = z.object({ clientId: z.string().min(1).max(60), month, highlights: optionalText(5000), nextPlan: optionalText(5000) });

export async function saveReportNoteAction(input: z.input<typeof noteSchema>): Promise<ActionResult> {
  return runAction("reports.monthly", async (user) => {
    const parsed = noteSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
    await saveReportNote(db, parsed.data, user.id);
    revalidatePath("/reports/monthly");
    return { ok: true, message: "Saved. It's in the report below." };
  });
}

const emailSchema = z.object({ clientId: z.string().min(1).max(60), month, to: z.string().trim().toLowerCase().email("Enter a valid email address") });

export async function emailMonthlyReportAction(input: z.input<typeof emailSchema>): Promise<ActionResult> {
  return runAction("reports.monthly", async (user) => {
    const parsed = emailSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
    const { clientId, month: m, to } = parsed.data;
    const [doc, letterhead, client] = await Promise.all([
      clientMonthlyDoc(db, { clientId, month: m }),
      agencyLetterhead(),
      db.client.findUniqueOrThrow({ where: { id: clientId }, select: { companyName: true, contacts: { where: { isPrimary: true, archivedAt: null }, take: 1, select: { name: true } } } }),
    ]);
    const message = renderTemplate(await getTemplate(db, "monthly_report"), { contactName: client.contacts[0]?.name ?? client.companyName, clientName: client.companyName, month: formatMonthKey(m), agencyName: letterhead.name });
    const pdf = await renderReportPdf(doc, letterhead);
    const mail = await sendMail({ to, subject: message.subject, text: message.text, templateKey: "monthly_report", entityType: "Client", entityId: clientId, attachments: [{ filename: `${doc.fileName}.pdf`, content: pdf, contentType: "application/pdf" }] });
    if (!mail.ok) return { ok: false, error: `The email could not be sent. ${mail.error ?? ""}`.trim() };
    await logActivity(db, { actorId: user.id, action: "report.emailed", entityType: "Client", entityId: clientId, clientId, changes: { month: m, to } });
    return { ok: true, message: `Sent to ${to}.` };
  });
}

export async function backupNowAction(): Promise<ActionResult> {
  return runAction("settings.manage", async (user) => {
    const result = await runBackupJob();
    revalidatePath("/settings/backups");
    if (result.status === "failed") return { ok: false, error: `The backup failed. ${result.error}` };
    await logActivity(db, { actorId: user.id, action: "backup.run", entityType: "Data", entityId: "backup", changes: { status: result.status } });
    return { ok: true, message: result.status === "skipped" ? "Today's backup is already done." : "Backup done." };
  });
}
