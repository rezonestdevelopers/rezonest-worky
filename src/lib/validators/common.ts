import { z } from "zod";

export const optionalText = (max: number) =>
  z.string().trim().max(max, `Maximum ${max} characters`).optional().or(z.literal("")).transform((v) => v || null);

/** Dropdown value: blank means "none". */
export const optionalId = z.string().trim().max(40).optional().or(z.literal("")).transform((v) => v || null);

export const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address")
  .max(160)
  .optional()
  .or(z.literal(""))
  .transform((v) => v || null);

export const optionalPhone = z
  .string()
  .trim()
  .optional()
  .or(z.literal(""))
  .transform((v) => v || null)
  .refine((v) => {
    if (v === null) return true;
    const digits = v.replace(/\D/g, "").length;
    return /^[+\d][\d\s()-]*$/.test(v) && digits >= 7 && digits <= 15;
  }, "Enter a valid phone number");

export function isValidDateKey(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export const optionalDateKey = z
  .string()
  .trim()
  .optional()
  .or(z.literal(""))
  .transform((v) => v || null)
  .refine((v) => v === null || isValidDateKey(v), "Enter a valid date");

const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/;
const cleanMoney = (v: string | number | undefined | null) => String(v ?? "").trim().replace(/[₹,\s]/g, "");

/** Rupee amount kept as text, so it reaches the database without floating-point rounding. */
export const moneyString = z
  .union([z.string(), z.number()])
  .transform(cleanMoney)
  .refine((v) => MONEY_RE.test(v), "Enter an amount like 25000 or 25000.50");

export const optionalMoney = z
  .union([z.string(), z.number()])
  .nullish()
  .transform(cleanMoney)
  .refine((v) => v === "" || MONEY_RE.test(v), "Enter an amount like 25000 or 25000.50")
  .transform((v) => v || null);
