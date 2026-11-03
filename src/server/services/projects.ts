import type { ContentFormat, Prisma } from "@prisma/client";
import { addDaysKey, dateOnlyKey, formatMonthKey, keyToDate, monthKeyOf, monthRange, shiftMonth, todayKey } from "@/lib/dates";
import { computeProjectHealth } from "@/lib/health";
import { toDecimal } from "@/lib/money/decimal";
import type { ChangeRequestInput, ConvertOfferData } from "@/lib/validators/work";
import { changeRequestSchema, milestoneSchema, projectSchema, targetProgressSchema, targetSchema } from "@/lib/validators/work";
import { labelForFormat, planBackward, planForward, renewedEnd, spreadDates, templateNameForFormat, toWorkingDay, unitSets, type PlanStep, type PlannedTask } from "@/lib/work-plan";
import type { z } from "zod";
import { ensureOfferOnboarding } from "./onboarding";
import { BusinessError, diffChanges, logActivity, type Db, type Tx } from "./shared";

const asKey = (d: Date | null | undefined) => (d ? dateOnlyKey(d) : null);
const toDate = (k: string | null | undefined) => (k ? keyToDate(k) : null);

/** Project codes run PRJ-0001 upwards. The lock means two projects created at once can't share a code. */
async function nextProjectCode(tx: Tx): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(727001)`;
  const rows = await tx.$queryRaw<{ max: number | null }[]>`SELECT max(substring("code" from 'PRJ-([0-9]+)')::int) AS max FROM "Project"`;
  return `PRJ-${String((rows[0]?.max ?? 0) + 1).padStart(4, "0")}`;
}

type StepRow = Prisma.TaskTemplateStepGetPayload<object>;
const toStep = (s: StepRow): PlanStep => ({ title: s.title, durationDays: s.durationDays, departmentId: s.departmentId, priority: s.priority, isClientApproval: s.isClientApproval });

type TemplateWithSteps = Prisma.TaskTemplateGetPayload<{ include: { steps: { orderBy: { sortOrder: "asc" } }; subService: { select: { name: true } } } }>;

function taskRows(planned: PlannedTask[], base: { projectId: string; clientId: string; serviceId: string; deliverableId?: string; prefix?: string; actorId: string | null; milestoneFor?: (title: string) => string | undefined }): Prisma.TaskCreateManyInput[] {
  return planned.map((t, i) => ({
    title: base.prefix ? `${base.prefix}: ${t.title}` : t.title,
    projectId: base.projectId,
    clientId: base.clientId,
    serviceId: base.serviceId,
    deliverableId: base.deliverableId,
    milestoneId: base.milestoneFor?.(t.title),
    departmentId: t.departmentId,
    priority: t.priority,
    status: "TODO",
    startDate: keyToDate(t.startKey),
    dueDate: keyToDate(t.dueKey),
    sortOrder: i,
    createdById: base.actorId,
  }));
}

/**
 * Creates one month of a retainer: a deliverable for every item in the package, with tasks from
 * the matching template, plus the service's own monthly tasks. A month can only be created once,
 * even if this runs twice or the button is pressed twice.
 */
export async function generateRetainerMonth(tx: Tx, projectId: string, month: string, actorId: string | null): Promise<{ created: boolean; tasks: number; deliverables: number }> {
  const nothing = { created: false, tasks: 0, deliverables: 0 };
  const project = await tx.project.findUnique({
    where: { id: projectId },
    include: { services: { where: { isActive: true, billingType: "MONTHLY_RETAINER" }, include: { service: true } } },
  });
  if (!project?.isRetainer || !project.retainerStart) return nothing;

  const { start, end } = monthRange(`${month}-01`);
  const retainerStart = dateOnlyKey(project.retainerStart);
  const from = retainerStart > start ? retainerStart : start;
  const retainerEnd = asKey(project.retainerEnd);
  const to = retainerEnd && retainerEnd < end ? retainerEnd : end;
  if (from > to) return nothing;

  const { count } = await tx.retainerRun.createMany({ data: [{ projectId, month }], skipDuplicates: true });
  if (!count) return nothing;

  const settings = await tx.settings.findUniqueOrThrow({ where: { id: "agency" } });
  const workingDays = settings.workingDays;
  const templates: TemplateWithSteps[] = await tx.taskTemplate.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
    include: { steps: { orderBy: { sortOrder: "asc" } }, subService: { select: { name: true } } },
  });

  let tasks = 0;
  let deliverables = 0;
  const monthName = formatMonthKey(month);

  for (const ps of project.services) {
    const pkg = (ps.deliverables as { format: ContentFormat; qtyPerMonth: number }[] | null) ?? [];
    for (const { format, qtyPerMonth } of pkg) {
      const wanted = templateNameForFormat(format);
      const template = templates.find((t) => t.serviceId === ps.serviceId && t.name === wanted) ?? templates.find((t) => t.name === wanted);
      const steps: PlanStep[] = template?.steps.length
        ? template.steps.map(toStep)
        : [{ title: labelForFormat(format), durationDays: 1, departmentId: ps.service.departmentId, priority: "MEDIUM", isClientApproval: false }];
      const dates = spreadDates(from, to, qtyPerMonth, workingDays);
      for (const [i, dueKey] of dates.entries()) {
        const title = `${labelForFormat(format)} #${i + 1} – ${monthName}`;
        const deliverable = await tx.deliverable.create({
          data: { projectId, serviceId: ps.serviceId, format, title, month, dueDate: keyToDate(dueKey), revisionsIncluded: ps.service.revisionsIncluded },
        });
        const rows = taskRows(planBackward(steps, dueKey, from, workingDays), { projectId, clientId: project.clientId, serviceId: ps.serviceId, deliverableId: deliverable.id, prefix: title, actorId });
        await tx.task.createMany({ data: rows });
        tasks += rows.length;
        deliverables++;
      }
    }
    // The service's regular monthly work. Format templates such as "Reel" are used only above.
    const monthly = templates.filter((t) => t.serviceId === ps.serviceId && !t.subServiceId);
    for (const t of monthly) {
      const planned = planForward(t.steps.map(toStep), from, workingDays).map((p) => {
        const last = toWorkingDay(to, workingDays, -1);
        return p.dueKey > last ? { ...p, dueKey: last, startKey: p.startKey > last ? last : p.startKey } : p;
      });
      const rows = taskRows(planned, { projectId, clientId: project.clientId, serviceId: ps.serviceId, prefix: monthName, actorId });
      await tx.task.createMany({ data: rows });
      tasks += rows.length;
    }
  }
  await logActivity(tx, { actorId, action: "project.retainer_month_created", entityType: "Project", entityId: projectId, clientId: project.clientId, changes: { month, tasks, deliverables } });
  return { created: true, tasks, deliverables };
}

/** One click turns an accepted offer into a project, with its services, prices, terms and tasks. */
export async function convertOfferToProject(db: Db, data: ConvertOfferData, actorId: string) {
  return db.$transaction(
    async (tx) => {
      // Taken first, so a second click waits here and then sees the project the first one made.
      const code = await nextProjectCode(tx);
      const offer = await tx.offer.findUnique({ where: { id: data.offerId }, include: { items: { orderBy: { sortOrder: "asc" } }, project: { select: { id: true } } } });
      if (!offer || offer.isTemplate) throw new BusinessError("This offer no longer exists.");
      if (offer.status !== "ACCEPTED") throw new BusinessError("Only an accepted offer can become a project.");
      if (offer.project) throw new BusinessError("This offer has already been converted to a project.");
      if (!offer.clientId) throw new BusinessError("This offer is for a lead. Convert the lead to a client first.");
      const client = await tx.client.findUnique({ where: { id: offer.clientId } });
      if (!client || client.archivedAt) throw new BusinessError("That client is archived. Restore them first.");

      const items = offer.items.filter((i) => i.serviceId);
      const isRetainer = items.some((i) => i.billingType === "MONTHLY_RETAINER");
      if (isRetainer && !data.retainerEnd) throw new BusinessError("Please set when the retainer ends.");

      const project = await tx.project.create({
        data: {
          code,
          name: data.name,
          clientId: offer.clientId,
          offerId: offer.id,
          managerId: data.managerId,
          status: "ACTIVE",
          startDate: keyToDate(data.startDate),
          deadline: toDate(data.deadline),
          isRetainer,
          retainerStart: isRetainer ? keyToDate(data.startDate) : null,
          retainerEnd: isRetainer ? toDate(data.retainerEnd) : null,
          autoRenew: isRetainer && data.autoRenew,
          retainerTaskDay: (await tx.settings.findUniqueOrThrow({ where: { id: "agency" } })).retainerTaskDay,
          createdById: actorId,
          services: {
            create: items.map((i) => ({
              serviceId: i.serviceId!,
              subServiceId: i.subServiceId,
              description: i.description,
              billingType: i.billingType,
              quantity: i.quantity,
              rate: i.rate,
              discountType: i.discountType,
              discountValue: i.discountValue,
              gstRate: i.gstRate,
              monthlyValue: i.billingType === "MONTHLY_RETAINER" ? i.taxableValue : 0,
              deliverables: i.deliverables ?? undefined,
            })),
          },
          milestones: {
            create: data.milestones.map((m, sortOrder) => ({
              name: m.name,
              dueDate: toDate(m.dueDate),
              paymentPercent: m.paymentPercent,
              amount: m.paymentPercent ? toDecimal(offer.grandTotal).times(m.paymentPercent).dividedBy(100).toDecimalPlaces(2).toFixed(2) : null,
              sortOrder,
            })),
          },
          targets: {
            create: data.targets
              .filter((t) => t.metric && t.targetValue !== "")
              .map((t, sortOrder) => ({ serviceId: t.serviceId, metric: t.metric, unit: t.unit, targetValue: t.targetValue, higherIsBetter: t.higherIsBetter, sortOrder })),
          },
        },
        include: { milestones: true, services: true },
      });

      // The checklist started when the offer was accepted now belongs to this project.
      const checklist = await ensureOfferOnboarding(tx, offer.id);
      if (checklist) await tx.onboardingChecklist.update({ where: { id: checklist.id }, data: { projectId: project.id } });

      let tasks = 0;
      if (data.createTasks) {
        const workingDays = (await tx.settings.findUniqueOrThrow({ where: { id: "agency" } })).workingDays;
        const milestoneFor = (title: string) => project.milestones.find((m) => m.name.toLowerCase().split(/\s+/)[0] === title.toLowerCase().split(/\s+/)[0])?.id;
        for (const ps of project.services.filter((s) => s.billingType !== "MONTHLY_RETAINER")) {
          const candidates = await tx.taskTemplate.findMany({
            where: { serviceId: ps.serviceId, isActive: true },
            include: { steps: { orderBy: { sortOrder: "asc" } } },
          });
          const chosen = candidates.filter((t) => t.subServiceId === ps.subServiceId && ps.subServiceId);
          const templates = chosen.length ? chosen : candidates.filter((t) => !t.subServiceId);
          const sets = unitSets(ps.billingType, ps.quantity.toString());
          for (const t of templates) {
            for (let n = 1; n <= sets; n++) {
              const prefix = sets > 1 ? `${t.name} #${n}` : undefined;
              const rows = taskRows(planForward(t.steps.map(toStep), data.startDate, workingDays), { projectId: project.id, clientId: project.clientId, serviceId: ps.serviceId, actorId, milestoneFor, prefix });
              await tx.task.createMany({ data: rows });
              tasks += rows.length;
            }
          }
        }
        const month = monthKeyOf(data.startDate);
        if (isRetainer && month <= monthKeyOf(todayKey())) {
          tasks += (await generateRetainerMonth(tx, project.id, month, actorId)).tasks;
        }
      }
      await refreshProject(tx, project.id);
      await logActivity(tx, { actorId, action: "project.created_from_offer", entityType: "Project", entityId: project.id, clientId: project.clientId, changes: { offer: offer.number, code, tasks } });
      return { id: project.id, code, tasks };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}

/**
 * Works out progress and automatic health from the project's tasks and milestones. Retainers
 * measure work due in the last 30 days; other projects measure all of their tasks.
 */
export async function refreshProject(tx: Db | Tx, projectId: string, today = todayKey()) {
  const project = await tx.project.findUnique({ where: { id: projectId } });
  if (!project || project.archivedAt) return;
  const todayDate = keyToDate(today);
  const scope: Prisma.TaskWhereInput = {
    projectId,
    archivedAt: null,
    ...(project.isRetainer ? { dueDate: { gte: keyToDate(addDaysKey(today, -30)), lte: todayDate } } : {}),
  };
  const open: Prisma.TaskWhereInput = { projectId, archivedAt: null, status: { not: "DONE" } };
  const [total, done, openTasks, overdue, missed, soon] = await Promise.all([
    tx.task.count({ where: scope }),
    tx.task.count({ where: { ...scope, status: "DONE" } }),
    tx.task.count({ where: open }),
    // Waiting on the client isn't the agency's delay.
    tx.task.count({ where: { ...open, status: { notIn: ["DONE", "WAITING_CLIENT_APPROVAL"] }, dueDate: { lt: todayDate } } }),
    tx.milestone.count({ where: { projectId, status: { not: "COMPLETED" }, dueDate: { lt: todayDate } } }),
    tx.milestone.count({ where: { projectId, status: { not: "COMPLETED" }, dueDate: { gte: todayDate, lte: keyToDate(addDaysKey(today, 7)) } } }),
  ]);
  const completed = project.status === "COMPLETED";
  const progressPercent = completed ? 100 : total ? Math.round((done / total) * 100) : 0;
  const healthAuto = computeProjectHealth({
    todayKey: today,
    openTasks,
    overdueTasks: overdue,
    missedMilestones: missed,
    milestonesDueSoon: soon,
    deadlineKey: asKey(project.deadline) ?? asKey(project.retainerEnd),
    progressPercent,
    isCompleted: completed || project.status === "CANCELLED",
  });
  if (project.progressPercent !== progressPercent || project.healthAuto !== healthAuto) {
    await tx.project.update({ where: { id: projectId }, data: { progressPercent, healthAuto } });
  }
}

/**
 * The daily job: creates this month's retainer tasks once its day has come, renews retainers set
 * to auto-renew, and refreshes health. Safe to run any number of times.
 */
export async function runDailyWork(db: Db, today = todayKey()) {
  const projects = await db.project.findMany({
    where: { archivedAt: null, status: { in: ["ACTIVE", "NOT_STARTED", "ON_HOLD"] } },
    select: { id: true, name: true, clientId: true, status: true, isRetainer: true, retainerStart: true, retainerEnd: true, autoRenew: true, retainerTaskDay: true },
  });
  const month = monthKeyOf(today);
  const day = Number(today.slice(8, 10));
  let renewed = 0;
  let monthsCreated = 0;
  for (const p of projects) {
    if (p.isRetainer && p.status === "ACTIVE") {
      const endKey = asKey(p.retainerEnd);
      if (p.autoRenew && endKey && p.retainerStart && endKey < today) {
        const next = renewedEnd(dateOnlyKey(p.retainerStart), endKey);
        const done = await db.project.updateMany({ where: { id: p.id, retainerEnd: p.retainerEnd }, data: { retainerEnd: keyToDate(next) } });
        if (done.count) {
          renewed++;
          await logActivity(db, { actorId: null, action: "project.retainer_renewed", entityType: "Project", entityId: p.id, clientId: p.clientId, changes: { retainerEnd: { from: endKey, to: next } } });
        }
      }
      if (day >= p.retainerTaskDay) {
        const result = await db.$transaction((tx) => generateRetainerMonth(tx, p.id, month, null), { timeout: 60_000, maxWait: 10_000 });
        if (result.created) monthsCreated++;
      }
    }
    await refreshProject(db, p.id, today);
  }
  return { projects: projects.length, renewed, monthsCreated };
}

let lastRun = 0;
/** Runs the daily job at most every 10 minutes, so numbers stay right even if the scheduled job is late. Pages call this after responding, so nobody waits for it. */
export async function runDailyWorkIfStale(db: Db) {
  if (Date.now() - lastRun < 10 * 60_000) return;
  lastRun = Date.now();
  await runDailyWork(db).catch((e) => {
    lastRun = 0;
    console.error("Daily work job failed", e);
  });
}

// ─── Editing ─────────────────────────────────────────────────────────────────

const PROJECT_FIELDS = ["name", "managerId", "status", "startDate", "deadline", "retainerEnd", "autoRenew", "healthOverride", "healthOverrideNote", "notes"] as const;

export async function updateProject(db: Db, id: string, data: z.output<typeof projectSchema>, actorId: string) {
  return db.$transaction(async (tx) => {
    const before = await tx.project.findUnique({ where: { id } });
    if (!before || before.archivedAt) throw new BusinessError("This project no longer exists.");
    const after = await tx.project.update({
      where: { id },
      data: {
        name: data.name,
        managerId: data.managerId,
        status: data.status,
        startDate: keyToDate(data.startDate),
        deadline: toDate(data.deadline),
        retainerEnd: before.isRetainer ? toDate(data.retainerEnd) : null,
        autoRenew: before.isRetainer && data.autoRenew,
        healthOverride: data.healthOverride,
        healthOverrideNote: data.healthOverride ? data.healthOverrideNote : null,
        notes: data.notes,
      },
    });
    await refreshProject(tx, id);
    const changes = diffChanges(before, after, PROJECT_FIELDS);
    if (Object.keys(changes).length) await logActivity(tx, { actorId, action: "project.updated", entityType: "Project", entityId: id, clientId: before.clientId, changes });
  });
}

/** Creates a retainer month now, from the project page. Pressing it again changes nothing. */
export async function createRetainerMonthNow(db: Db, projectId: string, month: string, actorId: string) {
  const result = await db.$transaction((tx) => generateRetainerMonth(tx, projectId, month, actorId), { timeout: 60_000, maxWait: 10_000 });
  await refreshProject(db, projectId);
  return result;
}

export async function saveMilestone(db: Db, data: z.output<typeof milestoneSchema>, actorId: string) {
  await db.$transaction(async (tx) => {
    const project = await tx.project.findUnique({ where: { id: data.projectId }, include: { offer: { select: { grandTotal: true } } } });
    if (!project) throw new BusinessError("This project no longer exists.");
    const others = await tx.milestone.findMany({ where: { projectId: project.id, ...(data.id ? { id: { not: data.id } } : {}) }, select: { paymentPercent: true } });
    const percent = others.reduce((s, m) => s.plus(toDecimal(m.paymentPercent)), toDecimal(data.paymentPercent));
    if (percent.greaterThan(100)) throw new BusinessError(`Payment percentages would add up to ${percent.toString()}%, which is more than 100%.`);
    const fields = {
      name: data.name,
      dueDate: toDate(data.dueDate),
      paymentPercent: data.paymentPercent,
      amount: data.paymentPercent && project.offer ? toDecimal(project.offer.grandTotal).times(data.paymentPercent).dividedBy(100).toDecimalPlaces(2).toFixed(2) : null,
      status: data.completed ? ("COMPLETED" as const) : ("PENDING" as const),
      completedAt: data.completed ? new Date() : null,
    };
    if (data.id) {
      const existing = await tx.milestone.findFirst({ where: { id: data.id, projectId: project.id } });
      if (!existing) throw new BusinessError("This milestone no longer exists.");
      await tx.milestone.update({ where: { id: data.id }, data: { ...fields, completedAt: data.completed ? (existing.completedAt ?? new Date()) : null } });
    } else {
      await tx.milestone.create({ data: { ...fields, projectId: project.id, sortOrder: others.length } });
    }
    await refreshProject(tx, project.id);
    await logActivity(tx, { actorId, action: data.id ? "milestone.updated" : "milestone.added", entityType: "Project", entityId: project.id, clientId: project.clientId, changes: { name: data.name, completed: data.completed } });
  });
}

export async function saveTarget(db: Db, id: string | null, data: z.output<typeof targetSchema>, actorId: string) {
  await db.$transaction(async (tx) => {
    const project = await tx.project.findUnique({ where: { id: data.projectId } });
    if (!project) throw new BusinessError("This project no longer exists.");
    const fields = { serviceId: data.serviceId, metric: data.metric, unit: data.unit, targetValue: data.targetValue, higherIsBetter: data.higherIsBetter };
    if (id) {
      const { count } = await tx.target.updateMany({ where: { id, projectId: project.id }, data: fields });
      if (!count) throw new BusinessError("This target no longer exists.");
    } else {
      await tx.target.create({ data: { ...fields, projectId: project.id, sortOrder: await tx.target.count({ where: { projectId: project.id } }) } });
    }
    await logActivity(tx, { actorId, action: id ? "target.updated" : "target.added", entityType: "Project", entityId: project.id, clientId: project.clientId, changes: { metric: data.metric, target: data.targetValue } });
  });
}

/** One actual figure per target per month. Entering a month again corrects it. */
export async function saveTargetProgress(db: Db, data: z.output<typeof targetProgressSchema>, actorId: string) {
  await db.$transaction(async (tx) => {
    const target = await tx.target.findUnique({ where: { id: data.targetId }, include: { project: { select: { id: true, clientId: true } } } });
    if (!target) throw new BusinessError("This target no longer exists.");
    if (data.month > shiftMonth(monthKeyOf(todayKey()), 0)) throw new BusinessError("You can't enter results for a future month.");
    await tx.targetProgress.upsert({
      where: { targetId_month: { targetId: target.id, month: data.month } },
      update: { actualValue: data.actualValue, note: data.note },
      create: { targetId: target.id, month: data.month, actualValue: data.actualValue, note: data.note },
    });
    await logActivity(tx, { actorId, action: "target.progress_entered", entityType: "Project", entityId: target.project.id, clientId: target.project.clientId, changes: { metric: target.metric, month: data.month, actual: data.actualValue } });
  });
}

export async function createChangeRequest(db: Db, input: ChangeRequestInput, actorId: string) {
  const data = changeRequestSchema.parse(input);
  return db.$transaction(async (tx) => {
    const project = await tx.project.findUnique({ where: { id: data.projectId } });
    if (!project) throw new BusinessError("This project no longer exists.");
    if (data.deliverableId) {
      const deliverable = await tx.deliverable.findFirst({ where: { id: data.deliverableId, projectId: project.id } });
      if (!deliverable) throw new BusinessError("That deliverable isn't part of this project.");
    }
    const cr = await tx.changeRequest.create({
      data: { clientId: project.clientId, projectId: project.id, deliverableId: data.deliverableId, description: data.description, estimate: data.estimate, isBillable: data.isBillable, createdById: actorId },
    });
    await logActivity(tx, { actorId, action: "change_request.created", entityType: "ChangeRequest", entityId: cr.id, clientId: project.clientId, changes: { description: data.description, estimate: data.estimate } });
    return cr;
  });
}

/** Approved billable requests wait for the next invoice (Phase 7). Once invoiced they can't change. */
export async function decideChangeRequest(db: Db, id: string, status: "APPROVED" | "REJECTED", actorId: string) {
  await db.$transaction(async (tx) => {
    const cr = await tx.changeRequest.findUnique({ where: { id } });
    if (!cr) throw new BusinessError("This change request no longer exists.");
    if (cr.status === "INVOICED") throw new BusinessError("This request has been invoiced, so it can't be changed.");
    const { count } = await tx.changeRequest.updateMany({ where: { id, status: cr.status }, data: { status, decidedAt: new Date() } });
    if (!count) throw new BusinessError("This request was just changed by someone else. Please reload.");
    await logActivity(tx, { actorId, action: "change_request.decided", entityType: "ChangeRequest", entityId: id, clientId: cr.clientId, changes: { status: { from: cr.status, to: status } } });
  });
}

export async function setProjectArchived(db: Db, id: string, archived: boolean, actorId: string) {
  await db.$transaction(async (tx) => {
    const project = await tx.project.findUnique({ where: { id } });
    if (!project) throw new BusinessError("This project no longer exists.");
    if (archived && (project.status === "ACTIVE" || project.status === "ON_HOLD")) throw new BusinessError("Mark the project Completed or Cancelled before archiving it.");
    await tx.project.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
    await logActivity(tx, { actorId, action: archived ? "project.archived" : "project.restored", entityType: "Project", entityId: id, clientId: project.clientId });
  });
}
