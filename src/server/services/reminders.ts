import type { Prisma, ReminderStatus, ReminderType } from "@prisma/client";
import { MONEY_TYPES, nextReminderState } from "@/lib/alerts";
import { keyToDate, todayKey } from "@/lib/dates";
import { collectAlerts, wholeAgency, type AlertSettings } from "./alert-rules";
import { BusinessError, logActivity, type Db } from "./shared";
import type { Viewer } from "./tasks";

export const settingsForAlerts = (s: AlertSettings | null): AlertSettings => ({
  approvalWaitDays: s?.approvalWaitDays ?? 2,
  adBudgetAlertPercent: s?.adBudgetAlertPercent ?? 85,
  retainerEndingDays: s?.retainerEndingDays ?? 30,
  shortfallDaysLeft: s?.shortfallDaysLeft ?? 5,
  renewalAlertDays: s?.renewalAlertDays ?? [30, 15, 7, 1],
  dueSoonDays: s?.dueSoonDays ?? 3,
});

/**
 * The reminder job. Brings the stored reminders in line with what's true right now, and running it any
 * number of times gives the same result: each situation has one row, found by its dedupe key.
 */
export async function syncReminders(db: Db, today = todayKey(), now = new Date()) {
  const settings = await db.settings.findUnique({ where: { id: "agency" } });
  const alerts = await collectAlerts(db, wholeAgency(today), { money: true, includeDueSoon: true, settings: settingsForAlerts(settings) });
  const current = new Map(alerts.map((a) => [a.key, a]));
  const existing = await db.reminder.findMany({ where: { OR: [{ dedupeKey: { in: [...current.keys()] } }, { status: { in: ["OPEN", "SNOOZED"] } }] } });
  const known = new Set(existing.map((r) => r.dedupeKey));

  const fresh = alerts.filter((a) => !known.has(a.key));
  const { count: created } = await db.reminder.createMany({
    data: fresh.map((a) => ({
      dedupeKey: a.key, type: a.type, severity: a.severity, title: a.title, detail: a.detail, href: a.href, entityType: a.entityType, entityId: a.entityId,
      assigneeId: a.assigneeId ?? null, dueDate: a.dateKey ? keyToDate(a.dateKey) : null,
    })),
    skipDuplicates: true,
  });

  let updated = 0;
  let closed = 0;
  for (const row of existing) {
    const alert = current.get(row.dedupeKey);
    const status = nextReminderState(row, !!alert, now);
    const assigneeId = alert ? (alert.assigneeId ?? null) : row.assigneeId;
    const changed = status !== row.status || (alert && (alert.title !== row.title || alert.detail !== row.detail || alert.severity !== row.severity || assigneeId !== row.assigneeId));
    if (!changed) continue;
    // Only if no one has changed it since it was read, so a Done pressed at this moment isn't undone.
    await db.reminder.updateMany({
      where: { id: row.id, status: row.status },
      data: {
        status,
        snoozedUntil: status === "SNOOZED" ? row.snoozedUntil : null,
        resolvedAt: status === "DONE" ? (row.resolvedAt ?? now) : null,
        ...(alert ? { title: alert.title, detail: alert.detail, severity: alert.severity, href: alert.href, assigneeId, dueDate: alert.dateKey ? keyToDate(alert.dateKey) : null } : {}),
      },
    });
    if (status === "DONE" && row.status !== "DONE") closed++;
    else updated++;
  }
  return { current: alerts.length, created, updated, closed };
}

/** What a person can see: admins everything, managers everything but money, everyone else their own. */
export function reminderScope(viewer: Viewer): Prisma.ReminderWhereInput {
  if (viewer.role === "ADMIN") return {};
  if (viewer.role === "MANAGER") return { type: { notIn: MONEY_TYPES as ReminderType[] } };
  return { assigneeId: viewer.id };
}

async function assertMayAct(db: Db, viewer: Viewer, input: { type: string; entityType: string; entityId: string }, assigneeId: string | null | undefined) {
  if (viewer.role === "ADMIN") return;
  if (viewer.role === "MANAGER") {
    if (MONEY_TYPES.includes(input.type)) throw new BusinessError("This reminder isn't available.");
    return;
  }
  if (assigneeId === viewer.id) return;
  // Not stored yet: an employee can act only on a task of their own.
  const mine = input.entityType === "Task" && assigneeId === undefined && (await db.task.count({ where: { id: input.entityId, assigneeId: viewer.id } }));
  if (!mine) throw new BusinessError("This reminder isn't available.");
}

export type ReminderAction = { key: string; type: ReminderType; title: string; entityType: string; entityId: string; href?: string; action: "done" | "snooze" | "reopen"; days?: number };

/** Done, snooze (1 day, 3 days or custom) or reopen. The dashboard may act before the job has stored the reminder. */
export async function setReminderState(db: Db, input: ReminderAction, viewer: Viewer, now = new Date()) {
  const existing = await db.reminder.findUnique({ where: { dedupeKey: input.key } });
  await assertMayAct(db, viewer, input, existing ? existing.assigneeId : undefined);
  const status: ReminderStatus = input.action === "done" ? "DONE" : input.action === "snooze" ? "SNOOZED" : "OPEN";
  const fields = {
    status,
    snoozedUntil: input.action === "snooze" ? new Date(now.getTime() + (input.days ?? 1) * 86_400_000) : null,
    resolvedAt: input.action === "done" ? now : null,
    doneManually: input.action === "done",
  };
  await db.reminder.upsert({
    where: { dedupeKey: input.key },
    create: { dedupeKey: input.key, type: input.type, title: input.title, href: input.href, entityType: input.entityType, entityId: input.entityId, assigneeId: viewer.role === "EMPLOYEE" ? viewer.id : null, ...fields },
    update: fields,
  });
  await logActivity(db, { actorId: viewer.id, action: `reminder.${input.action}`, entityType: input.entityType, entityId: input.entityId, changes: { title: input.title, ...(input.days ? { days: input.days } : {}) } });
}

/** Brings back what this person may see, not everyone's. */
export async function restoreSnoozed(db: Db, viewer: Viewer) {
  const { count } = await db.reminder.updateMany({ where: { status: "SNOOZED", ...reminderScope(viewer) }, data: { status: "OPEN", snoozedUntil: null } });
  return count;
}

/** The bell's number: what needs attention, not the for-your-information ones. */
export async function reminderAttentionCount(db: Db, viewer: Viewer) {
  return db.reminder.count({ where: { status: "OPEN", severity: { not: "INFO" }, ...reminderScope(viewer) } });
}
