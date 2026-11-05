import { formatDateKey } from "@/lib/dates";
import { round2, toDecimal, type DecimalLike } from "@/lib/money/decimal";
import { formatINR } from "@/lib/money/format";
import { computeTotals, type DiscountType, type TaxMode } from "@/lib/money/gst";
import { amountInWords } from "@/lib/money/words";

const BILLING_LABEL: Record<string, string> = {
  ONE_TIME: "One-time",
  MONTHLY_RETAINER: "Per month",
  PER_UNIT: "Per unit",
  MILESTONE: "Milestone based",
  ANNUAL_RENEWAL: "Per year",
};
const FORMAT_LABEL: Record<string, string> = { STATIC_POST: "posts", CAROUSEL: "carousels", REEL: "reels", STORY: "stories", VIDEO: "videos" };

export interface OfferDocInput {
  number: string;
  title: string;
  version: number;
  offerDate: string;
  validUntil: string;
  durationMonths?: number | null;
  paymentTerms?: string | null;
  terms?: string | null;
  notes?: string | null;
  taxMode: TaxMode;
  recipient: { name: string; contact?: string | null; address?: string | null; state?: string | null; gstin?: string | null; email?: string | null; phone?: string | null };
  agency: { name: string; address: string; city?: string | null; state: string; pincode?: string | null; email?: string | null; phone?: string | null; website?: string | null; gstin?: string | null };
  items: {
    description: string;
    billingType: string;
    quantity: DecimalLike;
    unit: string;
    rate: DecimalLike;
    discountType?: DiscountType | null;
    discountValue?: DecimalLike;
    gstRate: DecimalLike;
    sacCode?: string | null;
    durationMonths?: number | null;
    deliverables?: { format: string; qtyPerMonth: number }[] | null;
  }[];
  milestones: { name: string; percent: DecimalLike }[];
}

/**
 * The one place an offer's figures become text. The internal page, the client's page and the PDF
 * all print this, so they can't disagree.
 */
export function buildOfferDocument(input: OfferDocInput) {
  const totals = computeTotals(
    input.items.map((i) => ({ quantity: i.quantity, rate: i.rate, discountType: i.discountType, discountValue: i.discountValue, gstRate: i.gstRate })),
    input.taxMode,
  );
  const lines = input.items.map((item, i) => {
    const r = totals.lines[i];
    const pkg = (item.deliverables ?? []).filter((d) => d.qtyPerMonth > 0).map((d) => `${d.qtyPerMonth} ${FORMAT_LABEL[d.format] ?? d.format}`);
    const details = [
      BILLING_LABEL[item.billingType] ?? item.billingType,
      item.durationMonths ? `${item.durationMonths} month${item.durationMonths === 1 ? "" : "s"}` : null,
      pkg.length ? `${pkg.join(" + ")} per month` : null,
      item.sacCode ? `SAC ${item.sacCode}` : null,
    ].filter(Boolean);
    return {
      description: item.description,
      details: details.join(" · "),
      quantity: `${toDecimal(item.quantity).toString()} ${item.unit}`,
      rate: formatINR(item.rate),
      discount: r.discount.isZero() ? null : formatINR(r.discount),
      taxable: formatINR(r.taxable),
      gst: input.taxMode === "NO_GST" || input.taxMode === "EXPORT" ? "—" : `${toDecimal(item.gstRate).toString()}%`,
      total: formatINR(r.total),
    };
  });

  // A share of the one-time work before GST: retainers bill monthly on their own. Each is rounded
  // to paise, and the last takes what's left, so they always add up to that work's value.
  const milestoneTotal = input.items.reduce((acc, item, i) => (item.billingType === "MONTHLY_RETAINER" ? acc : acc.plus(totals.lines[i].taxable)), toDecimal(0));
  let allocated = toDecimal(0);
  const milestones = input.milestones.map((m, i) => {
    const amount = i === input.milestones.length - 1 ? milestoneTotal.minus(allocated) : round2(milestoneTotal.times(toDecimal(m.percent)).dividedBy(100));
    allocated = allocated.plus(amount);
    return { name: m.name, percent: `${toDecimal(m.percent).toString()}%`, amount: formatINR(amount) };
  });

  const summary: { label: string; value: string }[] = [{ label: "Subtotal", value: formatINR(totals.subtotal) }];
  if (!totals.discountTotal.isZero()) summary.push({ label: "Discount", value: `- ${formatINR(totals.discountTotal)}` });
  summary.push({ label: "Taxable value", value: formatINR(totals.taxableTotal) });
  if (input.taxMode === "INTRA_STATE") {
    summary.push({ label: "CGST", value: formatINR(totals.cgstTotal) }, { label: "SGST", value: formatINR(totals.sgstTotal) });
  } else if (input.taxMode === "INTER_STATE") {
    summary.push({ label: "IGST", value: formatINR(totals.igstTotal) });
  }
  if (!totals.roundOff.isZero()) {
    summary.push({ label: "Round-off", value: `${totals.roundOff.isNegative() ? "- " : ""}${formatINR(totals.roundOff.abs())}` });
  }

  const monthly = input.items.filter((i) => i.billingType === "MONTHLY_RETAINER").length;
  let retainerNote: string | null = null;
  if (monthly && monthly === input.items.length) retainerNote = "Items billed per month are shown for one month. The total is the amount for one month.";
  else if (monthly) retainerNote = "Items billed per month are shown for one month and repeat each month. The total includes one month of those items.";

  return {
    number: input.number,
    version: input.version,
    title: input.title,
    offerDate: formatDateKey(input.offerDate),
    validUntil: formatDateKey(input.validUntil),
    durationMonths: input.durationMonths ?? null,
    paymentTerms: input.paymentTerms ?? null,
    terms: input.terms ?? null,
    notes: input.notes ?? null,
    recipient: input.recipient,
    agency: input.agency,
    lines,
    milestones,
    summary,
    grandTotal: formatINR(totals.grandTotal),
    amountInWords: amountInWords(totals.grandTotal),
    taxNote:
      input.taxMode === "EXPORT"
        ? "Export of services. No GST charged."
        : input.taxMode === "NO_GST"
          ? "GST not charged on this offer."
          : null,
    retainerNote,
  };
}
export type OfferDocument = ReturnType<typeof buildOfferDocument>;
