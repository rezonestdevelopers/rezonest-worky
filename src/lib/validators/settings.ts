import { z } from "zod";

export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const UPI_RE = /^[\w.-]{2,256}@[A-Za-z]{2,64}$/;

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal("")).transform((v) => v || null);
const upper = (re: RegExp, msg: string) =>
  z.string().trim().toUpperCase().optional().or(z.literal("")).transform((v) => v || null).refine((v) => v === null || re.test(v), msg);

const intList = (min: number, max: number) =>
  z
    .string()
    .trim()
    .transform((v) => v.split(/[,\s]+/).filter(Boolean).map(Number))
    .refine((arr) => arr.length > 0 && arr.every((n) => Number.isInteger(n) && n >= min && n <= max), `Enter whole numbers between ${min} and ${max}, separated by commas`)
    .transform((arr) => Array.from(new Set(arr)).sort((a, b) => b - a));

const numberFormat = z
  .string()
  .trim()
  .min(3)
  .max(40)
  .refine((v) => v.includes("{SEQ}"), "Must contain {SEQ}")
  .refine((v) => /^[A-Za-z0-9/_\-{}]+$/.test(v), "Only letters, numbers, / - _ and {FY} {SEQ}");

export const settingsSchema = z
  .object({
    agencyName: z.string().trim().min(2).max(120),
    address: z.string().trim().min(5).max(400),
    city: optionalText(60),
    state: z.string().trim().min(2).max(60),
    stateCode: z.string().trim().regex(/^\d{2}$/, "2-digit GST state code, e.g. 27"),
    pincode: z.string().trim().regex(/^\d{6}$/, "6-digit PIN code").optional().or(z.literal("")).transform((v) => v || null),
    email: z.string().trim().email().optional().or(z.literal("")).transform((v) => v || null),
    phone: optionalText(30),
    website: optionalText(120),
    gstin: upper(GSTIN_RE, "Invalid GSTIN format (e.g. 27ABCDE1234F1Z5)"),
    pan: upper(PAN_RE, "Invalid PAN format (e.g. ABCDE1234F)"),
    bankName: optionalText(80),
    bankAccountName: optionalText(120),
    bankAccountNumber: z.string().trim().regex(/^\d{6,20}$/, "6–20 digits").optional().or(z.literal("")).transform((v) => v || null),
    bankIfsc: upper(IFSC_RE, "Invalid IFSC (e.g. HDFC0001234)"),
    bankBranch: optionalText(80),
    upiId: z.string().trim().optional().or(z.literal("")).transform((v) => v || null).refine((v) => v === null || UPI_RE.test(v), "Invalid UPI ID (e.g. rezonest@okhdfcbank)"),
    quotationTerms: optionalText(5000),
    invoiceTerms: optionalText(5000),
    quotationFormat: numberFormat,
    proformaFormat: numberFormat,
    invoiceFormat: numberFormat,
    creditNoteFormat: numberFormat,
    seqPadding: z.coerce.number().int().min(1).max(8),
    defaultGstRate: z.coerce.number().min(0).max(28),
    gstEnabledByDefault: z.boolean(),
    defaultPaymentTermsDays: z.coerce.number().int().min(0).max(180),
    paymentTermOptions: intList(0, 180),
    offerValidityDays: z.coerce.number().int().min(1).max(180),
    digestTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour)"),
    digestEnabled: z.boolean(),
    workingDays: z.array(z.number().int().min(1).max(7)).min(1, "Pick at least one working day"),
    renewalAlertDays: intList(1, 365),
    approvalWaitDays: z.coerce.number().int().min(1).max(30),
    dueSoonDays: z.coerce.number().int().min(1).max(30),
    adBudgetAlertPercent: z.coerce.number().int().min(50).max(100),
    retainerEndingDays: z.coerce.number().int().min(1).max(120),
    shortfallDaysLeft: z.coerce.number().int().min(1).max(15),
    retainerTaskDay: z.coerce.number().int().min(1).max(28),
    accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Hex colour like #D7202A"),
  })
  .refine((s) => !s.gstin || s.gstin.slice(0, 2) === s.stateCode, { message: "GSTIN must start with your state code", path: ["gstin"] })
  .refine((s) => !s.gstin || !s.pan || s.gstin.slice(2, 12) === s.pan, { message: "PAN does not match the PAN inside your GSTIN", path: ["pan"] });

export type SettingsInput = z.input<typeof settingsSchema>;
export type SettingsOutput = z.output<typeof settingsSchema>;
