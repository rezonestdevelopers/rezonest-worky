import "server-only";
import type { InvoiceStatus, PaymentMode, PaymentStatus, Prisma } from "@prisma/client";
import { dateOnlyKey, daysBetweenKeys, keyToDate, todayKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { AGEING_BUCKETS, ageingKey, type AgeingKey, advanceLeft } from "@/lib/invoice-rules";
import { buildInvoiceDocument, type InvoiceBank, type InvoiceParty } from "@/lib/invoice-document";
import { idParam, param, parseListParams, type SearchParams } from "@/lib/list-params";
import { Decimal, sum, toDecimal } from "@/lib/money";
import { PAYMENT_MODES } from "@/lib/validators/invoice";

const SORTS = ["invoiceDate", "dueDate", "number", "grandTotal", "balanceDue"] as const;
const LIST = { sorts: SORTS, defaultSort: "invoiceDate", defaultDir: "desc" } as const;

function invoiceWhere(sp: SearchParams, q: string): Prisma.InvoiceWhereInput {
  const type = param(sp, "type");
  const status = param(sp, "status");
  const payment = param(sp, "payment");
  const contains = { contains: q, mode: "insensitive" as const };
  return {
    // Discarded drafts have no number and aren't part of any list.
    AND: [
      { NOT: { status: "CANCELLED", number: null } },
      type === "TAX" || type === "PROFORMA" ? { type } : {},
      ["DRAFT", "ISSUED", "CANCELLED", "CONVERTED"].includes(status ?? "") ? { status: status as InvoiceStatus } : {},
      ["UNPAID", "PARTIALLY_PAID", "PAID", "OVERDUE"].includes(payment ?? "") ? { type: "TAX", status: "ISSUED", paymentStatus: payment as PaymentStatus } : {},
      idParam(sp, "client") ? { clientId: idParam(sp, "client") } : {},
      q ? { OR: [{ number: contains }, { client: { companyName: contains } }] } : {},
    ],
  };
}

const select = {
  id: true, number: true, type: true, status: true, paymentStatus: true, invoiceDate: true, dueDate: true, grandTotal: true, balanceDue: true, source: true,
  client: { select: { companyName: true } },
} satisfies Prisma.InvoiceSelect;

function toRow(i: Prisma.InvoiceGetPayload<{ select: typeof select }>) {
  return { id: i.id, number: i.number, type: i.type as string, status: i.status as string, paymentStatus: i.paymentStatus as string, invoiceDate: dateOnlyKey(i.invoiceDate), dueDate: dateOnlyKey(i.dueDate), total: i.grandTotal.toString(), balance: i.balanceDue.toString(), source: i.source as string, client: i.client.companyName };
}
export type InvoiceRow = ReturnType<typeof toRow>;

export async function getInvoiceList(sp: SearchParams) {
  const params = parseListParams(sp, LIST);
  const where = invoiceWhere(sp, params.q);
  const total = await db.invoice.count({ where });
  const page = Math.min(params.page, Math.max(1, Math.ceil(total / params.pageSize)));
  const rows = await db.invoice.findMany({ where, select, orderBy: [{ [params.sort]: params.dir }, { id: "asc" }], skip: (page - 1) * params.pageSize, take: params.pageSize });
  return { rows: rows.map(toRow), total, ...params, page };
}

export async function getInvoicesForExport(sp: SearchParams) {
  const params = parseListParams(sp, LIST);
  const rows = await db.invoice.findMany({ where: invoiceWhere(sp, params.q), select, orderBy: [{ [params.sort]: params.dir }, { id: "asc" }], take: 20_000 });
  return rows.map(toRow);
}

export async function getInvoiceSummary() {
  const today = keyToDate(todayKey());
  const open = { type: "TAX" as const, status: "ISSUED" as const, balanceDue: { gt: 0 } };
  const [outstanding, overdue, drafts] = await Promise.all([
    db.invoice.aggregate({ where: open, _sum: { balanceDue: true }, _count: true }),
    db.invoice.aggregate({ where: { ...open, dueDate: { lt: today } }, _sum: { balanceDue: true }, _count: true }),
    db.invoice.count({ where: { status: "DRAFT" } }),
  ]);
  return { outstanding: outstanding._sum.balanceDue?.toString() ?? "0", outstandingCount: outstanding._count, overdue: overdue._sum.balanceDue?.toString() ?? "0", overdueCount: overdue._count, drafts };
}

/** Issued invoices show the details frozen when issued. Older records and drafts show today's. */
export async function loadInvoice(id: string) {
  const [invoice, settings] = await Promise.all([
    db.invoice.findUnique({
      where: { id },
      include: {
        items: { orderBy: { sortOrder: "asc" } },
        client: { include: { contacts: { where: { isPrimary: true, archivedAt: null }, take: 1 } } },
        project: { select: { id: true, name: true } },
        convertedFrom: { select: { id: true, number: true } },
        convertedTo: { select: { id: true, number: true } },
        creditNotes: { orderBy: { date: "asc" } },
        allocations: { include: { payment: { select: { id: true, date: true, mode: true, reference: true, voidedAt: true, tdsSection: true } } } },
      },
    }),
    db.settings.findUniqueOrThrow({ where: { id: "agency" } }),
  ]);
  if (!invoice) return null;
  const a = (invoice.agencySnapshot ?? {}) as Record<string, string | null | undefined>;
  const c = (invoice.clientSnapshot ?? {}) as Record<string, string | null | undefined>;
  const frozenA = <T,>(key: string, current: T) => (key in a ? (a[key] as T) : current);
  const frozenC = <T,>(key: string, current: T) => (key in c ? (c[key] as T) : current);
  const agency: InvoiceParty = {
    name: frozenA("name", settings.agencyName), address: frozenA("address", [settings.address, settings.city, settings.state, settings.pincode].filter(Boolean).join(", ")), state: frozenA("state", `${settings.state} (${settings.stateCode})`),
    gstin: frozenA("gstin", settings.gstin), pan: frozenA("pan", settings.pan), email: frozenA("email", settings.email), phone: frozenA("phone", settings.phone), website: frozenA("website", settings.website),
  };
  const client: InvoiceParty = {
    name: frozenC("name", frozenC("companyName", invoice.client.companyName)), contact: frozenC("contact", invoice.client.contacts[0]?.name ?? null), address: frozenC("address", [invoice.client.billingAddress, invoice.client.city, invoice.client.state, invoice.client.pincode].filter(Boolean).join(", ")),
    state: frozenC("state", `${invoice.client.state} (${invoice.client.stateCode})`), gstin: frozenC("gstin", invoice.client.gstin), pan: frozenC("pan", invoice.client.pan), email: frozenC("email", invoice.client.email), phone: frozenC("phone", invoice.client.phone),
  };
  const bank: InvoiceBank = { bankName: frozenA("bankName", settings.bankName), accountName: frozenA("accountName", settings.bankAccountName), accountNumber: frozenA("accountNumber", settings.bankAccountNumber), ifsc: frozenA("ifsc", settings.bankIfsc), branch: frozenA("branch", settings.bankBranch), upiId: frozenA("upiId", settings.upiId) };
  const doc = buildInvoiceDocument({
    type: invoice.type, status: invoice.status, number: invoice.number, invoiceDateKey: dateOnlyKey(invoice.invoiceDate), dueDateKey: dateOnlyKey(invoice.dueDate), placeOfSupply: invoice.placeOfSupply, taxMode: invoice.taxMode,
    agency, client, bank, items: invoice.items, subtotal: invoice.subtotal, discountTotal: invoice.discountTotal, taxableTotal: invoice.taxableTotal, cgstTotal: invoice.cgstTotal, sgstTotal: invoice.sgstTotal, igstTotal: invoice.igstTotal, roundOff: invoice.roundOff, grandTotal: invoice.grandTotal,
    amountInWords: invoice.amountInWords, amountPaid: invoice.amountPaid, tdsTotal: invoice.tdsTotal, creditedTotal: invoice.creditedTotal, balanceDue: invoice.balanceDue, terms: invoice.terms, notes: invoice.notes, cancelReason: invoice.cancelReason,
  });
  return { invoice, doc, settings, logoKey: frozenA("logoKey", settings.logoKey) as string | null, signatureKey: frozenA("signatureKey", settings.signatureKey) as string | null };
}

export async function getInvoiceFormOptions(including?: { clientId?: string }) {
  const [clients, projects, services, settings] = await Promise.all([
    db.client.findMany({ where: { OR: [{ archivedAt: null }, ...(including?.clientId ? [{ id: including.clientId }] : [])] }, orderBy: { companyName: "asc" }, select: { id: true, companyName: true, stateCode: true, state: true, country: true } }),
    db.project.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, clientId: true } }),
    db.service.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, defaultPrice: true, unit: true, gstRate: true, sacCode: true } }),
    db.settings.findUniqueOrThrow({ where: { id: "agency" } }),
  ]);
  return {
    clients: clients.map((c) => ({ value: c.id, label: c.companyName, stateCode: c.stateCode, state: c.state, country: c.country })),
    projects: projects.map((p) => ({ value: p.id, label: p.name, clientId: p.clientId })),
    services: services.map((s) => ({ value: s.id, label: s.name, rate: s.defaultPrice.toString(), unit: s.unit, gstRate: s.gstRate.toString(), sacCode: s.sacCode ?? "" })),
    agencyStateCode: settings.stateCode,
    defaultGstRate: settings.defaultGstRate.toString(),
    defaultTermsDays: settings.defaultPaymentTermsDays,
    invoiceTerms: settings.invoiceTerms ?? "",
    gstEnabledByDefault: settings.gstEnabledByDefault,
    hasGstin: !!settings.gstin,
  };
}

// ─── Payments ────────────────────────────────────────────────────────────────

const PAY_SORTS = ["date", "amount", "createdAt"] as const;
const PAY_LIST = { sorts: PAY_SORTS, defaultSort: "date", defaultDir: "desc" } as const;

function paymentWhere(sp: SearchParams, q: string): Prisma.PaymentWhereInput {
  const mode = PAYMENT_MODES.find((m) => m === param(sp, "mode")) as PaymentMode | undefined;
  const contains = { contains: q, mode: "insensitive" as const };
  return {
    voidedAt: param(sp, "show") === "void" ? { not: null } : null,
    ...(mode ? { mode } : {}),
    ...(idParam(sp, "client") ? { clientId: idParam(sp, "client") } : {}),
    ...(q ? { OR: [{ reference: contains }, { notes: contains }, { client: { companyName: contains } }] } : {}),
  };
}

const paySelect = {
  id: true, date: true, amount: true, tdsAmount: true, tdsSection: true, mode: true, reference: true, voidedAt: true,
  client: { select: { companyName: true } },
  allocations: { select: { amount: true, invoice: { select: { number: true } } } },
} satisfies Prisma.PaymentSelect;

function toPaymentRow(p: Prisma.PaymentGetPayload<{ select: typeof paySelect }>) {
  return {
    id: p.id, date: dateOnlyKey(p.date), client: p.client.companyName, amount: p.amount.toString(), tds: p.tdsAmount.toString(), tdsSection: p.tdsSection, mode: p.mode as string, reference: p.reference,
    advance: advanceLeft(p.amount, p.allocations).toFixed(2), invoices: p.allocations.map((a) => a.invoice.number ?? "").filter(Boolean).join(", "), voided: !!p.voidedAt,
  };
}
export type PaymentRow = ReturnType<typeof toPaymentRow>;

export async function getPaymentList(sp: SearchParams) {
  const params = parseListParams(sp, PAY_LIST);
  const where = paymentWhere(sp, params.q);
  const total = await db.payment.count({ where });
  const page = Math.min(params.page, Math.max(1, Math.ceil(total / params.pageSize)));
  const rows = await db.payment.findMany({ where, select: paySelect, orderBy: [{ [params.sort]: params.dir }, { id: "asc" }], skip: (page - 1) * params.pageSize, take: params.pageSize });
  return { rows: rows.map(toPaymentRow), total, ...params, page };
}

export async function getPaymentsForExport(sp: SearchParams) {
  const params = parseListParams(sp, PAY_LIST);
  const rows = await db.payment.findMany({ where: paymentWhere(sp, params.q), select: paySelect, orderBy: [{ [params.sort]: params.dir }, { id: "asc" }], take: 20_000 });
  return rows.map(toPaymentRow);
}

export const getPayment = (id: string) =>
  db.payment.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, companyName: true } },
      allocations: { include: { invoice: { select: { id: true, number: true, grandTotal: true, balanceDue: true } } } },
    },
  });

/** A client's invoices still owing, oldest first: what a payment can go against. */
export async function getOpenInvoices(clientId: string) {
  const rows = await db.invoice.findMany({ where: { clientId, type: "TAX", status: "ISSUED", balanceDue: { gt: 0 } }, orderBy: [{ dueDate: "asc" }, { id: "asc" }], select: { id: true, number: true, invoiceDate: true, dueDate: true, grandTotal: true, balanceDue: true } });
  return rows.map((r) => ({ id: r.id, number: r.number ?? "", invoiceDate: dateOnlyKey(r.invoiceDate), dueDate: dateOnlyKey(r.dueDate), total: r.grandTotal.toString(), balance: r.balanceDue.toString() }));
}

export const getOpenProformas = (clientId: string) =>
  db.invoice.findMany({ where: { clientId, type: "PROFORMA", status: "ISSUED", convertedTo: null }, orderBy: { invoiceDate: "asc" }, select: { id: true, number: true, grandTotal: true } });

/** Unapplied money on a client's payments. */
export async function getClientAdvances(clientId: string) {
  const rows = await db.payment.findMany({ where: { clientId, voidedAt: null }, orderBy: { date: "asc" }, select: { id: true, date: true, amount: true, reference: true, allocations: { select: { amount: true } } } });
  return rows.map((p) => ({ id: p.id, date: dateOnlyKey(p.date), reference: p.reference, left: advanceLeft(p.amount, p.allocations) })).filter((p) => p.left.greaterThan(0)).map((p) => ({ ...p, left: p.left.toFixed(2) }));
}

export const getPayableClients = () => db.client.findMany({ where: { archivedAt: null }, orderBy: { companyName: "asc" }, select: { id: true, companyName: true } });

/** What each client owes by age, plus any advance they hold. */
export async function getAgeingReport(today = todayKey()) {
  const [invoices, payments] = await Promise.all([
    db.invoice.findMany({ where: { type: "TAX", status: "ISSUED", balanceDue: { gt: 0 } }, select: { clientId: true, dueDate: true, balanceDue: true, client: { select: { companyName: true } } } }),
    db.payment.findMany({ where: { voidedAt: null }, select: { clientId: true, amount: true, allocations: { select: { amount: true } }, client: { select: { companyName: true } } } }),
  ]);
  type Row = { clientId: string; client: string; buckets: Record<AgeingKey, Decimal>; total: Decimal; advance: Decimal };
  const rows = new Map<string, Row>();
  const row = (clientId: string, client: string) => {
    let r = rows.get(clientId);
    if (!r) {
      r = { clientId, client, buckets: Object.fromEntries(AGEING_BUCKETS.map((k) => [k, new Decimal(0)])) as Record<AgeingKey, Decimal>, total: new Decimal(0), advance: new Decimal(0) };
      rows.set(clientId, r);
    }
    return r;
  };
  for (const i of invoices) {
    const r = row(i.clientId, i.client.companyName);
    const key = ageingKey(daysBetweenKeys(dateOnlyKey(i.dueDate), today));
    r.buckets[key] = r.buckets[key].plus(toDecimal(i.balanceDue));
    r.total = r.total.plus(toDecimal(i.balanceDue));
  }
  for (const p of payments) {
    const left = advanceLeft(p.amount, p.allocations);
    if (left.greaterThan(0)) {
      const r = row(p.clientId, p.client.companyName);
      r.advance = r.advance.plus(left);
    }
  }
  const list = [...rows.values()].sort((a, b) => b.total.comparedTo(a.total) || a.client.localeCompare(b.client));
  const totals = Object.fromEntries(AGEING_BUCKETS.map((k) => [k, sum(list.map((r) => r.buckets[k]))])) as Record<AgeingKey, Decimal>;
  return { rows: list, totals, total: sum(list.map((r) => r.total)), advance: sum(list.map((r) => r.advance)) };
}
