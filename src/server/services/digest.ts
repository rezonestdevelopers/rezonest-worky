import { categoryOfType, digestDue, digestSections, digestSummary, digestText, type DigestAlert } from "@/lib/alerts";
import { formatDateKey, istDateKey, istTime } from "@/lib/dates";
import { renderTemplate } from "@/lib/email-templates";
import { getTemplate } from "./email-templates";
import type { Db } from "./shared";

export type Mailer = (mail: { to: string; subject: string; text: string; templateKey?: string; entityType?: string; entityId?: string }) => Promise<{ ok: boolean; error?: string }>;

const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";

const toDigest = (r: { type: string; severity: string; title: string; detail: string | null }): DigestAlert => ({ category: categoryOfType(r.type), severity: r.severity, title: r.title, detail: r.detail });

/** The admin's digest: everything open. Snoozed and done reminders stay out. */
async function adminMessage(db: Db, user: { name: string }, dateKey: string, agencyName: string) {
  const open = await db.reminder.findMany({ where: { status: "OPEN" }, select: { type: true, severity: true, title: true, detail: true } });
  const alerts = open.map(toDigest);
  const sections = digestText(digestSections(alerts));
  return renderTemplate(await getTemplate(db, "daily_digest"), {
    name: user.name,
    date: formatDateKey(dateKey),
    summary: digestSummary(alerts),
    sections: sections || "Nothing needs your attention today.",
    link: `${appUrl()}/notifications`,
    agencyName,
  });
}

/** A team member's digest: only their own tasks. Nothing due means no email. */
async function employeeMessage(db: Db, user: { id: string; name: string }, dateKey: string, agencyName: string) {
  const open = await db.reminder.findMany({
    where: { status: "OPEN", assigneeId: user.id, type: { in: ["TASK_OVERDUE", "TASK_DUE_TODAY", "TASK_DUE_SOON", "WAITING_APPROVAL"] } },
    select: { type: true, severity: true, title: true, detail: true },
  });
  if (!open.length) return null;
  const alerts = open.map(toDigest);
  const count = (type: string) => open.filter((r) => r.type === type).length;
  const summary = [
    count("TASK_OVERDUE") && `${count("TASK_OVERDUE")} overdue`,
    count("TASK_DUE_TODAY") && `${count("TASK_DUE_TODAY")} due today`,
    count("TASK_DUE_SOON") && `${count("TASK_DUE_SOON")} due soon`,
  ].filter(Boolean).join(", ") || `${open.length} waiting`;
  return renderTemplate(await getTemplate(db, "employee_digest"), {
    name: user.name,
    date: formatDateKey(dateKey),
    summary,
    sections: digestText(digestSections(alerts)),
    link: `${appUrl()}/tasks?mine=1`,
    agencyName,
  });
}

/**
 * Sends today's digests once the digest time has come. Each person gets one per day however many times
 * this runs, because the claim is made first and the database allows only one. A failed send gives the
 * claim back, so the next run tries again.
 */
export async function runDigests(db: Db, send: Mailer, now = new Date()) {
  const settings = await db.settings.findUnique({ where: { id: "agency" } });
  if (!settings?.digestEnabled) return { sent: 0, failed: 0, skipped: "off" };
  if (!digestDue(istTime(now), settings.digestTime)) return { sent: 0, failed: 0, skipped: "not yet" };
  const date = istDateKey(now);

  const people = await db.user.findMany({
    where: { isActive: true, OR: [{ role: "ADMIN" }, { employee: { dailyDigest: true } }] },
    select: { id: true, name: true, email: true, role: true },
  });
  let sent = 0;
  let failed = 0;
  for (const person of people) {
    const { count } = await db.digestRun.createMany({ data: [{ date, userId: person.id }], skipDuplicates: true });
    if (!count) continue;
    const message = person.role === "ADMIN" ? await adminMessage(db, person, date, settings.agencyName) : await employeeMessage(db, person, date, settings.agencyName);
    if (!message) continue;
    const result = await send({ to: person.email, subject: message.subject, text: message.text, templateKey: person.role === "ADMIN" ? "daily_digest" : "employee_digest", entityType: "User", entityId: person.id }).catch((e: unknown) => ({ ok: false, error: String(e) }));
    if (result.ok) sent++;
    else {
      failed++;
      await db.digestRun.deleteMany({ where: { date, userId: person.id } });
    }
  }
  return { sent, failed, skipped: null };
}

/** Today's digest on request, to check how it reads. Doesn't count as the day's digest. */
export async function sendDigestNow(db: Db, send: Mailer, user: { id: string; name: string; email: string }, now = new Date()) {
  const settings = await db.settings.findUnique({ where: { id: "agency" } });
  const message = await adminMessage(db, user, istDateKey(now), settings?.agencyName ?? "Rezonest");
  return send({ to: user.email, subject: message.subject, text: message.text, templateKey: "daily_digest", entityType: "User", entityId: user.id });
}

/**
 * Emails for task notifications, for people who've asked for them. Each is marked before sending, so two
 * runs can't both send it. Older ones are left alone, so turning the option on doesn't send a backlog.
 */
export async function sendNotificationEmails(db: Db, send: Mailer, now = new Date()) {
  const waiting = await db.notification.findMany({
    where: { wantsEmail: true, emailedAt: null, createdAt: { gte: new Date(now.getTime() - 86_400_000) }, user: { isActive: true } },
    include: { user: { select: { name: true, email: true } } },
    take: 200,
  });
  if (!waiting.length) return { sent: 0 };
  const settings = await db.settings.findUnique({ where: { id: "agency" }, select: { agencyName: true } });
  const template = await getTemplate(db, "task_notification");
  let sent = 0;
  for (const n of waiting) {
    const { count } = await db.notification.updateMany({ where: { id: n.id, emailedAt: null }, data: { emailedAt: now } });
    if (!count) continue;
    const message = renderTemplate(template, { name: n.user.name, title: n.title, details: n.body ?? "", link: `${appUrl()}${n.href ?? "/notifications"}`, agencyName: settings?.agencyName ?? "Rezonest" });
    const result = await send({ to: n.user.email, subject: message.subject, text: message.text, templateKey: "task_notification", entityType: "Notification", entityId: n.id }).catch(() => ({ ok: false }));
    if (result.ok) sent++;
  }
  return { sent };
}
