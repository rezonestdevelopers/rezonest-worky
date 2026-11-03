import "server-only";
import type { Prisma, Priority, TaskStatus } from "@prisma/client";
import { addDaysKey, dateOnlyKey, keyToDate, monthRange, todayKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { idParam, param, parseListParams, type SearchParams } from "@/lib/list-params";
import { TASK_STATUSES } from "@/lib/work-plan";
import { taskScope, type Viewer } from "@/server/services/tasks";

const SORTS = ["dueDate", "title", "status", "priority", "createdAt"] as const;
const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];

export function buildTaskWhere(sp: SearchParams, viewer: Viewer, q: string): Prisma.TaskWhereInput {
  const status = TASK_STATUSES.find((s) => s === param(sp, "status")) as TaskStatus | undefined;
  const priority = PRIORITIES.find((p) => p === param(sp, "priority"));
  const today = keyToDate(todayKey());
  const due = param(sp, "due");
  const contains = { contains: q, mode: "insensitive" as const };
  const notDone = { not: "DONE" as const };
  return {
    AND: [
      taskScope(viewer),
      { archivedAt: param(sp, "show") === "archived" ? { not: null } : null },
      status ? { status } : {},
      priority ? { priority } : {},
      idParam(sp, "assignee") ? { assigneeId: idParam(sp, "assignee") } : {},
      idParam(sp, "dept") ? { departmentId: idParam(sp, "dept") } : {},
      idParam(sp, "project") ? { projectId: idParam(sp, "project") } : {},
      idParam(sp, "client") ? { clientId: idParam(sp, "client") } : {},
      param(sp, "mine") === "1" ? { assigneeId: viewer.id } : {},
      param(sp, "open") === "1" ? { status: notDone } : {},
      due === "overdue" ? { status: notDone, dueDate: { lt: today } } : {},
      due === "today" ? { status: notDone, dueDate: today } : {},
      due === "soon" ? { status: notDone, dueDate: { gte: today, lte: keyToDate(addDaysKey(todayKey(), 3)) } } : {},
      due === "week" ? { status: notDone, dueDate: { gte: today, lte: keyToDate(addDaysKey(todayKey(), 7)) } } : {},
      q ? { OR: [{ title: contains }, { client: { companyName: contains } }, { project: { name: contains } }] } : {},
    ],
  };
}

function orderBy(sort: (typeof SORTS)[number], dir: "asc" | "desc"): Prisma.TaskOrderByWithRelationInput[] {
  const tie = { id: "asc" as const };
  return sort === "dueDate" ? [{ dueDate: { sort: dir, nulls: "last" } }, tie] : [{ [sort]: dir }, tie];
}

const listSelect = {
  id: true, title: true, status: true, priority: true, dueDate: true, revisionCount: true, blockedReason: true,
  assignee: { select: { name: true } },
  department: { select: { name: true } },
  client: { select: { companyName: true } },
  project: { select: { id: true, name: true } },
} satisfies Prisma.TaskSelect;

function toRow(t: Prisma.TaskGetPayload<{ select: typeof listSelect }>) {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    dueDate: t.dueDate ? dateOnlyKey(t.dueDate) : null,
    assignee: t.assignee?.name ?? null,
    department: t.department?.name ?? null,
    client: t.client?.companyName ?? null,
    project: t.project?.name ?? null,
    projectId: t.project?.id ?? null,
    blockedReason: t.blockedReason,
  };
}
export type TaskRow = ReturnType<typeof toRow>;

const DEFAULT_LIST = { sorts: SORTS, defaultSort: "dueDate", defaultDir: "asc" } as const;

/** The list opens on work still to do. Finished tasks appear with "All tasks" or when you filter by status. */
function listWhere(sp: SearchParams, viewer: Viewer, q: string): Prisma.TaskWhereInput {
  const where = buildTaskWhere(sp, viewer, q);
  return param(sp, "show") || param(sp, "status") ? where : { AND: [where, { status: { not: "DONE" } }] };
}

export async function getTaskList(sp: SearchParams, viewer: Viewer) {
  const params = parseListParams(sp, DEFAULT_LIST);
  const where = listWhere(sp, viewer, params.q);
  const total = await db.task.count({ where });
  const page = Math.min(params.page, Math.max(1, Math.ceil(total / params.pageSize)));
  const rows = await db.task.findMany({ where, select: listSelect, orderBy: orderBy(params.sort, params.dir), skip: (page - 1) * params.pageSize, take: params.pageSize });
  return { rows: rows.map(toRow), total, ...params, page };
}

export async function getTasksForExport(sp: SearchParams, viewer: Viewer) {
  const params = parseListParams(sp, DEFAULT_LIST);
  const rows = await db.task.findMany({ where: listWhere(sp, viewer, params.q), select: listSelect, orderBy: orderBy(params.sort, params.dir), take: 20_000 });
  return rows.map(toRow);
}

/** The Kanban board: open tasks by due date, and tasks finished in the last two weeks. */
export async function getTaskBoard(sp: SearchParams, viewer: Viewer) {
  const params = parseListParams(sp, DEFAULT_LIST);
  const where = buildTaskWhere(sp, viewer, params.q);
  const recent = new Date(Date.now() - 14 * 86_400_000);
  const LIMIT = 300;
  const rows = await db.task.findMany({
    where: { AND: [where, { OR: [{ status: { not: "DONE" } }, { completedAt: { gte: recent } }] }] },
    select: listSelect,
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { id: "asc" }],
    take: LIMIT + 1,
  });
  return { rows: rows.slice(0, LIMIT).map(toRow), truncated: rows.length > LIMIT, limit: LIMIT };
}

export async function getTaskCalendar(sp: SearchParams, viewer: Viewer, monthKey: string) {
  const params = parseListParams(sp, DEFAULT_LIST);
  const { start, end } = monthRange(`${monthKey}-01`);
  const rows = await db.task.findMany({
    where: { AND: [buildTaskWhere(sp, viewer, params.q), { dueDate: { gte: keyToDate(start), lte: keyToDate(end) } }] },
    select: listSelect,
    orderBy: [{ dueDate: "asc" }, { id: "asc" }],
    take: 1000,
  });
  return rows.map(toRow);
}

export async function getTaskDetail(id: string, viewer: Viewer) {
  return db.task.findFirst({
    where: { id, ...taskScope(viewer) },
    include: {
      assignee: { select: { id: true, name: true } },
      department: { select: { name: true } },
      client: { select: { id: true, companyName: true } },
      project: { select: { id: true, name: true, code: true } },
      service: { select: { name: true } },
      milestone: { select: { name: true } },
      deliverable: true,
      checklist: { orderBy: { sortOrder: "asc" } },
      comments: { orderBy: { createdAt: "asc" }, include: { author: { select: { name: true } } } },
      timeLogs: { orderBy: { date: "desc" }, include: { user: { select: { name: true } } } },
      attachments: { where: { archivedAt: null }, orderBy: { createdAt: "desc" } },
    },
  });
}

/** Choices for the task form. People and projects that are inactive only appear if the task already uses them. */
export async function getTaskFormOptions(keep: { assigneeId?: string | null } = {}) {
  const [users, departments, projects, clients, services, milestones] = await Promise.all([
    db.user.findMany({ where: { OR: [{ isActive: true }, ...(keep.assigneeId ? [{ id: keep.assigneeId }] : [])] }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.department.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.project.findMany({ where: { archivedAt: null, status: { in: ["NOT_STARTED", "ACTIVE", "ON_HOLD"] } }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true } }),
    db.client.findMany({ where: { archivedAt: null }, orderBy: { companyName: "asc" }, select: { id: true, companyName: true } }),
    db.service.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.milestone.findMany({ where: { project: { archivedAt: null, status: { in: ["NOT_STARTED", "ACTIVE", "ON_HOLD"] } } }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, projectId: true } }),
  ]);
  return {
    users: users.map((u) => ({ value: u.id, label: u.name })),
    departments: departments.map((d) => ({ value: d.id, label: d.name })),
    projects: projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` })),
    clients: clients.map((c) => ({ value: c.id, label: c.companyName })),
    services: services.map((s) => ({ value: s.id, label: s.name })),
    milestones: milestones.map((m) => ({ value: m.id, label: m.name, projectId: m.projectId })),
  };
}
export type TaskFormOptions = Awaited<ReturnType<typeof getTaskFormOptions>>;
