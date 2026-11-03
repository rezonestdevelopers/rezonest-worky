"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import type { TaskStatus } from "@prisma/client";
import { invalid, type ActionResult } from "@/lib/action-result";
import { db } from "@/lib/db";
import { fillTemplate, sendMail } from "@/lib/mailer";
import { putFile, sniffImage } from "@/lib/storage";
import {
  bulkTaskSchema,
  changeRequestSchema,
  checklistSchema,
  commentSchema,
  convertOfferSchema,
  employeeSchema,
  milestoneSchema,
  onboardingLinesSchema,
  projectSchema,
  targetProgressSchema,
  targetSchema,
  taskSchema,
  taskStatusSchema,
  timeLogSchema,
  type ChangeRequestInput,
  type ConvertOfferInput,
  type EmployeeInput,
  type MilestoneInput,
  type ProjectInput,
  type TargetInput,
  type TargetProgressInput,
  type TaskInput,
  type TimeLogInput,
} from "@/lib/validators/work";
import { runAction } from "@/server/action-guard";
import { addOnboardingItem, removeOnboardingItem, saveOnboardingTemplate, setOnboardingItemDone } from "@/server/services/onboarding";
import {
  convertOfferToProject,
  createChangeRequest,
  createRetainerMonthNow,
  decideChangeRequest,
  saveMilestone,
  saveTarget,
  saveTargetProgress,
  setProjectArchived,
  updateProject,
} from "@/server/services/projects";
import {
  addChecklistItem,
  addComment,
  addRevision,
  addTaskAttachment,
  bulkUpdateTasks,
  changeTaskStatus,
  createTask,
  loadViewer,
  logTime,
  setChecklistItem,
  setTaskArchived,
  updateTask,
} from "@/server/services/tasks";
import { createEmployee, deactivateEmployee, issuePasswordLink, reactivateEmployee, updateEmployee } from "@/server/services/team";

function refreshWork(projectId?: string | null, taskId?: string) {
  revalidatePath("/tasks");
  revalidatePath("/projects");
  revalidatePath("/dashboard");
  if (projectId) revalidatePath(`/projects/${projectId}`);
  if (taskId) revalidatePath(`/tasks/${taskId}`);
}

// ─── Projects ────────────────────────────────────────────────────────────────

export async function convertOfferAction(input: ConvertOfferInput): Promise<ActionResult> {
  return runAction("work.manage", async (user) => {
    const parsed = convertOfferSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const project = await convertOfferToProject(db, parsed.data, user.id);
    refreshWork(project.id);
    revalidatePath(`/offers/${parsed.data.offerId}`);
    return { ok: true, id: project.id, message: `Project ${project.code} created with ${project.tasks} task${project.tasks === 1 ? "" : "s"}.` };
  });
}

export async function updateProjectAction(id: string, input: ProjectInput): Promise<ActionResult> {
  return runAction("work.manage", async (user) => {
    const parsed = projectSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await updateProject(db, id, parsed.data, user.id);
    refreshWork(id);
    return { ok: true, id, message: "Project saved." };
  });
}

export async function createRetainerMonthAction(projectId: string, month: string): Promise<ActionResult> {
  return runAction("work.manage", async (user) => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { ok: false, error: "Choose a month." };
    const result = await createRetainerMonthNow(db, projectId, month, user.id);
    refreshWork(projectId);
    if (!result.created) return { ok: true, message: "That month already has its tasks, or is outside the retainer period. Nothing was added." };
    return { ok: true, message: `Created ${result.deliverables} deliverables and ${result.tasks} tasks.` };
  });
}

export async function setProjectArchivedAction(id: string, archived: boolean): Promise<ActionResult> {
  return runAction("work.manage", async (user) => {
    await setProjectArchived(db, id, archived, user.id);
    refreshWork(id);
    return { ok: true, message: archived ? "Project archived." : "Project restored." };
  });
}

export async function saveMilestoneAction(input: MilestoneInput): Promise<ActionResult> {
  return runAction("work.manage", async (user) => {
    const parsed = milestoneSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await saveMilestone(db, parsed.data, user.id);
    refreshWork(parsed.data.projectId);
    return { ok: true, message: "Milestone saved." };
  });
}

export async function saveTargetAction(id: string | null, input: TargetInput): Promise<ActionResult> {
  return runAction("work.manage", async (user) => {
    const parsed = targetSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await saveTarget(db, id, parsed.data, user.id);
    refreshWork(parsed.data.projectId);
    return { ok: true, message: "Target saved." };
  });
}

export async function saveTargetProgressAction(projectId: string, input: TargetProgressInput): Promise<ActionResult> {
  return runAction("work.manage", async (user) => {
    const parsed = targetProgressSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await saveTargetProgress(db, parsed.data, user.id);
    refreshWork(projectId);
    return { ok: true, message: "Result saved." };
  });
}

export async function createChangeRequestAction(input: ChangeRequestInput): Promise<ActionResult> {
  return runAction("work.manage", async (user) => {
    const parsed = changeRequestSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await createChangeRequest(db, input, user.id);
    refreshWork(parsed.data.projectId);
    return { ok: true, message: "Change request logged." };
  });
}

export async function decideChangeRequestAction(id: string, status: "APPROVED" | "REJECTED", projectId: string): Promise<ActionResult> {
  return runAction("work.manage", async (user) => {
    await decideChangeRequest(db, id, status, user.id);
    refreshWork(projectId);
    return { ok: true, message: status === "APPROVED" ? "Approved." : "Rejected." };
  });
}

// ─── Onboarding ──────────────────────────────────────────────────────────────

export async function setOnboardingItemAction(itemId: string, done: boolean): Promise<ActionResult> {
  return runAction("work.manage", async (user) => {
    await setOnboardingItemDone(db, itemId, done, user.id);
    revalidatePath("/projects", "layout");
    revalidatePath("/offers", "layout");
    return { ok: true };
  });
}

export async function addOnboardingItemAction(checklistId: string, title: string): Promise<ActionResult> {
  return runAction("work.manage", async (user) => {
    const clean = title.trim();
    if (clean.length < 2 || clean.length > 200) return { ok: false, error: "Please write the item." };
    await addOnboardingItem(db, checklistId, clean, user.id);
    revalidatePath("/projects", "layout");
    revalidatePath("/offers", "layout");
    return { ok: true, message: "Added." };
  });
}

export async function removeOnboardingItemAction(itemId: string): Promise<ActionResult> {
  return runAction("work.manage", async (user) => {
    await removeOnboardingItem(db, itemId, user.id);
    revalidatePath("/projects", "layout");
    revalidatePath("/offers", "layout");
    return { ok: true, message: "Removed." };
  });
}

export async function saveOnboardingTemplateAction(serviceId: string | null, lines: string): Promise<ActionResult> {
  return runAction("settings.manage", async (user) => {
    const parsed = onboardingLinesSchema.safeParse(lines);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
    await saveOnboardingTemplate(db, serviceId, parsed.data, user.id);
    revalidatePath("/settings", "layout");
    return { ok: true, message: "Checklist saved. It applies to offers accepted from now on." };
  });
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

export async function saveTaskAction(id: string | null, input: TaskInput): Promise<ActionResult> {
  return runAction("work.manage", async (user) => {
    const parsed = taskSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const task = id ? await updateTask(db, id, parsed.data, user.id) : await createTask(db, parsed.data, user.id);
    refreshWork(task.projectId, task.id);
    return { ok: true, id: task.id, message: id ? "Task saved." : "Task created." };
  });
}

export async function changeTaskStatusAction(input: { taskId: string; status: string; blockedReason?: string }): Promise<ActionResult> {
  return runAction("work.own", async (user) => {
    const parsed = taskStatusSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await changeTaskStatus(db, { taskId: parsed.data.taskId, status: parsed.data.status as TaskStatus, blockedReason: parsed.data.blockedReason, viewer: await loadViewer(db, user) });
    refreshWork(null, parsed.data.taskId);
    revalidatePath("/projects", "layout");
    return { ok: true, message: "Status updated." };
  });
}

export async function bulkUpdateTasksAction(input: { taskIds: string[]; assigneeId?: string; status?: string }): Promise<ActionResult> {
  return runAction("work.manage", async (user) => {
    const parsed = bulkTaskSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
    const count = await bulkUpdateTasks(db, { taskIds: parsed.data.taskIds, assigneeId: parsed.data.assigneeId, status: parsed.data.status as TaskStatus | undefined }, user.id);
    refreshWork();
    revalidatePath("/projects", "layout");
    return { ok: true, message: `Updated ${count} task${count === 1 ? "" : "s"}.` };
  });
}

export async function addCommentAction(input: { taskId: string; body: string }): Promise<ActionResult> {
  return runAction("work.own", async (user) => {
    const parsed = commentSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
    await addComment(db, { ...parsed.data, viewer: await loadViewer(db, user) });
    revalidatePath(`/tasks/${parsed.data.taskId}`);
    return { ok: true };
  });
}

export async function addChecklistItemAction(input: { taskId: string; title: string }): Promise<ActionResult> {
  return runAction("work.own", async (user) => {
    const parsed = checklistSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
    await addChecklistItem(db, { ...parsed.data, viewer: await loadViewer(db, user) });
    revalidatePath(`/tasks/${parsed.data.taskId}`);
    return { ok: true };
  });
}

export async function setChecklistItemAction(itemId: string, done: boolean, taskId: string): Promise<ActionResult> {
  return runAction("work.own", async (user) => {
    await setChecklistItem(db, { itemId, done, viewer: await loadViewer(db, user) });
    revalidatePath(`/tasks/${taskId}`);
    return { ok: true };
  });
}

export async function logTimeAction(input: TimeLogInput): Promise<ActionResult> {
  return runAction("work.own", async (user) => {
    const parsed = timeLogSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await logTime(db, { ...parsed.data, viewer: await loadViewer(db, user) });
    revalidatePath(`/tasks/${parsed.data.taskId}`);
    return { ok: true, message: "Time logged." };
  });
}

export async function addRevisionAction(taskId: string): Promise<ActionResult> {
  return runAction("work.own", async (user) => {
    const result = await addRevision(db, { taskId, viewer: await loadViewer(db, user) });
    revalidatePath(`/tasks/${taskId}`);
    return { ok: true, message: result.exceeded ? "Revision counted. This is more than the offer includes, so consider a change request." : "Revision counted." };
  });
}

export async function setTaskArchivedAction(id: string, archived: boolean): Promise<ActionResult> {
  return runAction("work.manage", async (user) => {
    await setTaskArchived(db, id, archived, user.id);
    refreshWork(null, id);
    revalidatePath("/projects", "layout");
    return { ok: true, message: archived ? "Task archived." : "Task restored." };
  });
}

const ATTACH_MAX = 5 * 1024 * 1024;
const OFFICE = /\.(docx|xlsx|pptx)$/i;

/** Real file type is checked from its contents, not its name. Files are only ever served as downloads. */
function attachmentType(buf: Buffer, name: string): { ext: string; mime: string } | null {
  const image = sniffImage(buf);
  if (image) return { ext: image, mime: image === "jpg" ? "image/jpeg" : `image/${image}` };
  if (buf.subarray(0, 5).toString() === "%PDF-") return { ext: "pdf", mime: "application/pdf" };
  if (buf.subarray(0, 2).toString() === "PK" && OFFICE.test(name)) return { ext: name.split(".").pop()!.toLowerCase(), mime: "application/octet-stream" };
  return null;
}

export async function uploadTaskFileAction(formData: FormData): Promise<ActionResult> {
  return runAction("work.own", async (user) => {
    const taskId = String(formData.get("taskId") ?? "");
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Please choose a file." };
    if (file.size > ATTACH_MAX) return { ok: false, error: "Files must be 5 MB or smaller." };
    const buf = Buffer.from(await file.arrayBuffer());
    const type = attachmentType(buf, file.name);
    if (!type) return { ok: false, error: "Only images, PDF, Word, Excel and PowerPoint files are allowed." };
    const viewer = await loadViewer(db, user);
    const storageKey = `private/tasks/${crypto.randomUUID()}.${type.ext}`;
    await putFile(storageKey, buf, type.mime);
    await addTaskAttachment(db, { taskId, name: file.name.slice(0, 200), storageKey, mimeType: type.mime, sizeBytes: file.size, viewer });
    revalidatePath(`/tasks/${taskId}`);
    return { ok: true, message: "File added." };
  });
}

// ─── Team ────────────────────────────────────────────────────────────────────

async function sendWelcome(to: string, name: string, token: string, subjectAgency: string) {
  const link = `${process.env.APP_URL ?? "http://localhost:3000"}/reset-password?token=${token}`;
  return sendMail({
    to,
    subject: `Welcome to ${subjectAgency} Work OS`,
    text: fillTemplate("Hello {{name}},\n\nAn account has been created for you. Choose your password here. The link works for 3 days and only once:\n\n{{link}}\n\nThen sign in with this email address.", { name, link }),
    entityType: "User",
  });
}

export async function createEmployeeAction(input: EmployeeInput): Promise<ActionResult> {
  return runAction("team.manage", async (user) => {
    const parsed = employeeSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const { user: created, token } = await createEmployee(db, parsed.data, user.id);
    const settings = await db.settings.findUnique({ where: { id: "agency" }, select: { agencyName: true } });
    const mail = await sendWelcome(created.email, created.name, token, settings?.agencyName ?? "Rezonest");
    revalidatePath("/team");
    return { ok: true, id: created.id, message: mail.ok ? `${created.name} added. A link to set a password was emailed.` : `${created.name} added, but the email failed. Use “Send password link” on their page.` };
  });
}

export async function updateEmployeeAction(id: string, input: EmployeeInput): Promise<ActionResult> {
  return runAction("team.manage", async (user) => {
    const parsed = employeeSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await updateEmployee(db, id, parsed.data, user.id);
    revalidatePath("/team", "layout");
    return { ok: true, id, message: "Saved." };
  });
}

export async function sendPasswordLinkAction(id: string): Promise<ActionResult> {
  return runAction("team.manage", async () => {
    const target = await db.user.findUnique({ where: { id } });
    if (!target?.isActive) return { ok: false, error: "This person is inactive." };
    const token = await issuePasswordLink(db, id, 72);
    const settings = await db.settings.findUnique({ where: { id: "agency" }, select: { agencyName: true } });
    const mail = await sendWelcome(target.email, target.name, token, settings?.agencyName ?? "Rezonest");
    return mail.ok ? { ok: true, message: "Link emailed." } : { ok: false, error: `The email could not be sent. ${mail.error ?? ""}`.trim() };
  });
}

export async function deactivateEmployeeAction(id: string, reassignTo: string | null): Promise<ActionResult> {
  return runAction("team.manage", async (user) => {
    const moved = await deactivateEmployee(db, { userId: id, reassignTo, actorId: user.id });
    revalidatePath("/team", "layout");
    refreshWork();
    return { ok: true, message: `Deactivated. ${moved} open task${moved === 1 ? "" : "s"} ${reassignTo ? "handed over" : "moved back to the department"}.` };
  });
}

export async function reactivateEmployeeAction(id: string): Promise<ActionResult> {
  return runAction("team.manage", async (user) => {
    await reactivateEmployee(db, id, user.id);
    revalidatePath("/team", "layout");
    return { ok: true, message: "Reactivated." };
  });
}
