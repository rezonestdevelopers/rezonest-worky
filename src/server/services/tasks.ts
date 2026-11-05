import type { Prisma, TaskStatus } from "@prisma/client";
import { keyToDate } from "@/lib/dates";
import type { TaskData } from "@/lib/validators/work";
import { findMentions, revisionsExceeded, taskStatusError } from "@/lib/work-plan";
import { refreshProject } from "./projects";
import { BusinessError, diffChanges, logActivity, type Db, type Tx } from "./shared";

export type Viewer = { id: string; role: "ADMIN" | "MANAGER" | "EMPLOYEE"; departmentId: string | null };

/** What a person may see: everything for admins and managers; employees only their own or their department's tasks. */
export function taskScope(viewer: Viewer): Prisma.TaskWhereInput {
  if (viewer.role !== "EMPLOYEE") return {};
  return { OR: [{ assigneeId: viewer.id }, ...(viewer.departmentId ? [{ departmentId: viewer.departmentId }] : [])] };
}

export async function loadViewer(db: Db | Tx, user: { id: string; role: Viewer["role"] }): Promise<Viewer> {
  const profile = await db.employeeProfile.findUnique({ where: { userId: user.id }, select: { departmentId: true } });
  return { id: user.id, role: user.role, departmentId: profile?.departmentId ?? null };
}

async function visibleTask(tx: Db | Tx, taskId: string, viewer: Viewer) {
  const task = await tx.task.findFirst({ where: { id: taskId, archivedAt: null, ...taskScope(viewer) } });
  // The same message whether it doesn't exist or isn't theirs, so nothing is revealed.
  if (!task) throw new BusinessError("This task isn't available.");
  return task;
}

/** `email` marks it for sending too, to people who've chosen email for tasks. The email goes after the save succeeds. */
async function notify(tx: Tx, userIds: (string | null | undefined)[], actorId: string, input: { title: string; body?: string; href: string; email?: boolean }) {
  const targets = Array.from(new Set(userIds.filter((u): u is string => !!u && u !== actorId)));
  if (!targets.length) return;
  const { email, ...content } = input;
  const wanting = email ? await tx.employeeProfile.findMany({ where: { userId: { in: targets }, emailOnTask: true }, select: { userId: true } }) : [];
  await tx.notification.createMany({ data: targets.map((userId) => ({ userId, ...content, wantsEmail: wanting.some((w) => w.userId === userId) })) });
}

/** A deliverable is delivered once all of its tasks are done, and un-delivered if one reopens. */
async function syncDeliverable(tx: Tx, deliverableId: string | null) {
  if (!deliverableId) return;
  const open = await tx.task.count({ where: { deliverableId, archivedAt: null, status: { not: "DONE" } } });
  const deliverable = await tx.deliverable.findUnique({ where: { id: deliverableId } });
  if (!deliverable) return;
  if (open === 0 && !deliverable.deliveredAt) await tx.deliverable.update({ where: { id: deliverableId }, data: { deliveredAt: new Date() } });
  if (open > 0 && deliverable.deliveredAt) await tx.deliverable.update({ where: { id: deliverableId }, data: { deliveredAt: null } });
}

function columns(d: TaskData) {
  return {
    title: d.title,
    description: d.description,
    projectId: d.projectId,
    clientId: d.clientId,
    serviceId: d.serviceId,
    milestoneId: d.milestoneId,
    assigneeId: d.assigneeId,
    departmentId: d.departmentId,
    priority: d.priority,
    startDate: d.startDate ? keyToDate(d.startDate) : null,
    dueDate: d.dueDate ? keyToDate(d.dueDate) : null,
  };
}

async function withProjectClient(tx: Tx, d: TaskData): Promise<TaskData> {
  if (!d.projectId) return d;
  const project = await tx.project.findUnique({ where: { id: d.projectId } });
  if (!project || project.archivedAt) throw new BusinessError("That project no longer exists.");
  if (d.milestoneId) {
    const milestone = await tx.milestone.findFirst({ where: { id: d.milestoneId, projectId: project.id } });
    if (!milestone) throw new BusinessError("That milestone isn't part of the selected project.");
  }
  return { ...d, clientId: project.clientId };
}

async function assertAssignable(tx: Tx, userId: string | null) {
  if (!userId) return;
  const user = await tx.user.findUnique({ where: { id: userId } });
  if (!user?.isActive) throw new BusinessError("That person is inactive, so they can't be given tasks.");
}

export async function createTask(db: Db, input: TaskData, actorId: string) {
  return db.$transaction(async (tx) => {
    const data = await withProjectClient(tx, input);
    await assertAssignable(tx, data.assigneeId);
    const task = await tx.task.create({ data: { ...columns(data), createdById: actorId } });
    await notify(tx, [data.assigneeId], actorId, { title: "New task for you", body: task.title, href: `/tasks/${task.id}`, email: true });
    if (task.projectId) await refreshProject(tx, task.projectId);
    await logActivity(tx, { actorId, action: "task.created", entityType: "Task", entityId: task.id, clientId: task.clientId, changes: { title: task.title } });
    return task;
  });
}

const TASK_FIELDS = ["title", "description", "projectId", "clientId", "serviceId", "milestoneId", "assigneeId", "departmentId", "priority", "startDate", "dueDate"] as const;

export async function updateTask(db: Db, id: string, input: TaskData, actorId: string) {
  return db.$transaction(async (tx) => {
    const before = await tx.task.findUnique({ where: { id } });
    if (!before || before.archivedAt) throw new BusinessError("This task no longer exists.");
    const data = await withProjectClient(tx, input);
    if (data.assigneeId !== before.assigneeId) await assertAssignable(tx, data.assigneeId);
    const after = await tx.task.update({ where: { id }, data: columns(data) });
    if (data.assigneeId !== before.assigneeId) await notify(tx, [data.assigneeId], actorId, { title: "Task assigned to you", body: after.title, href: `/tasks/${id}`, email: true });
    for (const projectId of new Set([before.projectId, after.projectId])) if (projectId) await refreshProject(tx, projectId);
    const changes = diffChanges(before, after, TASK_FIELDS);
    if (Object.keys(changes).length) await logActivity(tx, { actorId, action: "task.updated", entityType: "Task", entityId: id, clientId: after.clientId, changes });
    return after;
  });
}

async function applyStatus(tx: Tx, task: Prisma.TaskGetPayload<object>, status: TaskStatus, blockedReason: string | null, actorId: string | null) {
  await tx.task.update({
    where: { id: task.id },
    data: {
      status,
      statusChangedAt: new Date(),
      completedAt: status === "DONE" ? (task.completedAt ?? new Date()) : null,
      blockedReason: status === "BLOCKED" ? blockedReason : null,
    },
  });
  await syncDeliverable(tx, task.deliverableId);
  if (task.projectId) await refreshProject(tx, task.projectId);
  await logActivity(tx, { actorId, action: "task.status_changed", entityType: "Task", entityId: task.id, clientId: task.clientId, changes: { status: { from: task.status, to: status }, ...(blockedReason ? { reason: blockedReason } : {}) } });
}

/** The client answered: approval steps finish, and work that was waiting on them goes back to the team. */
export async function applyClientDecision(tx: Tx, deliverableId: string, approved: boolean, actorId: string | null) {
  const tasks = await tx.task.findMany({ where: { deliverableId, archivedAt: null, status: { not: "DONE" } } });
  for (const t of tasks) {
    const waiting = t.status === "WAITING_CLIENT_APPROVAL";
    if (approved && (waiting || /client approval/i.test(t.title))) await applyStatus(tx, t, "DONE", null, actorId);
    else if (!approved && waiting) await applyStatus(tx, t, "IN_PROGRESS", null, actorId);
  }
}

/** It's been published, so whatever was still open on that deliverable is finished. Returns how many tasks were closed. */
export async function completeDeliverableTasks(tx: Tx, deliverableId: string, actorId: string | null): Promise<number> {
  const tasks = await tx.task.findMany({ where: { deliverableId, archivedAt: null, status: { not: "DONE" } } });
  for (const t of tasks) await applyStatus(tx, t, "DONE", null, actorId);
  return tasks.length;
}

export async function changeTaskStatus(db: Db, input: { taskId: string; status: TaskStatus; blockedReason?: string | null; viewer: Viewer }) {
  await db.$transaction(async (tx) => {
    const task = await visibleTask(tx, input.taskId, input.viewer);
    const problem = taskStatusError({ from: task.status, to: input.status, blockedReason: input.blockedReason });
    if (problem) throw new BusinessError(problem);
    await applyStatus(tx, task, input.status, input.blockedReason ?? null, input.viewer.id);
    if (input.status === "BLOCKED" || input.status === "DONE") {
      const project = task.projectId ? await tx.project.findUnique({ where: { id: task.projectId }, select: { managerId: true } }) : null;
      await notify(tx, [project?.managerId], input.viewer.id, { title: input.status === "BLOCKED" ? "A task is blocked" : "A task is done", body: task.title, href: `/tasks/${task.id}` });
    }
  });
}

/** Bulk reassign and bulk status. All-or-nothing, and each task keeps its own history. Blocked is excluded because each needs a reason. */
export async function bulkUpdateTasks(db: Db, input: { taskIds: string[]; assigneeId?: string; status?: TaskStatus }, actorId: string) {
  if (input.status === "BLOCKED") throw new BusinessError("Blocking needs a reason for each task, so please do that one at a time.");
  return db.$transaction(
    async (tx) => {
      const tasks = await tx.task.findMany({ where: { id: { in: input.taskIds }, archivedAt: null } });
      if (input.assigneeId !== undefined) await assertAssignable(tx, input.assigneeId || null);
      for (const task of tasks) {
        if (input.status && task.status !== input.status) await applyStatus(tx, task, input.status, null, actorId);
        if (input.assigneeId !== undefined && task.assigneeId !== (input.assigneeId || null)) {
          await tx.task.update({ where: { id: task.id }, data: { assigneeId: input.assigneeId || null } });
          await logActivity(tx, { actorId, action: "task.reassigned", entityType: "Task", entityId: task.id, clientId: task.clientId, changes: { assigneeId: { from: task.assigneeId, to: input.assigneeId || null } } });
        }
      }
      if (input.assigneeId) await notify(tx, [input.assigneeId], actorId, { title: `${tasks.length} task${tasks.length === 1 ? "" : "s"} assigned to you`, href: "/tasks?mine=1", email: true });
      return tasks.length;
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}

export async function addComment(db: Db, input: { taskId: string; body: string; viewer: Viewer }) {
  await db.$transaction(async (tx) => {
    const task = await visibleTask(tx, input.taskId, input.viewer);
    const users = await tx.user.findMany({ where: { isActive: true }, select: { id: true, name: true } });
    const mentions = findMentions(input.body, users);
    await tx.taskComment.create({ data: { taskId: task.id, authorId: input.viewer.id, body: input.body, mentions } });
    await notify(tx, mentions, input.viewer.id, { title: "You were mentioned on a task", body: input.body.slice(0, 200), href: `/tasks/${task.id}`, email: true });
    await notify(tx, [task.assigneeId].filter((a) => !mentions.includes(a ?? "")), input.viewer.id, { title: "New comment on your task", body: input.body.slice(0, 200), href: `/tasks/${task.id}` });
  });
}

export async function addChecklistItem(db: Db, input: { taskId: string; title: string; viewer: Viewer }) {
  await db.$transaction(async (tx) => {
    const task = await visibleTask(tx, input.taskId, input.viewer);
    await tx.taskChecklistItem.create({ data: { taskId: task.id, title: input.title, sortOrder: await tx.taskChecklistItem.count({ where: { taskId: task.id } }) } });
  });
}

export async function setChecklistItem(db: Db, input: { itemId: string; done: boolean; viewer: Viewer }) {
  await db.$transaction(async (tx) => {
    const item = await tx.taskChecklistItem.findUnique({ where: { id: input.itemId } });
    if (!item) throw new BusinessError("This item no longer exists.");
    await visibleTask(tx, item.taskId, input.viewer);
    await tx.taskChecklistItem.update({ where: { id: item.id }, data: { isDone: input.done } });
  });
}

export async function logTime(db: Db, input: { taskId: string; date: string; minutes: number; note: string | null; viewer: Viewer }) {
  await db.$transaction(async (tx) => {
    const task = await visibleTask(tx, input.taskId, input.viewer);
    await tx.timeLog.create({ data: { taskId: task.id, userId: input.viewer.id, date: keyToDate(input.date), minutes: input.minutes, note: input.note } });
    await logActivity(tx, { actorId: input.viewer.id, action: "task.time_logged", entityType: "Task", entityId: task.id, clientId: task.clientId, changes: { minutes: input.minutes, date: input.date } });
  });
}

/**
 * Counts a revision on the task and on its deliverable. Going past what's included tells the
 * caller, because that's when a change request is due. Nothing is charged automatically.
 */
export async function addRevision(db: Db, input: { taskId: string; viewer: Viewer }) {
  return db.$transaction(async (tx) => {
    const task = await visibleTask(tx, input.taskId, input.viewer);
    await tx.task.update({ where: { id: task.id }, data: { revisionCount: { increment: 1 } } });
    let exceeded = false;
    if (task.deliverableId) {
      const deliverable = await tx.deliverable.update({ where: { id: task.deliverableId }, data: { revisionsUsed: { increment: 1 } } });
      exceeded = revisionsExceeded(deliverable.revisionsUsed, deliverable.revisionsIncluded);
    }
    await logActivity(tx, { actorId: input.viewer.id, action: "task.revision_added", entityType: "Task", entityId: task.id, clientId: task.clientId, changes: { revisions: task.revisionCount + 1, exceeded } });
    return { exceeded, projectId: task.projectId };
  });
}

export async function setTaskArchived(db: Db, id: string, archived: boolean, actorId: string) {
  await db.$transaction(async (tx) => {
    const task = await tx.task.findUnique({ where: { id } });
    if (!task) throw new BusinessError("This task no longer exists.");
    await tx.task.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
    await syncDeliverable(tx, task.deliverableId);
    if (task.projectId) await refreshProject(tx, task.projectId);
    await logActivity(tx, { actorId, action: archived ? "task.archived" : "task.restored", entityType: "Task", entityId: id, clientId: task.clientId });
  });
}

export async function addTaskAttachment(db: Db, input: { taskId: string; name: string; storageKey: string; mimeType: string; sizeBytes: number; viewer: Viewer }) {
  await db.$transaction(async (tx) => {
    const task = await visibleTask(tx, input.taskId, input.viewer);
    await tx.document.create({
      data: { name: input.name, category: "CREATIVE", storageKey: input.storageKey, mimeType: input.mimeType, sizeBytes: input.sizeBytes, taskId: task.id, clientId: task.clientId, projectId: task.projectId, uploadedById: input.viewer.id },
    });
    await logActivity(tx, { actorId: input.viewer.id, action: "task.attachment_added", entityType: "Task", entityId: task.id, clientId: task.clientId, changes: { name: input.name } });
  });
}

export { visibleTask };
