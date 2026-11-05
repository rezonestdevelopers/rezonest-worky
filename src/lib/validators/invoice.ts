import { z } from "zod";
import { computeLine } from "@/lib/money/gst";
import { isValidDateKey, moneyString, optionalId, optionalText } from "./common";

const dateKey = z.string().trim().refine(isValidDateKey, "Enter a valid date");
const id = z.string().min(1).max(60);
const clean = (v: unknown) => String(v ?? "").trim().replace(/[₹,\s]/g, "");

const number = (label: string, max: number) =>
  z
    .union([z.string(), z.number()])
    .transform(clean)
    .refine((v) => /^\d{1,10}(\.\d{1,2})?$/.test(v) && Number(v) <= max, `Enter a valid ${label}`);

export const invoiceItemSchema = z
  .object({
    id: z.string().max(60).optional(),
    serviceId: optionalId,
    description: z.string().trim().min(2, "Describe this line").max(500),
    sacCode: z
      .string()
      .trim()
      .optional()
      .or(z.literal(""))
      .transform((v) => v || null)
      .refine((v) => v === null || /^\d{4,8}$/.test(v), "A SAC code is 4 to 8 digits"),
    quantity: number("quantity", 1_000_000),
    unit: optionalText(30),
    rate: moneyString,
    discountType: z.enum(["PERCENT", "AMOUNT"]).or(z.literal("")).nullish().transform((v) => v || null),
    discountValue: z.union([z.string(), z.number()]).nullish().transform(clean).refine((v) => v === "" || /^\d{1,12}(\.\d{1,2})?$/.test(v), "Enter a valid discount").transform((v) => v || "0"),
    gstRate: number("GST rate", 100),
  })
  .superRefine((l, ctx) => {
    try {
      computeLine({ quantity: l.quantity, rate: l.rate, discountType: l.discountType, discountValue: l.discountValue, gstRate: l.gstRate }, "INTER_STATE");
    } catch (e) {
      ctx.addIssue({ code: "custom", path: ["discountValue"], message: e instanceof Error ? e.message : "Check this line" });
    }
  });

export const invoiceSchema = z
  .object({
    clientId: z.string().min(1, "Choose a client").max(60),
    projectId: optionalId,
    type: z.enum(["TAX", "PROFORMA"]),
    gstEnabled: z.boolean(),
    invoiceDate: dateKey,
    dueDate: dateKey,
    terms: optionalText(5000),
    notes: optionalText(2000),
    items: z.array(invoiceItemSchema).min(1, "Add at least one line").max(100),
  })
  .superRefine((i, ctx) => {
    if (i.dueDate < i.invoiceDate) ctx.addIssue({ code: "custom", path: ["dueDate"], message: "The due date can't be before the invoice date" });
  });
export type InvoiceInput = z.input<typeof invoiceSchema>;
export type InvoiceData = z.output<typeof invoiceSchema>;

export const reasonSchema = z.string().trim().min(3, "Please give a reason").max(500);

export const creditNoteSchema = z.object({
  invoiceId: id,
  date: dateKey,
  reason: reasonSchema,
  lines: z.array(z.object({ itemId: id, taxable: z.union([z.string(), z.number()]).transform(clean).refine((v) => v === "" || /^\d{1,12}(\.\d{1,2})?$/.test(v), "Enter an amount") })).min(1).max(100),
});
export type CreditNoteInput = z.input<typeof creditNoteSchema>;

export const PAYMENT_MODES = ["UPI", "BANK_TRANSFER", "CHEQUE", "CASH", "CARD"] as const;
const amount = z.union([z.string(), z.number()]).nullish().transform(clean).refine((v) => v === "" || /^\d{1,12}(\.\d{1,2})?$/.test(v), "Enter an amount like 25000 or 25000.50").transform((v) => v || "0");

export const allocationSchema = z.object({ invoiceId: id, amount, tdsAmount: amount });

export const paymentSchema = z
  .object({
    clientId: z.string().min(1, "Choose a client").max(60),
    date: dateKey,
    amount,
    tdsAmount: amount,
    tdsSection: optionalText(20),
    mode: z.enum(PAYMENT_MODES),
    reference: optionalText(100),
    notes: optionalText(1000),
    allocations: z.array(allocationSchema).max(200),
    allowDuplicate: z.boolean().optional(),
  })
  .superRefine((p, ctx) => {
    if (Number(p.amount) === 0 && Number(p.tdsAmount) === 0) ctx.addIssue({ code: "custom", path: ["amount"], message: "Enter the amount received" });
  });
export type PaymentInput = z.input<typeof paymentSchema>;
export type PaymentData = z.output<typeof paymentSchema>;
