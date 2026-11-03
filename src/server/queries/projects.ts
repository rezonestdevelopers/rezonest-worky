import "server-only";
import type { Prisma, ProjectStatus } from "@prisma/client";
import { addDaysKey, dateOnlyKey, keyToDate, monthKeyOf, todayKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { effectiveHealth } from "@/lib/health";
import { idParam, param, parseListParams, type SearchParams } from "@/lib/list-params";
import { onboardingPercent } from "@/lib/work-plan";
import { taskScope, type Viewer } from "@/server/services/tasks";

const SORTS = ["name", "code", "status", "startDate", "deadline", "progressPercent"] as const;
const STATUSES: ProjectStatus[] = ["NOT_STARTED", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"];

/** Employees see only projects they have tasks on, or their department does. */
export function projectScope(viewer: Viewer): Prisma.ProjectWhereInput {
  return viewer.role === "EMPLOYEE" ? { tasks: { some: { archivedAt: null, ...taskScope(viewer) } } } : {};
}

export function buildProjectWhere(sp: SearchParams, viewer: Viewer, q: string): Prisma.ProjectWhereInput {
  const status = STATUSES.find((s) => s === param(sp, "status"));
  const health = param(sp, "health");
  const contains = { contains: q, mode: "insensitive" as const };
  return {
    AND: [
      projectScope(viewer),
      { archivedAt: param(sp, "view") === "archived" ? { not: null } : null },
      status ? { status } : {},
      idParam(sp, "client") ? { clientId: idParam(sp, "client") } : {},
      idParam(sp, "manager") ? { managerId: idParam(sp, "manager") } : {},
      param(sp, "type") === "retainer" ? { isRetainer: true } : param(sp, "type") === "project" ? { isRetainer: false } : {},
      health === "ON_TRACK" || health === "AT_RISK" || health === "DELAYED"
        ? { OR: [{ healthOverride: health }, { healthOverride: null, healthAuto: health }] }
        : {},
      q ? { OR: [{ name: contains }, { code: contains }, { client: { companyName: contains } }] } : {},
    ],
  };
}

const listSelect = {
  id: true, code: true, name: true, status: true, isRetainer: true, startDate: true, deadline: true, retainerEnd: true, progressPercent: true, healthAuto: true, healthOverride: true,
  client: { select: { id: true, companyName: true } },
  manager: { select: { name: true } },
  _count: { select: { tasks: { where: { archivedAt: null, status: { not: "DONE" as const } } } } },
} satisfies Prisma.ProjectSelect;

function toRow(p: Prisma.ProjectGetPayload<{ select: typeof listSelect }>) {
  const ends = p.deadline ?? p.retainerEnd;
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    client: p.client.companyName,
    clientId: p.client.id,
    status: p.status,
    type: p.isRetainer ? "Retainer" : "Project",
    startDate: dateOnlyKey(p.startDate),
    deadline: ends ? dateOnlyKey(ends) : null,
    progress: p.progressPercent,
    health: effectiveHealth(p.healthAuto, p.healthOverride),
    manager: p.manager?.name ?? null,
    openTasks: p._count.tasks,
  };
}
export type ProjectRow = ReturnType<typeof toRow>;

function orderBy(sort: (typeof SORTS)[number], dir: "asc" | "desc"): Prisma.ProjectOrderByWithRelationInput[] {
  const tie = { id: "asc" as const };
  return sort === "deadline" ? [{ deadline: { sort: dir, nulls: "last" } }, tie] : [{ [sort]: dir }, tie];
}

const LIST = { sorts: SORTS, defaultSort: "startDate", defaultDir: "desc" } as const;

export async function getProjectList(sp: SearchParams, viewer: Viewer) {
  const params = parseListParams(sp, LIST);
  const where = buildProjectWhere(sp, viewer, params.q);
  const total = await db.project.count({ where });
  const page = Math.min(params.page, Math.max(1, Math.ceil(total / params.pageSize)));
  const rows = await db.project.findMany({ where, select: listSelect, orderBy: orderBy(params.sort, params.dir), skip: (page - 1) * params.pageSize, take: params.pageSize });
  return { rows: rows.map(toRow), total, ...params, page };
}

export async function getProjectsForExport(sp: SearchParams, viewer: Viewer) {
  const params = parseListParams(sp, LIST);
  const rows = await db.project.findMany({ where: buildProjectWhere(sp, viewer, params.q), select: listSelect, orderBy: orderBy(params.sort, params.dir), take: 20_000 });
  return rows.map(toRow);
}

export function getProjectHeader(id: string, viewer: Viewer) {
  return db.project.findFirst({
    where: { id, ...projectScope(viewer) },
    include: {
      client: { select: { id: true, companyName: true } },
      manager: { select: { name: true } },
      offer: { select: { id: true, number: true } },
      services: { where: { isActive: true }, include: { service: { select: { name: true } } } },
      onboarding: { include: { items: { orderBy: { sortOrder: "asc" } } } },
    },
  });
}

export async function getProjectOverview(projectId: string, viewer: Viewer) {
  const today = keyToDate(todayKey());
  const scope = { projectId, archivedAt: null, ...taskScope(viewer) };
  const [open, overdue, done, week] = await Promise.all([
    db.task.count({ where: { ...scope, status: { not: "DONE" } } }),
    db.task.count({ where: { ...scope, status: { notIn: ["DONE", "WAITING_CLIENT_APPROVAL"] }, dueDate: { lt: today } } }),
    db.task.count({ where: { ...scope, status: "DONE" } }),
    db.task.count({ where: { ...scope, status: { not: "DONE" }, dueDate: { gte: today, lte: keyToDate(addDaysKey(todayKey(), 7)) } } }),
  ]);
  return { open, overdue, done, week };
}

export const getProjectMilestones = (projectId: string) =>
  db.milestone.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" }, include: { _count: { select: { tasks: { where: { archivedAt: null, status: { not: "DONE" } } } } } } });

export const getProjectTargets = (projectId: string) =>
  db.target.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" }, include: { progress: { orderBy: { month: "desc" }, take: 6 } } });

export const getProjectChangeRequests = (projectId: string) =>
  db.changeRequest.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, include: { deliverable: { select: { title: true } } } });

/** Committed vs delivered for each month: the "8/12 posts, 5/8 reels" summary. */
export async function getProjectDeliverables(projectId: string) {
  const rows = await db.deliverable.findMany({
    where: { projectId },
    orderBy: [{ month: "desc" }, { dueDate: "asc" }],
    select: { id: true, title: true, month: true, format: true, dueDate: true, deliveredAt: true, revisionsIncluded: true, revisionsUsed: true },
    take: 400,
  });
  const months = new Map<string, { month: string; committed: number; delivered: number; byFormat: Map<string, { committed: number; delivered: number }> }>();
  for (const d of rows) {
    const key = d.month ?? "One-off";
    const m = months.get(key) ?? { month: key, committed: 0, delivered: 0, byFormat: new Map() };
    m.committed++;
    if (d.deliveredAt) m.delivered++;
    const f = d.format ?? "OTHER";
    const counts = m.byFormat.get(f) ?? { committed: 0, delivered: 0 };
    counts.committed++;
    if (d.deliveredAt) counts.delivered++;
    m.byFormat.set(f, counts);
    months.set(key, m);
  }
  return { rows, months: Array.from(months.values()) };
}

export function onboardingSummary(items: { isDone: boolean }[]) {
  const done = items.filter((i) => i.isDone).length;
  return { done, total: items.length, percent: onboardingPercent(done, items.length) };
}

/** The current month is the one the "create this month" button offers. */
export const currentMonth = () => monthKeyOf(todayKey());

export async function getRetainerRuns(projectId: string) {
  return db.retainerRun.findMany({ where: { projectId }, orderBy: { month: "desc" }, select: { month: true } });
}

/** Team members and how busy they are. */
export async function getTeamList(sp: SearchParams) {
  const showInactive = param(sp, "show") === "inactive";
  const q = (param(sp, "q") ?? "").trim();
  const today = keyToDate(todayKey());
  const users = await db.user.findMany({
    where: {
      isActive: !showInactive,
      ...(idParam(sp, "dept") ? { employee: { departmentId: idParam(sp, "dept") } } : {}),
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {}),
    },
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, email: true, role: true, isActive: true, lastLoginAt: true,
      employee: { select: { designation: true, department: { select: { name: true } } } },
    },
  });
  const ids = users.map((u) => u.id);
  const [open, overdue] = await Promise.all([
    db.task.groupBy({ by: ["assigneeId"], where: { assigneeId: { in: ids }, archivedAt: null, status: { not: "DONE" } }, _count: true }),
    db.task.groupBy({ by: ["assigneeId"], where: { assigneeId: { in: ids }, archivedAt: null, status: { notIn: ["DONE", "WAITING_CLIENT_APPROVAL"] }, dueDate: { lt: today } }, _count: true }),
  ]);
  const count = (list: { assigneeId: string | null; _count: number }[], id: string) => list.find((x) => x.assigneeId === id)?._count ?? 0;
  return users.map((u) => ({ ...u, open: count(open, u.id), overdue: count(overdue, u.id) }));
}
