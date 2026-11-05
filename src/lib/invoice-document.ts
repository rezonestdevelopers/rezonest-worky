import { formatDateKey } from "@/lib/dates";
import { formatINR } from "@/lib/money/format";
import { toDecimal, type DecimalLike } from "@/lib/money/decimal";

export type InvoiceParty = { name: string; contact?: string | null; address?: string | null; state?: string | null; gstin?: string | null; pan?: string | null; email?: string | null; phone?: string | null; website?: string | null };
export type InvoiceBank = { bankName?: string | null; accountName?: string | null; accountNumber?: string | null; ifsc?: string | null; branch?: string | null; upiId?: string | null };

export type InvoiceDocInput = {
  type: "TAX" | "PROFORMA";
  status: string;
  number: string | null;
  invoiceDateKey: string;
  dueDateKey: string;
  placeOfSupply: string;
  taxMode: string;
  agency: InvoiceParty;
  client: InvoiceParty;
  bank: InvoiceBank;
  items: { description: string; sacCode: string | null; quantity: DecimalLike; unit: string | null; rate: DecimalLike; discountType: string | null; discountValue: DecimalLike; taxableValue: DecimalLike; gstRate: DecimalLike; cgstAmount: DecimalLike; sgstAmount: DecimalLike; igstAmount: DecimalLike; lineTotal: DecimalLike }[];
  subtotal: DecimalLike;
  discountTotal: DecimalLike;
  taxableTotal: DecimalLike;
  cgstTotal: DecimalLike;
  sgstTotal: DecimalLike;
  igstTotal: DecimalLike;
  roundOff: DecimalLike;
  grandTotal: DecimalLike;
  amountInWords: string | null;
  amountPaid: DecimalLike;
  tdsTotal: DecimalLike;
  creditedTotal: DecimalLike;
  balanceDue: DecimalLike;
  terms: string | null;
  notes: string | null;
  cancelReason: string | null;
};

const qty = (v: DecimalLike) => toDecimal(v).toString();

/** Everything an invoice shows, already worked out and formatted, so the screen and PDF always match. */
export function buildInvoiceDocument(input: InvoiceDocInput) {
  const gst = input.taxMode === "INTRA_STATE" || input.taxMode === "INTER_STATE";
  const title = input.type === "PROFORMA" ? "PROFORMA INVOICE" : gst ? "TAX INVOICE" : "INVOICE";
  const rate = (r: DecimalLike) => `${toDecimal(r).toString()}%`;
  const half = (r: DecimalLike) => `${toDecimal(r).dividedBy(2).toString()}%`;
  const rates = Array.from(new Set(input.items.map((i) => toDecimal(i.gstRate).toString())));
  const single = rates.length === 1 ? rates[0] : null;

  const summary: { label: string; value: string }[] = [{ label: "Subtotal", value: formatINR(input.subtotal) }];
  if (toDecimal(input.discountTotal).greaterThan(0)) summary.push({ label: "Discount", value: `−${formatINR(input.discountTotal)}` });
  summary.push({ label: "Taxable value", value: formatINR(input.taxableTotal) });
  if (input.taxMode === "INTRA_STATE") {
    summary.push({ label: `CGST${single ? ` ${half(single)}` : ""}`, value: formatINR(input.cgstTotal) });
    summary.push({ label: `SGST${single ? ` ${half(single)}` : ""}`, value: formatINR(input.sgstTotal) });
  } else if (input.taxMode === "INTER_STATE") {
    summary.push({ label: `IGST${single ? ` ${rate(single)}` : ""}`, value: formatINR(input.igstTotal) });
  }
  if (!toDecimal(input.roundOff).isZero()) summary.push({ label: "Round-off", value: `${toDecimal(input.roundOff).isNegative() ? "−" : "+"}${formatINR(toDecimal(input.roundOff).abs())}` });

  const settled: { label: string; value: string }[] = [];
  if (toDecimal(input.amountPaid).greaterThan(0)) settled.push({ label: "Paid", value: formatINR(input.amountPaid) });
  if (toDecimal(input.tdsTotal).greaterThan(0)) settled.push({ label: "TDS deducted", value: formatINR(input.tdsTotal) });
  if (toDecimal(input.creditedTotal).greaterThan(0)) settled.push({ label: "Credit notes", value: formatINR(input.creditedTotal) });

  return {
    title,
    gst,
    status: input.status,
    number: input.number ?? "Draft",
    invoiceDate: formatDateKey(input.invoiceDateKey),
    dueDate: formatDateKey(input.dueDateKey),
    placeOfSupply: input.placeOfSupply,
    agency: input.agency,
    client: input.client,
    bank: input.bank,
    lines: input.items.map((i) => ({
      description: i.description,
      sac: i.sacCode ?? "",
      quantity: `${qty(i.quantity)}${i.unit ? ` ${i.unit}` : ""}`,
      rate: formatINR(i.rate),
      discount: toDecimal(i.discountValue).greaterThan(0) ? (i.discountType === "PERCENT" ? `${qty(i.discountValue)}%` : formatINR(i.discountValue)) : "",
      taxable: formatINR(i.taxableValue),
      gst: gst ? rate(i.gstRate) : "",
      tax: gst ? formatINR(toDecimal(i.cgstAmount).plus(toDecimal(i.sgstAmount)).plus(toDecimal(i.igstAmount))) : "",
      total: formatINR(i.lineTotal),
    })),
    summary,
    grandTotal: formatINR(input.grandTotal),
    amountInWords: input.amountInWords ?? "",
    settled,
    balanceDue: formatINR(input.balanceDue),
    showBalance: settled.length > 0,
    taxNote:
      input.type === "PROFORMA"
        ? "This is a proforma invoice, not a tax invoice. A tax invoice will follow."
        : input.taxMode === "EXPORT"
          ? "Export of services. No GST charged."
          : input.taxMode === "NO_GST"
            ? "GST not charged on this invoice."
            : null,
    terms: input.terms,
    notes: input.notes,
    cancelReason: input.cancelReason,
  };
}
export type InvoiceDocument = ReturnType<typeof buildInvoiceDocument>;
