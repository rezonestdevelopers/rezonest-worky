import { z } from "zod";
import { isValidDateKey, moneyString, optionalDateKey, optionalEmail, optionalId, optionalPhone, optionalText } from "./common";
import { PRIORITIES } from "./catalogue";
import { TASK_STATUSES } from "@/lib/work-plan";

const dateKey = z.string().trim().refine(isValidDateKey, "Enter a valid date");
const id = z.string().min(1).max(60);

const measure = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim().replace(/[₹,\s]/g, ""))
  .refine((v) => /^-?\d{1,12}(\.\d{1,2})?$/.test(v), "Enter a number");

const milestoneRow = z.object({
  id: z.string().max(60).optional(),
  name: z.string().trim().min(1, "Name this milestone").max(120),
  dueDate: optionalDateKey,
  paymentPercent: z
    .union([z.string(), z.number()])
    .nullish()
    .transform((v) => String(v ?? "").trim())
    .refine((v) => v === "" || (/^\d{1,3}(\.\d{1,2})?$/.test(v) && Number(v) <= 100), "Enter 0 to 100")
    .transform((v) => v || null),
});

const targetRow = z.object({
  serviceId: optionalId,
  metric: z.string().trim().max(120),
  unit: optionalText(20),
  targetValue: z
    .union([z.string(), z.number()])
    .nullish()
    .transform((v) => String(v ?? "").trim().replace(/[₹,\s]/g, ""))
    .refine((v) => v === "" || /^\d{1,12}(\.\d{1,2})?$/.test(v), "Enter a number"),
  higherIsBetter: z.boolean().default(true),
});

export const convertOfferSchema = z
  .object({
    offerId: id,
    name: z.string().trim().min(3, "Name the project").max(200),
    managerId: optionalId,
    startDate: dateKey,
    deadline: optionalDateKey,
    retainerEnd: optionalDateKey,
    autoRenew: z.boolean(),
    milestones: z.array(milestoneRow).max(30),
    targets: z.array(targetRow).max(50),
    createTasks: z.boolean(),
  })
  .superRefine((p, ctx) => {
    if (p.deadline && p.deadline < p.startDate) ctx.addIssue({ code: "custom", path: ["deadline"], message: "The deadline can't be before the start date" });
    if (p.retainerEnd && p.retainerEnd < p.startDate) ctx.addIssue({ code: "custom", path: ["retainerEnd"], message: "The end date can't be before the start date" });
    const total = p.milestones.reduce((sum, m) => sum + Number(m.paymentPercent ?? 0), 0);
    if (Math.round(total * 100) > 10000) ctx.addIssue({ code: "custom", path: ["milestones"], message: `Payment percentages add up to more than 100% (${total}%)` });
  });
export type ConvertOfferInput = z.input<typeof convertOfferSchema>;
export type ConvertOfferData = z.output<typeof convertOfferSchema>;

export const PROJECT_STATUSES = ["NOT_STARTED", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"] as const;

export const projectSchema = z
  .object({
    name: z.string().trim().min(3, "Name the project").max(200),
    managerId: optionalId,
    status: z.enum(PROJECT_STATUSES),
    startDate: dateKey,
    deadline: optionalDateKey,
    retainerEnd: optionalDateKey,
    autoRenew: z.boolean(),
    healthOverride: z.enum(["ON_TRACK", "AT_RISK", "DELAYED"]).or(z.literal("")).nullish().transform((v) => v || null),
    healthOverrideNote: optionalText(500),
    notes: optionalText(5000),
  })
  .superRefine((p, ctx) => {
    if (p.deadline && p.deadline < p.startDate) ctx.addIssue({ code: "custom", path: ["deadline"], message: "The deadline can't be before the start date" });
    if (p.retainerEnd && p.retainerEnd < p.startDate) ctx.addIssue({ code: "custom", path: ["retainerEnd"], message: "The end date can't be before the start date" });
    if (p.healthOverride && !p.healthOverrideNote) ctx.addIssue({ code: "custom", path: ["healthOverrideNote"], message: "Say why you're overriding the health" });
  });
export type ProjectInput = z.input<typeof projectSchema>;

export const milestoneSchema = z.object({
  projectId: id,
  id: z.string().max(60).optional(),
  name: z.string().trim().min(1, "Name this milestone").max(120),
  dueDate: optionalDateKey,
  paymentPercent: milestoneRow.shape.paymentPercent,
  completed: z.boolean(),
});
export type MilestoneInput = z.input<typeof milestoneSchema>;

export const targetSchema = z.object({
  projectId: id,
  serviceId: optionalId,
  metric: z.string().trim().min(2, "Name what you're measuring").max(120),
  unit: optionalText(20),
  targetValue: measure,
  higherIsBetter: z.boolean(),
});
export type TargetInput = z.input<typeof targetSchema>;

export const targetProgressSchema = z.object({
  targetId: id,
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose a month"),
  actualValue: measure,
  note: optionalText(300),
});
export type TargetProgressInput = z.input<typeof targetProgressSchema>;

export const changeRequestSchema = z.object({
  projectId: id,
  deliverableId: optionalId,
  description: z.string().trim().min(5, "Describe the change").max(2000),
  estimate: moneyString,
  isBillable: z.boolean(),
});
export type ChangeRequestInput = z.input<typeof changeRequestSchema>;

export const taskSchema = z.object({
  title: z.string().trim().min(2, "Give the task a title").max(240),
  description: optionalText(8000),
  projectId: optionalId,
  clientId: optionalId,
  serviceId: optionalId,
  milestoneId: optionalId,
  assigneeId: optionalId,
  departmentId: optionalId,
  priority: z.enum(PRIORITIES),
  startDate: optionalDateKey,
  dueDate: optionalDateKey,
}).superRefine((t, ctx) => {
  if (t.startDate && t.dueDate && t.dueDate < t.startDate) ctx.addIssue({ code: "custom", path: ["dueDate"], message: "The due date can't be before the start date" });
  if (!t.assigneeId && !t.departmentId) ctx.addIssue({ code: "custom", path: ["assigneeId"], message: "Choose a person or a department" });
});
export type TaskInput = z.input<typeof taskSchema>;
export type TaskData = z.output<typeof taskSchema>;

export const taskStatusSchema = z.object({
  taskId: id,
  status: z.enum(TASK_STATUSES as [string, ...string[]]),
  blockedReason: optionalText(500),
});

export const bulkTaskSchema = z
  .object({
    taskIds: z.array(id).min(1, "Select at least one task").max(200),
    assigneeId: z.string().max(60).optional(),
    status: z.enum(TASK_STATUSES as [string, ...string[]]).optional(),
  })
  .refine((b) => b.assigneeId !== undefined || b.status !== undefined, "Choose what to change");

export const timeLogSchema = z.object({
  taskId: id,
  date: dateKey,
  minutes: z.coerce.number().int().min(1, "Enter the time spent").max(1440, "That's more than a day"),
  note: optionalText(300),
});
export type TimeLogInput = z.input<typeof timeLogSchema>;

export const commentSchema = z.object({ taskId: id, body: z.string().trim().min(1, "Write a comment").max(5000) });
export const checklistSchema = z.object({ taskId: id, title: z.string().trim().min(1, "Write an item").max(240) });

export const ROLES = ["ADMIN", "MANAGER", "EMPLOYEE"] as const;

export const employeeSchema = z.object({
  name: z.string().trim().min(2, "Enter their name").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(160),
  role: z.enum(ROLES),
  phone: optionalPhone,
  departmentId: optionalId,
  designation: optionalText(120),
  joiningDate: optionalDateKey,
  hourlyCost: z
    .union([z.string(), z.number()])
    .nullish()
    .transform((v) => String(v ?? "").trim().replace(/[₹,\s]/g, ""))
    .refine((v) => v === "" || /^\d{1,8}(\.\d{1,2})?$/.test(v), "Enter an amount like 350")
    .transform((v) => v || null),
  dailyDigest: z.boolean(),
  emailOnTask: z.boolean(),
});
export type EmployeeInput = z.input<typeof employeeSchema>;
export type EmployeeData = z.output<typeof employeeSchema>;

export const onboardingLinesSchema = z
  .string()
  .max(5000)
  .transform((v) => Array.from(new Set(v.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))))
  .refine((l) => l.length <= 40 && l.every((x) => x.length <= 200), "Keep to 40 items of up to 200 characters");

export { optionalEmail };
