import { z } from "zod";
import { Decimal } from "@/lib/money/decimal";
import { computeLine } from "@/lib/money/gst";
import { BILLING_TYPES } from "./catalogue";
import { isValidDateKey, moneyString, optionalDateKey, optionalId, optionalText } from "./common";

export const CONTENT_FORMATS = ["STATIC_POST", "CAROUSEL", "REEL", "STORY", "VIDEO"] as const;

const dateKey = z.string().trim().refine(isValidDateKey, "Enter a valid date");

const offerItem = z
  .object({
    serviceId: optionalId,
    subServiceId: optionalId,
    description: z.string().trim().min(2, "Describe this item").max(500),
    billingType: z.enum(BILLING_TYPES),
    quantity: z
      .union([z.string(), z.number()])
      .transform((v) => String(v).trim())
      .refine((v) => /^\d{1,8}(\.\d{1,2})?$/.test(v) && Number(v) > 0, "Enter a quantity above 0"),
    unit: z.string().trim().min(1, "Enter a unit").max(30),
    rate: moneyString,
    discountType: z
      .enum(["PERCENT", "AMOUNT"])
      .or(z.literal(""))
      .nullish()
      .transform((v) => v || null),
    discountValue: z
      .union([z.string(), z.number()])
      .nullish()
      .transform((v) => String(v ?? "").trim().replace(/[₹,\s]/g, "") || "0")
      .refine((v) => /^\d{1,12}(\.\d{1,2})?$/.test(v), "Enter a valid discount"),
    gstRate: z
      .union([z.string(), z.number()])
      .transform((v) => String(v).trim())
      .refine((v) => /^\d{1,2}(\.\d{1,2})?$/.test(v) && Number(v) <= 28, "GST rate must be 0 to 28"),
    sacCode: optionalText(8),
    durationMonths: z
      .union([z.string(), z.number()])
      .nullish()
      .transform((v) => (v === null || v === undefined || v === "" ? null : Number(v)))
      .refine((v) => v === null || (Number.isInteger(v) && v >= 1 && v <= 120), "Months must be 1 to 120"),
    deliverables: z
      .array(z.object({ format: z.enum(CONTENT_FORMATS), qtyPerMonth: z.coerce.number().int().min(0).max(500) }))
      .max(5)
      .default([])
      .transform((list) => list.filter((d) => d.qtyPerMonth > 0)),
  })
  .superRefine((item, ctx) => {
    // The same calculator the totals use decides whether the discount is possible.
    try {
      computeLine({ quantity: item.quantity, rate: item.rate, discountType: item.discountType, discountValue: item.discountValue, gstRate: item.gstRate }, "NO_GST");
    } catch (e) {
      ctx.addIssue({ code: "custom", path: ["discountValue"], message: e instanceof Error ? e.message : "Check this item" });
    }
  });

const milestone = z.object({
  name: z.string().trim().min(1, "Name this milestone").max(120),
  percent: z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => /^\d{1,3}(\.\d{1,2})?$/.test(v) && Number(v) > 0 && Number(v) <= 100, "Enter a percentage from 1 to 100"),
});

const offerFields = z.object({
  title: z.string().trim().min(3, "Give the offer a title").max(200),
  offerDate: dateKey,
  validUntil: dateKey,
  durationMonths: z
    .union([z.string(), z.number()])
    .nullish()
    .transform((v) => (v === null || v === undefined || v === "" ? null : Number(v)))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 1 && v <= 120), "Months must be 1 to 120"),
  paymentTerms: optionalText(1000),
  terms: optionalText(8000),
  notes: optionalText(2000),
  gstEnabled: z.boolean(),
  supplyStateCode: z.string().trim().max(2).optional().or(z.literal("")).transform((v) => v || null),
  items: z.array(offerItem).min(1, "Add at least one item").max(50),
  milestones: z.array(milestone).max(12),
});

type Fields = z.output<typeof offerFields>;

function checkCommon(o: Fields, ctx: z.RefinementCtx) {
  if (o.validUntil < o.offerDate) ctx.addIssue({ code: "custom", path: ["validUntil"], message: "Valid-until can't be before the offer date" });
  if (o.milestones.length) {
    const total = o.milestones.reduce((s, m) => s.plus(m.percent), new Decimal(0));
    if (!total.equals(100)) ctx.addIssue({ code: "custom", path: ["milestones"], message: `Payment milestones must add up to 100%. They add up to ${total.toString()}%` });
  }
}

export const offerSchema = offerFields
  .extend({ clientId: optionalId, leadId: optionalId })
  .superRefine((o, ctx) => {
    checkCommon(o, ctx);
    if (!o.clientId && !o.leadId) ctx.addIssue({ code: "custom", path: ["recipient"], message: "Choose who this offer is for" });
    if (o.clientId && o.leadId) ctx.addIssue({ code: "custom", path: ["recipient"], message: "Choose either a client or a lead" });
  });
export type OfferInput = z.input<typeof offerSchema>;
export type OfferData = z.output<typeof offerSchema>;

/** A reusable package, such as "Starter Social Media". It isn't addressed to anyone. */
export const templateSchema = offerFields
  .extend({ templateName: z.string().trim().min(2, "Name this template").max(120) })
  .superRefine(checkCommon);
export type TemplateInput = z.input<typeof templateSchema>;
export type TemplateData = z.output<typeof templateSchema>;

export const sendOfferSchema = z.object({
  offerId: z.string().min(1).max(40),
  channel: z.enum(["email", "manual"]),
  to: z.string().trim().toLowerCase().email("Enter a valid email address").optional().or(z.literal("")),
  followUpDate: dateKey,
  changeNote: optionalText(500),
});
export type SendOfferInput = z.input<typeof sendOfferSchema>;

export const offerStatusSchema = z.object({
  offerId: z.string().min(1).max(40),
  to: z.enum(["ON_HOLD", "SENT", "ACCEPTED", "REJECTED"]),
  followUpDate: optionalDateKey,
  reason: optionalText(500),
  acceptedByName: optionalText(120),
});
export type OfferStatusInput = z.input<typeof offerStatusSchema>;

export const publicAcceptSchema = z.object({
  token: z.string().max(64),
  name: z.string().trim().min(2, "Please enter your name").max(120),
  agreed: z.literal(true, { errorMap: () => ({ message: "Please tick the box to confirm" }) }),
});

export const publicChangesSchema = z.object({
  token: z.string().max(64),
  name: z.string().trim().min(2, "Please enter your name").max(120),
  comment: z.string().trim().min(5, "Please tell us what you'd like changed").max(2000),
});
