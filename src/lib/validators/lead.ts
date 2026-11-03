import { z } from "zod";
import { optionalDateKey, optionalEmail, optionalId, optionalMoney, optionalPhone, optionalText } from "./common";

export const leadSchema = z
  .object({
    contactName: z.string().trim().min(2, "Enter the contact person's name").max(120),
    companyName: optionalText(160),
    phone: optionalPhone,
    whatsapp: optionalPhone,
    email: optionalEmail,
    sectorId: optionalId,
    city: optionalText(80),
    leadSourceId: optionalId,
    servicesInterested: z.array(z.string().max(40)).max(20),
    approxBudget: optionalMoney,
    requirementNotes: optionalText(5000),
    nextFollowUpDate: optionalDateKey,
    ownerId: optionalId,
  })
  .refine((l) => l.phone || l.whatsapp || l.email, {
    message: "Enter at least a phone, WhatsApp or email",
    path: ["phone"],
  });

export type LeadInput = z.input<typeof leadSchema>;
export type LeadData = z.output<typeof leadSchema>;

export const stageChangeSchema = z.object({
  leadId: z.string().min(1).max(40),
  stage: z.enum(["NEW", "CONTACTED", "REQUIREMENT_DISCUSSED", "OFFER_SENT", "WON", "LOST"]),
  lostReason: optionalText(500),
});
export type StageChangeInput = z.input<typeof stageChangeSchema>;
