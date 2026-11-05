import "server-only";
import type { Prisma, ReminderStatus, ReminderType, Severity } from "@prisma/client";
import { ALERT_CATEGORIES, categoryOfType, typesOfCategory } from "@/lib/alerts";
import { dateOnlyKey, formatDateTime } from "@/lib/dates";
import { db } from "@/lib/db";
import { param, parseListParams, type SearchParams } from "@/lib/list-params";
import { reminderScope } from "@/server/services/reminders";
import type { Viewer } from "@/server/services/tasks";

const SORTS = ["severity", "dueDate", "title", "createdAt"] as const;
const LIST = { sorts: SORTS, defaultSort: "severity", defaultDir: "desc" } as const;

function buildWhere(sp: SearchParams, viewer: Viewer, q: string): Prisma.ReminderWhereInput {
  const show = param(sp, "show");
  const status: ReminderStatus = show === "snoozed" ? "SNOOZED" : show === "done" ? "DONE" : "OPEN";
  const category = param(sp, "category");
  const severity = param(sp, "severity");
  const contains = { contains: q, mode: "insensitive" as const };
  return {
    AND: [
      reminderScope(viewer),
      { status },
      category && category in ALERT_CATEGORIES ? { type: { in: typesOfCategory(category) as ReminderType[] } } : {},
      severity === "CRITICAL" || severity === "WARNING" || severity === "INFO" ? { severity: severity as Severity } : {},
      q ? { OR: [{ title: contains }, { detail: contains }] } : {},
    ],
  };
}

function toRow(r: Prisma.ReminderGetPayload<object>) {
  return {
    id: r.id,
    key: r.dedupeKey,
    type: r.type as string,
    category: ALERT_CATEGORIES[categoryOfType(r.type)],
    severity: r.severity as string,
    title: r.title,
    detail: r.detail,
    href: r.href,
    entityType: r.entityType,
    entityId: r.entityId,
    status: r.status as string,
    dueDate: r.dueDate ? dateOnlyKey(r.dueDate) : null,
    snoozedUntil: r.snoozedUntil ? formatDateTime(r.snoozedUntil) : null,
    resolvedAt: r.resolvedAt ? formatDateTime(r.resolvedAt) : null,
    doneManually: r.doneManually,
  };
}
export type ReminderRow = ReturnType<typeof toRow>;

const order = (sort: (typeof SORTS)[number], dir: "asc" | "desc"): Prisma.ReminderOrderByWithRelationInput[] => [
  sort === "dueDate" ? { dueDate: { sort: dir, nulls: "last" } } : { [sort]: dir },
  { dueDate: { sort: "asc", nulls: "last" } },
  { id: "asc" },
];

export async function getReminderList(sp: SearchParams, viewer: Viewer) {
  const params = parseListParams(sp, LIST);
  const where = buildWhere(sp, viewer, params.q);
  const total = await db.reminder.count({ where });
  const page = Math.min(params.page, Math.max(1, Math.ceil(total / params.pageSize)));
  const rows = await db.reminder.findMany({ where, orderBy: order(params.sort, params.dir), skip: (page - 1) * params.pageSize, take: params.pageSize });
  return { rows: rows.map(toRow), total, ...params, page };
}

export async function getRemindersForExport(sp: SearchParams, viewer: Viewer) {
  const params = parseListParams(sp, LIST);
  const rows = await db.reminder.findMany({ where: buildWhere(sp, viewer, params.q), orderBy: order(params.sort, params.dir), take: 20_000 });
  return rows.map(toRow);
}

const INBOX = { sorts: ["createdAt"] as const, defaultSort: "createdAt", defaultDir: "desc" } as const;

/** The signed-in person's own notifications. */
export async function getNotificationList(sp: SearchParams, userId: string) {
  const params = parseListParams(sp, INBOX);
  const where: Prisma.NotificationWhereInput = { userId, ...(param(sp, "show") === "unread" ? { readAt: null } : {}), ...(params.q ? { OR: [{ title: { contains: params.q, mode: "insensitive" } }, { body: { contains: params.q, mode: "insensitive" } }] } : {}) };
  const [total, unread] = await Promise.all([db.notification.count({ where }), db.notification.count({ where: { userId, readAt: null } })]);
  const page = Math.min(params.page, Math.max(1, Math.ceil(total / params.pageSize)));
  const rows = await db.notification.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (page - 1) * params.pageSize, take: params.pageSize });
  return { rows: rows.map((n) => ({ id: n.id, title: n.title, body: n.body, href: n.href, read: !!n.readAt, when: formatDateTime(n.createdAt) })), total, unread, ...params, page };
}
export type NotificationRow = Awaited<ReturnType<typeof getNotificationList>>["rows"][number];
