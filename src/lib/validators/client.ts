import { z } from "zod";
import { FOREIGN_STATE_CODE, stateName } from "@/lib/india-states";
import { optionalEmail, optionalId, optionalPhone, optionalText } from "./common";
import { GSTIN_RE, PAN_RE } from "./settings";

const upperOptional = z
  .string()
  .trim()
  .toUpperCase()
  .optional()
  .or(z.literal(""))
  .transform((v) => v || null);

const clientFields = z.object({
  companyName: z.string().trim().min(2, "Enter the company name").max(160),
  phone: optionalPhone,
  whatsapp: optionalPhone,
  email: optionalEmail,
  website: optionalText(160),
  sectorId: optionalId,
  city: optionalText(80),
  country: z.string().trim().min(2, "Enter the country").max(60),
  stateCode: z.string().trim().max(2),
  billingAddress: optionalText(500),
  pincode: optionalText(12),
  gstin: upperOptional,
  pan: upperOptional,
  leadSourceId: optionalId,
  accountManagerId: optionalId,
  tags: z
    .string()
    .max(300)
    .optional()
    .or(z.literal(""))
    .transform((v) => Array.from(new Set((v ?? "").split(",").map((t) => t.trim()).filter(Boolean)))),
  notes: optionalText(5000),
  status: z.enum(["ACTIVE", "INACTIVE"]),
});

type ClientFields = z.output<typeof clientFields>;

/** GST-related checks. These decide tax on invoices, so wrong values are rejected rather than guessed. */
function checkTaxDetails(c: ClientFields, ctx: z.RefinementCtx) {
  const india = c.country.toLowerCase() === "india";
  if (india && !stateName(c.stateCode)) {
    ctx.addIssue({ code: "custom", path: ["stateCode"], message: "Select the client's state" });
  }
  if (!india && c.gstin) {
    ctx.addIssue({ code: "custom", path: ["gstin"], message: "GSTIN applies only to clients in India" });
  }
  if (c.gstin && !GSTIN_RE.test(c.gstin)) {
    ctx.addIssue({ code: "custom", path: ["gstin"], message: "Invalid GSTIN format (e.g. 27ABCDE1234F1Z5)" });
  } else if (c.gstin && india && stateName(c.stateCode) && c.gstin.slice(0, 2) !== c.stateCode) {
    ctx.addIssue({
      code: "custom",
      path: ["gstin"],
      message: `This GSTIN is for state code ${c.gstin.slice(0, 2)}, which doesn't match the selected state`,
    });
  }
  if (c.pan && !PAN_RE.test(c.pan)) {
    ctx.addIssue({ code: "custom", path: ["pan"], message: "Invalid PAN format (e.g. ABCDE1234F)" });
  } else if (c.pan && c.gstin && GSTIN_RE.test(c.gstin) && c.gstin.slice(2, 12) !== c.pan) {
    ctx.addIssue({ code: "custom", path: ["pan"], message: "PAN doesn't match the PAN inside the GSTIN" });
  }
}

function withState<T extends ClientFields>(c: T) {
  const india = c.country.toLowerCase() === "india";
  return {
    ...c,
    country: india ? "India" : c.country,
    stateCode: india ? c.stateCode : FOREIGN_STATE_CODE,
    state: india ? (stateName(c.stateCode) ?? "") : "Outside India",
  };
}

export const clientSchema = clientFields.superRefine(checkTaxDetails).transform(withState);

/** New clients also get their first (primary) contact person. */
export const clientCreateSchema = clientFields
  .extend({
    contactName: z.string().trim().min(2, "Enter the main contact person's name").max(120),
    contactDesignation: optionalText(80),
  })
  .superRefine(checkTaxDetails)
  .transform(withState);

export type ClientInput = z.input<typeof clientSchema>;
export type ClientData = z.output<typeof clientSchema>;
export type ClientCreateInput = z.input<typeof clientCreateSchema>;
export type ClientCreateData = z.output<typeof clientCreateSchema>;

export const contactSchema = z.object({
  name: z.string().trim().min(2, "Enter the contact's name").max(120),
  designation: optionalText(80),
  phone: optionalPhone,
  whatsapp: optionalPhone,
  email: optionalEmail,
  isPrimary: z.boolean(),
});
export type ContactInput = z.input<typeof contactSchema>;
