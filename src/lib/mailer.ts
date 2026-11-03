import "server-only";
import nodemailer from "nodemailer";
import { db } from "@/lib/db";

/**
 * Sends email via SMTP (Google Workspace / Zoho). If SMTP_HOST is empty
 * (local development), the email is printed to the server console instead.
 * Every attempt is recorded in EmailLog.
 */
export async function sendMail(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  templateKey?: string;
  entityType?: string;
  entityId?: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
}): Promise<{ ok: boolean; error?: string }> {
  const host = process.env.SMTP_HOST;
  try {
    if (!host) {
      const files = opts.attachments?.length ? `\nAttachments: ${opts.attachments.map((a) => a.filename).join(", ")}` : "";
      console.log(`\n──── EMAIL (console mode) ────\nTo: ${opts.to}\nSubject: ${opts.subject}${files}\n\n${opts.text}\n──────────────────────────────\n`);
    } else {
      const transporter = nodemailer.createTransport({
        host,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: Number(process.env.SMTP_PORT) === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
      });
      await transporter.sendMail({ from: process.env.SMTP_FROM, to: opts.to, subject: opts.subject, text: opts.text, html: opts.html, attachments: opts.attachments });
    }
    await db.emailLog.create({
      data: { to: opts.to, subject: opts.subject, templateKey: opts.templateKey, entityType: opts.entityType, entityId: opts.entityId, status: "sent" },
    });
    return { ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await db.emailLog.create({
      data: { to: opts.to, subject: opts.subject, templateKey: opts.templateKey, entityType: opts.entityType, entityId: opts.entityId, status: "failed", error },
    });
    return { ok: false, error };
  }
}

/** Replace {{placeholders}} in a template. */
export function fillTemplate(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k: string) => values[k] ?? "");
}
