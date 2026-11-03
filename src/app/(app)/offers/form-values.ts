import "server-only";
import type { Prisma } from "@prisma/client";
import { addDaysKey, dateOnlyKey, todayKey } from "@/lib/dates";
import { CONTENT_FORMATS } from "@/lib/validators/offer";
import type { OfferFormOptions } from "@/server/queries/offers";
import type { OfferFormValues } from "./offer-form";

type OfferWithLines = Prisma.OfferGetPayload<{ include: { items: { orderBy: { sortOrder: "asc" } }; milestones: { orderBy: { sortOrder: "asc" } } } }>;

function itemValues(i: OfferWithLines["items"][number]): OfferFormValues["items"][number] {
  const saved = (i.deliverables as { format: string; qtyPerMonth: number }[] | null) ?? [];
  return {
    serviceId: i.serviceId ?? "",
    subServiceId: i.subServiceId ?? "",
    description: i.description,
    billingType: i.billingType,
    quantity: i.quantity.toString(),
    unit: i.unit,
    rate: i.rate.toString(),
    discountType: i.discountType ?? "",
    discountValue: i.discountType ? i.discountValue.toString() : "",
    gstRate: i.gstRate.toString(),
    sacCode: i.sacCode ?? "",
    durationMonths: i.durationMonths ?? "",
    // One box per format, so the form always has the same five inputs.
    deliverables: CONTENT_FORMATS.map((format) => ({ format, qtyPerMonth: saved.find((d) => d.format === format)?.qtyPerMonth ?? 0 })),
  };
}

/** An existing offer or template as form values. */
export function offerToFormValues(o: OfferWithLines): OfferFormValues {
  return {
    clientId: o.clientId ?? "",
    leadId: o.clientId ? "" : (o.leadId ?? ""),
    templateName: o.templateName ?? "",
    title: o.title,
    offerDate: dateOnlyKey(o.offerDate),
    validUntil: dateOnlyKey(o.validUntil),
    durationMonths: o.durationMonths ?? "",
    paymentTerms: o.paymentTerms ?? "",
    terms: o.terms ?? "",
    notes: o.notes ?? "",
    gstEnabled: o.taxMode !== "NO_GST",
    supplyStateCode: o.supplyStateCode ?? "",
    items: o.items.map(itemValues),
    milestones: o.milestones.map((m) => ({ name: m.name, percent: m.percent.toString() })),
  };
}

/** A new offer: today's date, your default validity, GST and terms, optionally started from a template. */
export function newOfferValues(options: OfferFormOptions, opts: { clientId?: string; leadId?: string; template?: OfferWithLines | null }): OfferFormValues {
  const today = todayKey();
  const base = opts.template ? offerToFormValues(opts.template) : null;
  return {
    clientId: opts.clientId ?? "",
    leadId: opts.leadId ?? "",
    templateName: "",
    title: base?.title ?? "",
    offerDate: today,
    validUntil: addDaysKey(today, options.validityDays),
    durationMonths: base?.durationMonths ?? "",
    paymentTerms: base?.paymentTerms ?? "",
    terms: base?.terms || options.quotationTerms,
    notes: base?.notes ?? "",
    gstEnabled: base?.gstEnabled ?? options.gstOnByDefault,
    supplyStateCode: options.agencyStateCode,
    items: base?.items ?? [],
    milestones: base?.milestones ?? [],
  };
}
