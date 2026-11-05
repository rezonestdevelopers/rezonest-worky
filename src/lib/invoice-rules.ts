import { Decimal, round2, sum, toDecimal, type DecimalLike } from "@/lib/money/decimal";

const MODE_LABEL: Record<string, string> = { UPI: "UPI", BANK_TRANSFER: "NEFT/RTGS/IMPS", CHEQUE: "Cheque", CASH: "Cash", CARD: "Card" };
export const paymentModeLabel = (mode: string) => MODE_LABEL[mode] ?? mode;

/** The dates a statement covers. Unless chosen, from the start of this financial year (1 April) to today. */
export function statementPeriod(from: string | null | undefined, to: string | null | undefined, today: string) {
  const valid = (v: string | null | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
  const year = Number(today.slice(0, 4));
  const fyStart = `${today.slice(5, 7) >= "04" ? year : year - 1}-04-01`;
  const end = valid(to) ? to : today;
  const start = valid(from) ? from : fyStart;
  return start <= end ? { from: start, to: end } : { from: end, to: start };
}

/**
 * Why this can't be issued yet, or an empty list. An issued invoice can never be edited, so these
 * are checked first. A GST tax invoice needs the agency's GSTIN and a SAC code on every line.
 */
export function issueProblems(input: {
  type: "TAX" | "PROFORMA";
  taxMode: string;
  agencyGstin: string | null | undefined;
  lines: { description: string; sacCode: string | null | undefined }[];
  invoiceDateKey: string;
  todayKey: string;
  grandTotal: DecimalLike;
}): string[] {
  const problems: string[] = [];
  if (!input.lines.length) problems.push("Add at least one line.");
  if (!toDecimal(input.grandTotal).greaterThan(0)) problems.push("The total must be more than zero.");
  if (input.invoiceDateKey > input.todayKey) problems.push("The invoice date can't be in the future.");
  if (input.type === "TAX" && (input.taxMode === "INTRA_STATE" || input.taxMode === "INTER_STATE")) {
    if (!input.agencyGstin?.trim()) problems.push("Add your GSTIN in Settings → GST & Bank first.");
    const missing = input.lines.filter((l) => !l.sacCode?.trim());
    if (missing.length) problems.push(`Add a SAC code to: ${missing.map((l) => l.description).join("; ")}.`);
  }
  return problems;
}

/** What milestone percentages apply to: one-time and milestone work before GST. Retainers bill monthly on their own. */
export function milestoneBase(items: { billingType: string; taxableValue: DecimalLike }[]): Decimal {
  return sum(items.filter((i) => i.billingType !== "MONTHLY_RETAINER").map((i) => i.taxableValue));
}

export const milestoneAmount = (base: DecimalLike, percent: DecimalLike): Decimal => round2(toDecimal(base).times(toDecimal(percent)).dividedBy(100));

/** A milestone's invoice lines: its share of each one-time item, keeping that item's GST rate and SAC code. */
export function milestoneLines<T extends { billingType: string; description: string; taxableValue: DecimalLike }>(items: T[], milestone: { name: string; percent: DecimalLike }) {
  return items
    .filter((i) => i.billingType !== "MONTHLY_RETAINER")
    .map((i) => ({ item: i, description: `${i.description}: ${milestone.name} (${toDecimal(milestone.percent).toString()}%)`, rate: milestoneAmount(i.taxableValue, milestone.percent) }))
    .filter((l) => l.rate.greaterThan(0));
}

/** The address a UPI app opens: pays this amount to this ID, marked with the invoice number. */
export function upiLink(input: { upiId: string; payee: string; amount: DecimalLike; note: string }): string {
  const q = (v: string) => encodeURIComponent(v);
  return `upi://pay?pa=${q(input.upiId)}&pn=${q(input.payee)}&am=${toDecimal(input.amount).toFixed(2)}&cu=INR&tn=${q(input.note)}`;
}

/** Fills invoices oldest first until the money runs out. Used to pre-fill the payment form. */
export function suggestAllocations(amount: DecimalLike, invoices: { id: string; balance: DecimalLike }[]): { invoiceId: string; amount: string }[] {
  let left = toDecimal(amount);
  const out: { invoiceId: string; amount: string }[] = [];
  for (const inv of invoices) {
    if (!left.greaterThan(0)) break;
    const take = Decimal.min(left, toDecimal(inv.balance));
    if (take.greaterThan(0)) {
      out.push({ invoiceId: inv.id, amount: take.toFixed(2) });
      left = left.minus(take);
    }
  }
  return out;
}

/** Why these allocations don't fit the payment, or null. */
export function allocationError(input: { amount: DecimalLike; tdsAmount: DecimalLike; allocations: { amount: DecimalLike; tdsAmount: DecimalLike }[] }): string | null {
  const cash = sum(input.allocations.map((a) => a.amount));
  const tds = sum(input.allocations.map((a) => a.tdsAmount));
  if (cash.greaterThan(toDecimal(input.amount))) return "You've applied more than the amount received.";
  if (!tds.equals(toDecimal(input.tdsAmount))) return "All of the TDS must be applied to invoices, because TDS is deducted against an invoice.";
  return null;
}

/** What's left of a payment to use later: the client's advance. */
export const advanceLeft = (amount: DecimalLike, allocations: { amount: DecimalLike }[]): Decimal => toDecimal(amount).minus(sum(allocations.map((a) => a.amount)));

export type LedgerKind = "INVOICE" | "PAYMENT" | "TDS" | "CREDIT_NOTE";
export type LedgerEntry = { dateKey: string; kind: LedgerKind; reference: string; description: string; debit: DecimalLike; credit: DecimalLike };

const KIND_ORDER: Record<LedgerKind, number> = { INVOICE: 0, CREDIT_NOTE: 1, PAYMENT: 2, TDS: 3 };

/**
 * A client's statement. Entries before the period add up to the opening balance. A positive balance
 * means they owe you; negative means they've paid in advance.
 */
export function buildLedger(entries: LedgerEntry[], from: string, to: string) {
  const sorted = [...entries].sort((a, b) => a.dateKey.localeCompare(b.dateKey) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.reference.localeCompare(b.reference));
  const net = (e: LedgerEntry) => toDecimal(e.debit).minus(toDecimal(e.credit));
  const opening = sum(sorted.filter((e) => e.dateKey < from).map(net));
  let balance = opening;
  const rows = sorted
    .filter((e) => e.dateKey >= from && e.dateKey <= to)
    .map((e) => {
      balance = balance.plus(net(e));
      return { ...e, debit: toDecimal(e.debit), credit: toDecimal(e.credit), balance };
    });
  return { opening, rows, closing: balance, totalDebit: sum(rows.map((r) => r.debit)), totalCredit: sum(rows.map((r) => r.credit)) };
}

export const AGEING_BUCKETS = ["notDue", "d1_30", "d31_60", "d61_90", "d90"] as const;
export type AgeingKey = (typeof AGEING_BUCKETS)[number];
export const AGEING_LABEL: Record<AgeingKey, string> = { notDue: "Not yet due", d1_30: "1–30 days", d31_60: "31–60 days", d61_90: "61–90 days", d90: "90+ days" };

/** Which column a balance goes in, by days past its due date. */
export function ageingKey(daysPastDue: number): AgeingKey {
  if (daysPastDue <= 0) return "notDue";
  if (daysPastDue <= 30) return "d1_30";
  if (daysPastDue <= 60) return "d31_60";
  return daysPastDue <= 90 ? "d61_90" : "d90";
}
