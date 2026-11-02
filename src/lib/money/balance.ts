import { Decimal, toDecimal, type DecimalLike } from "./decimal";

export type InvoiceStatusLite = "DRAFT" | "ISSUED" | "CANCELLED" | "CONVERTED";
export type PaymentStatusLite = "UNPAID" | "PARTIALLY_PAID" | "PAID" | "OVERDUE" | "CANCELLED";

/** Balance = total − payments − TDS − credit notes (never below zero). */
export function invoiceBalance(input: {
  grandTotal: DecimalLike;
  amountPaid: DecimalLike;
  tdsTotal: DecimalLike;
  creditedTotal: DecimalLike;
}): Decimal {
  const b = toDecimal(input.grandTotal)
    .minus(toDecimal(input.amountPaid))
    .minus(toDecimal(input.tdsTotal))
    .minus(toDecimal(input.creditedTotal));
  return b.isNegative() ? new Decimal(0) : b;
}

/**
 * Payment status of an invoice.
 * - Cancelled invoices → CANCELLED
 * - Balance 0 → PAID
 * - Past due date (strictly after) with a balance → OVERDUE
 * - Some amount settled → PARTIALLY_PAID, else UNPAID
 * `dueDateKey` and `todayKey` are IST calendar dates "YYYY-MM-DD".
 */
export function computePaymentStatus(input: {
  status: InvoiceStatusLite;
  grandTotal: DecimalLike;
  amountPaid: DecimalLike;
  tdsTotal: DecimalLike;
  creditedTotal: DecimalLike;
  dueDateKey: string;
  todayKey: string;
}): PaymentStatusLite {
  if (input.status === "CANCELLED") return "CANCELLED";
  const balance = invoiceBalance(input);
  if (balance.isZero()) return "PAID";
  if (input.todayKey > input.dueDateKey) return "OVERDUE";
  const settled = toDecimal(input.amountPaid)
    .plus(toDecimal(input.tdsTotal))
    .plus(toDecimal(input.creditedTotal));
  return settled.greaterThan(0) ? "PARTIALLY_PAID" : "UNPAID";
}

/** Ageing bucket by days past due (0–30, 31–60, 61–90, 90+). Not-yet-due counts as 0–30. */
export type AgeingBucket = "0-30" | "31-60" | "61-90" | "90+";
export function ageingBucket(daysPastDue: number): AgeingBucket {
  if (daysPastDue <= 30) return "0-30";
  if (daysPastDue <= 60) return "31-60";
  if (daysPastDue <= 90) return "61-90";
  return "90+";
}
