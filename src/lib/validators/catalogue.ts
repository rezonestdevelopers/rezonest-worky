import { z } from "zod";
import { moneyString, optionalId, optionalMoney, optionalText } from "./common";

export const BILLING_TYPES = ["ONE_TIME", "MONTHLY_RETAINER", "PER_UNIT", "MILESTONE", "ANNUAL_RENEWAL"] as const;
export const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

const gstRate = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d{1,2}(\.\d{1,2})?$/.test(v) && Number(v) <= 28, "Enter a GST rate between 0 and 28");

export const serviceSchema = z.object({
  name: z.string().trim().min(2, "Enter the service name").max(120),
  departmentId: optionalId,
  billingType: z.enum(BILLING_TYPES),
  defaultPrice: moneyString,
  unit: z.string().trim().min(1, "Enter a unit, e.g. month").max(30),
  gstRate,
  sacCode: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .transform((v) => v || null)
    .refine((v) => v === null || /^\d{4,8}$/.test(v), "SAC code is 4 to 8 digits"),
  revisionsIncluded: z.coerce.number().int().min(0, "0 or more").max(50),
  isActive: z.boolean(),
  defaultKpis: z
    .array(z.object({ metric: z.string().trim().min(1, "Enter the KPI name").max(80), unit: z.string().trim().max(20) }))
    .max(30),
  defaultDeliverables: z
    .array(
      z.object({
        name: z.string().trim().min(1, "Enter the deliverable").max(80),
        qty: z.coerce.number().int().min(0).max(1000),
        unit: z.string().trim().max(20),
      }),
    )
    .max(30),
});
export type ServiceInput = z.input<typeof serviceSchema>;

export const subServicesSchema = z.object({
  serviceId: z.string().min(1).max(40),
  items: z
    .array(
      z.object({
        id: z.string().max(40).optional(),
        name: z.string().trim().min(1, "Enter a name").max(120),
        billingType: z
          .enum(BILLING_TYPES)
          .or(z.literal(""))
          .transform((v) => v || null),
        defaultPrice: optionalMoney,
        unit: optionalText(30),
        isActive: z.boolean(),
      }),
    )
    .max(100)
    .superRefine((items, ctx) => {
      const seen = new Set<string>();
      items.forEach((item, i) => {
        const key = item.name.toLowerCase();
        if (seen.has(key)) ctx.addIssue({ code: "custom", path: [i, "name"], message: "This name is used twice" });
        seen.add(key);
      });
    }),
});
export type SubServicesInput = z.input<typeof subServicesSchema>;

export const taskTemplateSchema = z.object({
  id: z.string().max(40).optional(),
  serviceId: z.string().min(1).max(40),
  subServiceId: optionalId,
  name: z.string().trim().min(2, "Enter the template name").max(120),
  isActive: z.boolean(),
  steps: z
    .array(
      z.object({
        title: z.string().trim().min(1, "Enter the step name").max(160),
        departmentId: optionalId,
        durationDays: z.coerce.number().int().min(1, "At least 1 day").max(365),
        priority: z.enum(PRIORITIES),
        isClientApproval: z.boolean(),
      }),
    )
    .min(1, "Add at least one step")
    .max(50),
});
export type TaskTemplateInput = z.input<typeof taskTemplateSchema>;

export const masterItemSchema = z.object({
  kind: z.enum(["sector", "leadSource", "department"]),
  id: z.string().max(40).optional(),
  name: z.string().trim().min(2, "Enter a name").max(80),
  isActive: z.boolean(),
});
export type MasterItemInput = z.input<typeof masterItemSchema>;

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "service"
  );
}
