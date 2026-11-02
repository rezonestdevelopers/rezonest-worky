import "server-only";
import { db } from "@/lib/db";
import { Decimal, toDecimal } from "@/lib/money";
import { dateOnlyKey, keyToDate } from "@/lib/dates";
import { dateRange, type Scope } from "./filters";

/**
 * Revenue facts = taxable value (EXCLUDING GST) of ISSUED TAX invoices,
 * minus credit notes. Proforma, draft and cancelled invoices never count.
 * With a service/department filter, only matching line items count and each
 * credit note is applied in proportion to the matching items.
 */
export interface RevenueFact {
  clientId: string;
  serviceId: string | null;
  dateKey: string;
  amount: Decimal; // negative for credit notes
}

export async function revenueFacts(scope: Scope, from: string, to: string): Promise<RevenueFact[]> {
  const svc = scope.serviceIds;
  const [items, credits] = await Promise.all([
    db.invoiceItem.findMany({
      where: {
        invoice: { type: "TAX", status: "ISSUED", invoiceDate: dateRange(from, to), client: scope.clientWhere },
        ...(svc ? { serviceId: { in: svc } } : {}),
      },
      select: { taxableValue: true, serviceId: true, invoice: { select: { invoiceDate: true, clientId: true } } },
    }),
    db.creditNote.findMany({
      where: { date: dateRange(from, to), client: scope.clientWhere, invoice: { status: "ISSUED" } },
      select: {
        clientId: true,
        date: true,
        taxableAmount: true,
        invoice: { select: { taxableTotal: true, items: { select: { serviceId: true, taxableValue: true } } } },
      },
    }),
  ]);

  const facts: RevenueFact[] = items.map((i) => ({
    clientId: i.invoice.clientId,
    serviceId: i.serviceId,
    dateKey: dateOnlyKey(i.invoice.invoiceDate),
    amount: toDecimal(i.taxableValue),
  }));

  for (const cn of credits) {
    const invTaxable = toDecimal(cn.invoice.taxableTotal);
    if (invTaxable.isZero()) continue;
    for (const item of cn.invoice.items) {
      if (svc && (!item.serviceId || !svc.includes(item.serviceId))) continue;
      const share = toDecimal(item.taxableValue).dividedBy(invTaxable);
      facts.push({
        clientId: cn.clientId,
        serviceId: item.serviceId,
        dateKey: dateOnlyKey(cn.date),
        amount: toDecimal(cn.taxableAmount).times(share).negated().toDecimalPlaces(2),
      });
    }
  }
  return facts;
}

export function sumFacts(facts: RevenueFact[]): Decimal {
  return facts.reduce((s, f) => s.plus(f.amount), new Decimal(0));
}

/** Gross invoiced (incl. GST) net of credit notes — for the invoiced vs received chart. */
export async function grossInvoicedByMonth(scope: Scope, from: string, to: string) {
  const [invoices, credits] = await Promise.all([
    db.invoice.findMany({
      where: { type: "TAX", status: "ISSUED", invoiceDate: dateRange(from, to), client: scope.clientWhere },
      select: { invoiceDate: true, grandTotal: true },
    }),
    db.creditNote.findMany({
      where: { date: dateRange(from, to), client: scope.clientWhere, invoice: { status: "ISSUED" } },
      select: { date: true, totalAmount: true },
    }),
  ]);
  const map = new Map<string, Decimal>();
  for (const i of invoices) {
    const m = dateOnlyKey(i.invoiceDate).slice(0, 7);
    map.set(m, (map.get(m) ?? new Decimal(0)).plus(toDecimal(i.grandTotal)));
  }
  for (const c of credits) {
    const m = dateOnlyKey(c.date).slice(0, 7);
    map.set(m, (map.get(m) ?? new Decimal(0)).minus(toDecimal(c.totalAmount)));
  }
  return map;
}

/** Money received = cash in (excl. TDS), plus TDS reported separately. */
export async function receivedTotals(scope: Scope, from: string, to: string) {
  const agg = await db.payment.aggregate({
    where: { voidedAt: null, date: dateRange(from, to), client: scope.clientWhere },
    _sum: { amount: true, tdsAmount: true },
  });
  return { cash: toDecimal(agg._sum.amount), tds: toDecimal(agg._sum.tdsAmount) };
}

export async function receivedByMonth(scope: Scope, from: string, to: string) {
  const rows = await db.payment.findMany({
    where: { voidedAt: null, date: dateRange(from, to), client: scope.clientWhere },
    select: { date: true, amount: true, tdsAmount: true },
  });
  const map = new Map<string, Decimal>();
  for (const r of rows) {
    const m = dateOnlyKey(r.date).slice(0, 7);
    map.set(m, (map.get(m) ?? new Decimal(0)).plus(toDecimal(r.amount)).plus(toDecimal(r.tdsAmount)));
  }
  return map;
}

/** Outstanding now: balance due on issued, non-cancelled TAX invoices. */
export async function outstandingNow(scope: Scope) {
  const agg = await db.invoice.aggregate({
    where: { type: "TAX", status: "ISSUED", client: scope.clientWhere, balanceDue: { gt: 0 } },
    _sum: { balanceDue: true },
    _count: true,
  });
  return { amount: toDecimal(agg._sum.balanceDue), count: agg._count };
}

/** Outstanding as it stood at the end of a past day (for the % change). */
export async function outstandingAsOf(scope: Scope, asOf: string) {
  const end = keyToDate(asOf);
  const [inv, paid, cn] = await Promise.all([
    db.invoice.aggregate({
      where: { type: "TAX", status: { in: ["ISSUED", "CANCELLED"] }, invoiceDate: { lte: end }, client: scope.clientWhere, OR: [{ cancelledAt: null }, { cancelledAt: { gt: end } }] },
      _sum: { grandTotal: true },
    }),
    db.paymentAllocation.aggregate({
      where: { payment: { voidedAt: null, date: { lte: end } }, invoice: { type: "TAX", invoiceDate: { lte: end }, client: scope.clientWhere } },
      _sum: { amount: true, tdsAmount: true },
    }),
    db.creditNote.aggregate({ where: { date: { lte: end }, client: scope.clientWhere }, _sum: { totalAmount: true } }),
  ]);
  return toDecimal(inv._sum.grandTotal)
    .minus(toDecimal(paid._sum.amount))
    .minus(toDecimal(paid._sum.tdsAmount))
    .minus(toDecimal(cn._sum.totalAmount));
}

/** Monthly Recurring Revenue (excl. GST) from active retainer services on a given day. */
export async function mrrOn(scope: Scope, dayKey: string, activeOnly: boolean) {
  const day = keyToDate(dayKey);
  const agg = await db.projectService.aggregate({
    where: {
      isActive: true,
      billingType: "MONTHLY_RETAINER",
      ...(scope.serviceIds ? { serviceId: { in: scope.serviceIds } } : {}),
      project: {
        archivedAt: null,
        isRetainer: true,
        client: scope.clientWhere,
        ...(activeOnly ? { status: "ACTIVE" } : { status: { not: "CANCELLED" } }),
        retainerStart: { lte: day },
        OR: [{ retainerEnd: null }, { retainerEnd: { gte: day } }],
      },
    },
    _sum: { monthlyValue: true },
  });
  return toDecimal(agg._sum.monthlyValue);
}
