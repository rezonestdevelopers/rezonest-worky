import { Decimal, round2, sum, toDecimal, type DecimalLike } from "./decimal";

export type TaxMode = "INTRA_STATE" | "INTER_STATE" | "NO_GST" | "EXPORT";
export type DiscountType = "PERCENT" | "AMOUNT";

export interface LineInput {
  quantity: DecimalLike;
  rate: DecimalLike;
  discountType?: DiscountType | null;
  discountValue?: DecimalLike;
  /** GST rate in percent, e.g. 18 */
  gstRate: DecimalLike;
}

export interface LineResult {
  gross: Decimal; // qty × rate
  discount: Decimal;
  taxable: Decimal; // gross − discount
  cgst: Decimal;
  sgst: Decimal;
  igst: Decimal;
  tax: Decimal;
  total: Decimal; // taxable + tax
}

export interface TotalsResult {
  lines: LineResult[];
  subtotal: Decimal; // Σ gross
  discountTotal: Decimal;
  taxableTotal: Decimal;
  cgstTotal: Decimal;
  sgstTotal: Decimal;
  igstTotal: Decimal;
  taxTotal: Decimal;
  totalBeforeRound: Decimal;
  roundOff: Decimal; // may be negative
  grandTotal: Decimal; // whole rupees when rounding is on
}

/**
 * Decide CGST+SGST vs IGST.
 * - GST switched off → NO_GST
 * - Client outside India → EXPORT (zero-rated, no tax charged)
 * - Same state code as agency → INTRA_STATE (CGST + SGST)
 * - Otherwise → INTER_STATE (IGST)
 */
export function determineTaxMode(opts: {
  gstEnabled: boolean;
  agencyStateCode: string;
  clientStateCode?: string | null;
  clientCountry?: string | null;
}): TaxMode {
  if (!opts.gstEnabled) return "NO_GST";
  const country = (opts.clientCountry ?? "India").trim().toLowerCase();
  if (country !== "india") return "EXPORT";
  if (!opts.clientStateCode) return "INTRA_STATE";
  return opts.clientStateCode.trim() === opts.agencyStateCode.trim() ? "INTRA_STATE" : "INTER_STATE";
}

/**
 * One line: discount is applied BEFORE GST (reduces taxable value).
 * Each tax component is rounded to paise. For intra-state, CGST and SGST are
 * each half the rate on the same taxable value, so they are always equal.
 */
export function computeLine(line: LineInput, mode: TaxMode): LineResult {
  const qty = toDecimal(line.quantity);
  const rate = toDecimal(line.rate);
  const gstRate = toDecimal(line.gstRate);
  const discountValue = toDecimal(line.discountValue);

  if (qty.isNegative()) throw new Error("Quantity cannot be negative");
  if (rate.isNegative()) throw new Error("Rate cannot be negative");
  if (gstRate.isNegative() || gstRate.greaterThan(100)) throw new Error("Invalid GST rate");
  if (discountValue.isNegative()) throw new Error("Discount cannot be negative");

  const gross = round2(qty.times(rate));

  let discount = new Decimal(0);
  if (line.discountType === "PERCENT") {
    if (discountValue.greaterThan(100)) throw new Error("Discount % cannot exceed 100");
    discount = round2(gross.times(discountValue).dividedBy(100));
  } else if (line.discountType === "AMOUNT") {
    discount = round2(discountValue);
  }
  if (discount.greaterThan(gross)) throw new Error("Discount cannot exceed line amount");

  const taxable = gross.minus(discount);

  let cgst = new Decimal(0);
  let sgst = new Decimal(0);
  let igst = new Decimal(0);
  if (mode === "INTRA_STATE") {
    const half = gstRate.dividedBy(2);
    cgst = round2(taxable.times(half).dividedBy(100));
    sgst = cgst;
  } else if (mode === "INTER_STATE") {
    igst = round2(taxable.times(gstRate).dividedBy(100));
  }
  const tax = cgst.plus(sgst).plus(igst);

  return { gross, discount, taxable, cgst, sgst, igst, tax, total: taxable.plus(tax) };
}

/**
 * Totals for an offer / invoice. GST is computed per line (each service can
 * have a different rate), then summed. Grand total is rounded to the nearest
 * rupee (half-up) and the difference shown as "Round-off".
 */
export function computeTotals(
  lines: LineInput[],
  mode: TaxMode,
  opts: { roundToRupee?: boolean } = {},
): TotalsResult {
  const roundToRupee = opts.roundToRupee ?? true;
  const results = lines.map((l) => computeLine(l, mode));

  const subtotal = sum(results.map((r) => r.gross));
  const discountTotal = sum(results.map((r) => r.discount));
  const taxableTotal = sum(results.map((r) => r.taxable));
  const cgstTotal = sum(results.map((r) => r.cgst));
  const sgstTotal = sum(results.map((r) => r.sgst));
  const igstTotal = sum(results.map((r) => r.igst));
  const taxTotal = cgstTotal.plus(sgstTotal).plus(igstTotal);
  const totalBeforeRound = taxableTotal.plus(taxTotal);

  const grandTotal = roundToRupee
    ? totalBeforeRound.toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    : totalBeforeRound;
  const roundOff = grandTotal.minus(totalBeforeRound);

  return {
    lines: results,
    subtotal,
    discountTotal,
    taxableTotal,
    cgstTotal,
    sgstTotal,
    igstTotal,
    taxTotal,
    totalBeforeRound,
    roundOff,
    grandTotal,
  };
}
