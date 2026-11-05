import { z } from "zod";
import { DOCUMENT_CATEGORIES } from "@/lib/file-types";
import { EXPENSE_CATEGORIES } from "@/lib/profit";
import { isValidDateKey, moneyString, optionalDateKey, optionalId, optionalMoney, optionalText } from "./common";

export const expenseSchema = z
  .object({
    date: z.string().trim().refine(isValidDateKey, "Enter a valid date"),
    category: z.enum(EXPENSE_CATEGORIES),
    description: z.string().trim().min(2, "Describe this expense").max(300),
    vendor: optionalText(120),
    amount: moneyString.refine((v) => Number(v) > 0, "Enter an amount more than zero"),
    gstPaid: optionalMoney,
    clientId: optionalId,
    projectId: optionalId,
  });
export type ExpenseInput = z.input<typeof expenseSchema>;
export type ExpenseData = z.output<typeof expenseSchema>;

export const COMMUNICATION_TYPES = ["CALL", "MEETING", "WHATSAPP", "EMAIL", "OTHER"] as const;

export const communicationSchema = z
  .object({
    clientId: optionalId,
    leadId: optionalId,
    type: z.enum(COMMUNICATION_TYPES),
    date: z.string().trim().refine(isValidDateKey, "Enter a valid date"),
    summary: z.string().trim().min(2, "Write what was said").max(2000),
    nextAction: optionalText(300),
    nextActionDate: optionalDateKey,
  })
  .superRefine((c, ctx) => {
    if (!c.clientId === !c.leadId) ctx.addIssue({ code: "custom", path: ["clientId"], message: "This must belong to one client or lead" });
    if (c.nextActionDate && !c.nextAction) ctx.addIssue({ code: "custom", path: ["nextAction"], message: "Say what needs doing on that date" });
    if (c.nextAction && !c.nextActionDate) ctx.addIssue({ code: "custom", path: ["nextActionDate"], message: "Choose when, so you get a reminder" });
  });
export type CommunicationInput = z.input<typeof communicationSchema>;
export type CommunicationData = z.output<typeof communicationSchema>;

export const documentCategorySchema = z.enum(DOCUMENT_CATEGORIES);
