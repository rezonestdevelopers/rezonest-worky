import type { Prisma } from "@prisma/client";
import { addDaysKey, dateOnlyKey, formatDateKey, formatMonthKey, keyToDate, monthKeyOf, monthRange, todayKey } from "@/lib/dates";
import type { InvoiceInput } from "@/lib/validators/invoice";
import { invoiceSchema } from "@/lib/validators/invoice";
import { amountInWords, computeLine, computePaymentStatus, computeTotals, determineTaxMode, invoiceBalance, sum, toDecimal, type DiscountType, type LineInput, type TaxMode } from "@/lib/money";
import { nextDocNumber } from "@/lib/numbering";
import { issueProblems, milestoneLines } from "@/lib/invoice-rules";
import { assetKindLabel } from "@/lib/renewals";
import type { z } from "zod";
import { BusinessError, logActivity, type Db, type Tx } from "./shared";

const money = (v: { toFixed(n: number): string }) => v.toFixed(2);
type Data = z.output<typeof invoiceSchema>;
type Item = Data["items"][number];
type Client = Prisma.ClientGetPayload<object>;

/** Holds other money changes to this invoice until this one finishes. */
export const lockInvoice = (tx: Tx, id: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;

function taxModeFor(client: Client, agencyStateCode: string, gstEnabled: boolean): TaxMode {
  return determineTaxMode({ gstEnabled, agencyStateCode, clientStateCode: client.stateCode, clientCountry: client.country });
}

const placeOfSupply = (client: Client, mode: TaxMode) => (mode === "EXPORT" ? `Outside India (${client.country})` : `${client.state} (${client.stateCode})`);

/** Stored totals and item rows, from the same calculator used everywhere. */
function computed(items: Item[], mode: TaxMode) {
  const lines: LineInput[] = items.map((i) => ({ quantity: i.quantity, rate: i.rate, discountType: i.discountType as DiscountType | null, discountValue: i.discountValue, gstRate: i.gstRate }));
  const t = computeTotals(lines, mode);
  return {
    columns: {
      subtotal: money(t.subtotal),
      discountTotal: money(t.discountTotal),
      taxableTotal: money(t.taxableTotal),
      cgstTotal: money(t.cgstTotal),
      sgstTotal: money(t.sgstTotal),
      igstTotal: money(t.igstTotal),
      roundOff: money(t.roundOff),
      grandTotal: money(t.grandTotal),
      amountInWords: amountInWords(t.grandTotal),
      balanceDue: money(t.grandTotal),
    },
    rows: items.map((i, n) => ({
      serviceId: i.serviceId,
      description: i.description,
      sacCode: i.sacCode,
      quantity: i.quantity,
      unit: i.unit,
      rate: i.rate,
      discountType: i.discountType as DiscountType | null,
      discountValue: i.discountValue,
      gstRate: i.gstRate,
      taxableValue: money(t.lines[n].taxable),
      cgstAmount: money(t.lines[n].cgst),
      sgstAmount: money(t.lines[n].sgst),
      igstAmount: money(t.lines[n].igst),
      lineTotal: money(t.lines[n].total),
      sortOrder: n,
    })),
  };
}

async function assertClientAndProject(tx: Tx, clientId: string, projectId: string | null) {
  const client = await tx.client.findUnique({ where: { id: clientId } });
  if (!client || client.archivedAt) throw new BusinessError("That client is archived. Restore them first.");
  if (projectId && !(await tx.project.count({ where: { id: projectId, clientId } }))) throw new BusinessError("That project isn't one of this client's.");
  return client;
}

/** A new or edited draft. Only drafts can change: an issued invoice is locked. */
export async function saveDraftInvoice(db: Db, id: string | null, data: Data, actorId: string) {
  return db.$transaction(async (tx) => {
    const client = await assertClientAndProject(tx, data.clientId, data.projectId);
    const settings = await tx.settings.findUniqueOrThrow({ where: { id: "agency" } });
    const mode = taxModeFor(client, settings.stateCode, data.gstEnabled);
    const { columns, rows } = computed(data.items, mode);
    const fields = { type: data.type, clientId: data.clientId, projectId: data.projectId, invoiceDate: keyToDate(data.invoiceDate), dueDate: keyToDate(data.dueDate), placeOfSupply: placeOfSupply(client, mode), taxMode: mode, terms: data.terms, notes: data.notes, ...columns };
    if (!id) {
      const invoice = await tx.invoice.create({ data: { ...fields, createdById: actorId, items: { create: rows } } });
      await logActivity(tx, { actorId, action: "invoice.draft_created", entityType: "Invoice", entityId: invoice.id, clientId: invoice.clientId, changes: { total: columns.grandTotal } });
      return invoice;
    }
    await lockInvoice(tx, id);
    const before = await tx.invoice.findUnique({ where: { id }, include: { items: { select: { id: true } } } });
    if (!before) throw new BusinessError("This invoice no longer exists.");
    if (before.status !== "DRAFT") throw new BusinessError("This invoice has been issued, so it can't be edited. Use a credit note instead.");
    const keep = new Set(data.items.map((i) => i.id).filter(Boolean));
    const removed = before.items.filter((i) => !keep.has(i.id)).map((i) => i.id);
    if (removed.length) {
      // A change request on a removed line can be billed later.
      await tx.changeRequest.updateMany({ where: { invoiceItemId: { in: removed } }, data: { status: "APPROVED", invoiceItemId: null } });
      await tx.invoiceItem.deleteMany({ where: { id: { in: removed } } });
    }
    for (const [n, row] of rows.entries()) {
      const itemId = data.items[n].id;
      if (itemId && before.items.some((i) => i.id === itemId)) await tx.invoiceItem.update({ where: { id: itemId }, data: row });
      else await tx.invoiceItem.create({ data: { ...row, invoiceId: id } });
    }
    const invoice = await tx.invoice.update({ where: { id }, data: fields });
    await logActivity(tx, { actorId, action: "invoice.draft_updated", entityType: "Invoice", entityId: id, clientId: invoice.clientId, changes: { total: columns.grandTotal } });
    return invoice;
  });
}

function partySnapshots(settings: Prisma.SettingsGetPayload<object>, client: Client, contactName: string | null) {
  return {
    agencySnapshot: {
      name: settings.agencyName, address: [settings.address, settings.city, settings.state, settings.pincode].filter(Boolean).join(", "), state: `${settings.state} (${settings.stateCode})`,
      gstin: settings.gstin, pan: settings.pan, email: settings.email, phone: settings.phone, website: settings.website,
      bankName: settings.bankName, accountName: settings.bankAccountName, accountNumber: settings.bankAccountNumber, ifsc: settings.bankIfsc, branch: settings.bankBranch, upiId: settings.upiId,
      logoKey: settings.logoKey, signatureKey: settings.signatureKey,
    },
    clientSnapshot: {
      name: client.companyName, contact: contactName, address: [client.billingAddress, client.city, client.state, client.pincode].filter(Boolean).join(", "), state: `${client.state} (${client.stateCode})`,
      gstin: client.gstin, pan: client.pan, email: client.email, phone: client.phone,
    },
  };
}

async function issueInTx(tx: Tx, id: string, actorId: string, today: string) {
  const invoice = await tx.invoice.findUnique({ where: { id }, include: { items: true, client: { include: { contacts: { where: { isPrimary: true, archivedAt: null }, take: 1 } } } } });
  if (!invoice) throw new BusinessError("This invoice no longer exists.");
  if (invoice.status !== "DRAFT") throw new BusinessError("This invoice has already been issued.");
  const settings = await tx.settings.findUniqueOrThrow({ where: { id: "agency" } });
  // The client's state may have changed since the draft, so the tax is worked out again.
  const gstEnabled = invoice.taxMode !== "NO_GST";
  const mode = taxModeFor(invoice.client, settings.stateCode, gstEnabled);
  const items: Item[] = invoice.items
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((i) => ({ id: i.id, serviceId: i.serviceId, description: i.description, sacCode: i.sacCode, quantity: i.quantity.toString(), unit: i.unit, rate: i.rate.toString(), discountType: i.discountType, discountValue: i.discountValue.toString(), gstRate: i.gstRate.toString() }));
  const { columns, rows } = computed(items, mode);
  const invoiceDateKey = dateOnlyKey(invoice.invoiceDate);
  const problems = issueProblems({ type: invoice.type, taxMode: mode, agencyGstin: settings.gstin, lines: items, invoiceDateKey, todayKey: today, grandTotal: columns.grandTotal });
  if (problems.length) throw new BusinessError(problems.join(" "));
  for (const [n, row] of rows.entries()) await tx.invoiceItem.update({ where: { id: items[n].id }, data: row });
  const number = await nextDocNumber(tx, invoice.type === "TAX" ? "INVOICE" : "PROFORMA", invoiceDateKey);
  const issued = await tx.invoice.update({
    where: { id },
    data: { ...columns, number, status: "ISSUED", taxMode: mode, placeOfSupply: placeOfSupply(invoice.client, mode), issuedAt: new Date(), issuedById: actorId, paymentStatus: computePaymentStatus({ status: "ISSUED", grandTotal: columns.grandTotal, amountPaid: 0, tdsTotal: 0, creditedTotal: 0, dueDateKey: dateOnlyKey(invoice.dueDate), todayKey: today }), ...partySnapshots(settings, invoice.client, invoice.client.contacts[0]?.name ?? null) },
  });
  await tx.changeRequest.updateMany({ where: { invoiceItem: { invoiceId: id } }, data: { status: "INVOICED" } });
  await logActivity(tx, { actorId, action: "invoice.issued", entityType: "Invoice", entityId: id, clientId: invoice.clientId, changes: { number, total: columns.grandTotal } });
  return issued;
}

/** Gives it its number and locks it. The number comes from the same save, so a failure leaves no gap. */
export async function issueInvoice(db: Db, id: string, actorId: string, today = todayKey()) {
  return db.$transaction(async (tx) => {
    await lockInvoice(tx, id);
    return issueInTx(tx, id, actorId, today);
  });
}

/** Removes a draft from the lists. It never had a number, so no number is lost. */
export async function discardDraft(db: Db, id: string, actorId: string) {
  await db.$transaction(async (tx) => {
    await lockInvoice(tx, id);
    const invoice = await tx.invoice.findUnique({ where: { id } });
    if (!invoice) throw new BusinessError("This invoice no longer exists.");
    if (invoice.status !== "DRAFT") throw new BusinessError("Only drafts can be discarded. An issued invoice can be cancelled, with a reason.");
    await tx.changeRequest.updateMany({ where: { invoiceItem: { invoiceId: id } }, data: { status: "APPROVED", invoiceItemId: null } });
    await tx.invoice.update({ where: { id }, data: { status: "CANCELLED", paymentStatus: "CANCELLED", balanceDue: 0, cancelledAt: new Date(), cancelReason: "Draft discarded" } });
    await logActivity(tx, { actorId, action: "invoice.draft_discarded", entityType: "Invoice", entityId: id, clientId: invoice.clientId });
  });
}

/** Keeps its number and record. If money has been received or credited, those must be dealt with first. */
export async function cancelInvoice(db: Db, id: string, reason: string, actorId: string) {
  await db.$transaction(async (tx) => {
    await lockInvoice(tx, id);
    const invoice = await tx.invoice.findUnique({ where: { id }, include: { allocations: { where: { payment: { voidedAt: null } } }, creditNotes: true } });
    if (!invoice) throw new BusinessError("This invoice no longer exists.");
    if (invoice.status !== "ISSUED") throw new BusinessError("Only an issued invoice can be cancelled.");
    if (invoice.allocations.length) throw new BusinessError("Payments are applied to this invoice. Remove them from it first, and they'll become the client's advance.");
    if (invoice.creditNotes.length) throw new BusinessError("This invoice has a credit note, so it can't be cancelled.");
    await tx.changeRequest.updateMany({ where: { invoiceItem: { invoiceId: id } }, data: { status: "APPROVED", invoiceItemId: null } });
    await tx.invoice.update({ where: { id }, data: { status: "CANCELLED", paymentStatus: "CANCELLED", balanceDue: 0, cancelledAt: new Date(), cancelReason: reason } });
    await logActivity(tx, { actorId, action: "invoice.cancelled", entityType: "Invoice", entityId: id, clientId: invoice.clientId, changes: { number: invoice.number, reason } });
  });
}

/** Paid, TDS, credit notes, balance and status, worked out from the records. */
export async function recomputeInvoice(tx: Tx, id: string, today = todayKey()) {
  const invoice = await tx.invoice.findUniqueOrThrow({ where: { id }, include: { allocations: { where: { payment: { voidedAt: null } } }, creditNotes: true } });
  const amountPaid = sum(invoice.allocations.map((a) => a.amount));
  const tdsTotal = sum(invoice.allocations.map((a) => a.tdsAmount));
  const creditedTotal = sum(invoice.creditNotes.map((c) => c.totalAmount));
  const balanceDue = invoiceBalance({ grandTotal: invoice.grandTotal, amountPaid, tdsTotal, creditedTotal });
  const paymentStatus = invoice.status === "DRAFT" ? "UNPAID" : computePaymentStatus({ status: invoice.status, grandTotal: invoice.grandTotal, amountPaid, tdsTotal, creditedTotal, dueDateKey: dateOnlyKey(invoice.dueDate), todayKey: today });
  return tx.invoice.update({ where: { id }, data: { amountPaid: money(amountPaid), tdsTotal: money(tdsTotal), creditedTotal: money(creditedTotal), balanceDue: money(balanceDue), paymentStatus } });
}

/** Unpaid invoices become Overdue the day after their due date. */
export async function markOverdueInvoices(db: Db | Tx, today = todayKey()) {
  const { count } = await db.invoice.updateMany({
    where: { type: "TAX", status: "ISSUED", paymentStatus: { in: ["UNPAID", "PARTIALLY_PAID"] }, balanceDue: { gt: 0 }, dueDate: { lt: keyToDate(today) } },
    data: { paymentStatus: "OVERDUE" },
  });
  return count;
}

/** A correction to an issued invoice, line by line, at that line's GST rate. Can't credit more than is still unpaid. */
export async function createCreditNote(db: Db, input: { invoiceId: string; date: string; reason: string; lines: { itemId: string; taxable: string }[] }, actorId: string, today = todayKey()) {
  return db.$transaction(async (tx) => {
    await lockInvoice(tx, input.invoiceId);
    const invoice = await tx.invoice.findUnique({ where: { id: input.invoiceId }, include: { items: true, creditNotes: true } });
    if (!invoice) throw new BusinessError("This invoice no longer exists.");
    if (invoice.type !== "TAX" || invoice.status !== "ISSUED") throw new BusinessError("A credit note can only be raised on an issued tax invoice.");
    if (input.date > today) throw new BusinessError("The credit note date can't be in the future.");
    if (input.date < dateOnlyKey(invoice.invoiceDate)) throw new BusinessError("The credit note date can't be before the invoice date.");

    const credited = new Map<string, ReturnType<typeof toDecimal>>();
    for (const cn of invoice.creditNotes) for (const l of (cn.lines as { itemId?: string; taxable: string }[] | null) ?? []) if (l.itemId) credited.set(l.itemId, (credited.get(l.itemId) ?? toDecimal(0)).plus(l.taxable));

    const chosen = input.lines.filter((l) => toDecimal(l.taxable || 0).greaterThan(0));
    if (!chosen.length) throw new BusinessError("Enter an amount on at least one line.");
    const rows = chosen.map((l) => {
      const item = invoice.items.find((i) => i.id === l.itemId);
      if (!item) throw new BusinessError("That line isn't on this invoice.");
      const remaining = toDecimal(item.taxableValue).minus(credited.get(item.id) ?? 0);
      if (toDecimal(l.taxable).greaterThan(remaining)) throw new BusinessError(`“${item.description}” has only ₹${remaining.toFixed(2)} left to credit.`);
      return { item, taxable: toDecimal(l.taxable) };
    });
    const totals = computeTotals(rows.map((r) => ({ quantity: 1, rate: r.taxable, gstRate: r.item.gstRate })), invoice.taxMode);
    if (totals.grandTotal.greaterThan(toDecimal(invoice.balanceDue))) {
      throw new BusinessError(`This credit note is ₹${totals.grandTotal.toFixed(2)}, but only ₹${toDecimal(invoice.balanceDue).toFixed(2)} is unpaid. Remove the payment from this invoice first, and it'll become the client's advance.`);
    }
    const number = await nextDocNumber(tx, "CREDIT_NOTE", input.date);
    const note = await tx.creditNote.create({
      data: {
        number, invoiceId: invoice.id, clientId: invoice.clientId, date: keyToDate(input.date), reason: input.reason, taxableAmount: money(totals.taxableTotal),
        cgstAmount: money(totals.cgstTotal), sgstAmount: money(totals.sgstTotal), igstAmount: money(totals.igstTotal), roundOff: money(totals.roundOff), totalAmount: money(totals.grandTotal), createdById: actorId,
        lines: rows.map((r, n) => {
          const line = computeLine({ quantity: 1, rate: r.taxable, gstRate: r.item.gstRate }, invoice.taxMode);
          return { itemId: r.item.id, description: r.item.description, sacCode: r.item.sacCode, gstRate: r.item.gstRate.toString(), taxable: money(line.taxable), cgst: money(totals.lines[n].cgst), sgst: money(totals.lines[n].sgst), igst: money(totals.lines[n].igst), total: money(line.total) };
        }),
      },
    });
    await recomputeInvoice(tx, invoice.id, today);
    await logActivity(tx, { actorId, action: "invoice.credit_note", entityType: "Invoice", entityId: invoice.id, clientId: invoice.clientId, changes: { creditNote: number, total: money(totals.grandTotal), reason: input.reason } });
    return note;
  });
}

async function convertInTx(tx: Tx, id: string, date: string, actorId: string, today: string) {
  const proforma = await tx.invoice.findUnique({ where: { id }, include: { items: { orderBy: { sortOrder: "asc" } }, convertedTo: { select: { id: true } } } });
  if (!proforma) throw new BusinessError("This invoice no longer exists.");
  if (proforma.type !== "PROFORMA" || proforma.status !== "ISSUED") throw new BusinessError("Only an issued proforma invoice can be converted.");
  if (proforma.convertedTo) throw new BusinessError("This proforma has already been converted.");
  const settings = await tx.settings.findUniqueOrThrow({ where: { id: "agency" } });
  const days = Math.max(0, Math.round((proforma.dueDate.getTime() - proforma.invoiceDate.getTime()) / 86_400_000));
  const draft = await tx.invoice.create({
    data: {
      type: "TAX", source: proforma.source, clientId: proforma.clientId, projectId: proforma.projectId, milestoneId: proforma.milestoneId, assetId: proforma.assetId, retainerMonth: proforma.retainerMonth,
      convertedFromId: proforma.id, invoiceDate: keyToDate(date), dueDate: keyToDate(addDaysKey(date, days || settings.defaultPaymentTermsDays)), placeOfSupply: proforma.placeOfSupply, taxMode: proforma.taxMode,
      subtotal: proforma.subtotal, discountTotal: proforma.discountTotal, taxableTotal: proforma.taxableTotal, cgstTotal: proforma.cgstTotal, sgstTotal: proforma.sgstTotal, igstTotal: proforma.igstTotal, roundOff: proforma.roundOff, grandTotal: proforma.grandTotal, amountInWords: proforma.amountInWords, balanceDue: proforma.grandTotal,
      terms: proforma.terms, notes: proforma.notes, createdById: actorId,
      items: { create: proforma.items.map(({ serviceId, description, sacCode, quantity, unit, rate, discountType, discountValue, taxableValue, gstRate, cgstAmount, sgstAmount, igstAmount, lineTotal, sortOrder }) => ({ serviceId, description, sacCode, quantity, unit, rate, discountType, discountValue, taxableValue, gstRate, cgstAmount, sgstAmount, igstAmount, lineTotal, sortOrder })) },
    },
  });
  const issued = await issueInTx(tx, draft.id, actorId, today);
  await tx.invoice.update({ where: { id: proforma.id }, data: { status: "CONVERTED", balanceDue: 0 } });
  await logActivity(tx, { actorId, action: "invoice.converted", entityType: "Invoice", entityId: proforma.id, clientId: proforma.clientId, changes: { from: proforma.number, to: issued.number } });
  return issued;
}

/** A proforma becomes a tax invoice with its own number. The checks for issuing apply. */
export async function convertProforma(db: Db, id: string, date: string, actorId: string, today = todayKey()) {
  return db.$transaction(async (tx) => {
    await lockInvoice(tx, id);
    return convertInTx(tx, id, date, actorId, today);
  });
}

/** An advance has arrived against a proforma: it becomes a tax invoice dated that day, and the advance is applied. */
export async function convertAndApplyAdvance(db: Db, input: { proformaId: string; paymentId: string }, actorId: string, today = todayKey()) {
  return db.$transaction(async (tx) => {
    await lockInvoice(tx, input.proformaId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.paymentId}))`;
    const payment = await tx.payment.findUnique({ where: { id: input.paymentId }, include: { allocations: true } });
    if (!payment || payment.voidedAt) throw new BusinessError("This payment no longer exists.");
    const proforma = await tx.invoice.findUnique({ where: { id: input.proformaId }, select: { clientId: true } });
    if (proforma?.clientId !== payment.clientId) throw new BusinessError("That proforma belongs to another client.");
    const left = toDecimal(payment.amount).minus(sum(payment.allocations.map((a) => a.amount)));
    if (!left.greaterThan(0)) throw new BusinessError("Nothing is left of this payment to apply.");
    const issued = await convertInTx(tx, input.proformaId, dateOnlyKey(payment.date), actorId, today);
    const apply = left.greaterThan(toDecimal(issued.grandTotal)) ? toDecimal(issued.grandTotal) : left;
    await tx.paymentAllocation.create({ data: { paymentId: payment.id, invoiceId: issued.id, amount: money(apply) } });
    await recomputeInvoice(tx, issued.id, today);
    await logActivity(tx, { actorId, action: "payment.applied", entityType: "Payment", entityId: payment.id, clientId: payment.clientId, changes: { invoice: issued.number, amount: money(apply) } });
    return issued;
  });
}

// ─── Starting a draft from existing work ─────────────────────────────────────

type DraftLine = { serviceId?: string | null; description: string; sacCode?: string | null; quantity: string; unit?: string | null; rate: string; discountType?: string | null; discountValue?: string; gstRate: string; changeRequestId?: string };

async function createDraftFrom(tx: Tx, input: { clientId: string; projectId?: string | null; milestoneId?: string; retainerMonth?: string; assetId?: string; source: "PROJECT" | "MILESTONE" | "RETAINER_MONTH" | "RENEWAL" | "CHANGE_REQUEST"; gstEnabled?: boolean; lines: DraftLine[]; dateKey: string; actorId: string | null }) {
  const client = await assertClientAndProject(tx, input.clientId, input.projectId ?? null);
  const settings = await tx.settings.findUniqueOrThrow({ where: { id: "agency" } });
  const mode = taxModeFor(client, settings.stateCode, input.gstEnabled ?? settings.gstEnabledByDefault);
  const items: Item[] = input.lines.map((l) => ({ serviceId: l.serviceId ?? null, description: l.description, sacCode: l.sacCode ?? null, quantity: l.quantity, unit: l.unit ?? null, rate: l.rate, discountType: (l.discountType as "PERCENT" | "AMOUNT" | null) ?? null, discountValue: l.discountValue ?? "0", gstRate: l.gstRate }));
  const { columns, rows } = computed(items, mode);
  const invoice = await tx.invoice.create({
    data: {
      ...columns, type: "TAX", source: input.source, clientId: input.clientId, projectId: input.projectId ?? null, milestoneId: input.milestoneId, retainerMonth: input.retainerMonth, assetId: input.assetId,
      invoiceDate: keyToDate(input.dateKey), dueDate: keyToDate(addDaysKey(input.dateKey, settings.defaultPaymentTermsDays)), placeOfSupply: placeOfSupply(client, mode), taxMode: mode, terms: settings.invoiceTerms, createdById: input.actorId,
      items: { create: rows },
    },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  for (const [n, line] of input.lines.entries()) {
    if (line.changeRequestId) await tx.changeRequest.update({ where: { id: line.changeRequestId }, data: { invoiceItemId: invoice.items[n].id, status: "INVOICED" } });
  }
  await logActivity(tx, { actorId: input.actorId, action: "invoice.draft_created", entityType: "Invoice", entityId: invoice.id, clientId: invoice.clientId, changes: { source: input.source, total: columns.grandTotal } });
  return invoice;
}

/** One-time work on a project that has no invoice yet. */
export async function createProjectDraft(db: Db, projectId: string, actorId: string, today = todayKey()) {
  return db.$transaction(async (tx) => {
    const project = await tx.project.findUnique({ where: { id: projectId }, include: { services: { where: { isActive: true, billingType: { not: "MONTHLY_RETAINER" } }, include: { service: true } }, offer: { select: { taxMode: true } }, milestones: { where: { paymentPercent: { not: null } }, select: { id: true } } } });
    if (!project) throw new BusinessError("This project no longer exists.");
    if (!project.services.length) throw new BusinessError("This project has no one-time work to invoice.");
    if (project.milestones.length) throw new BusinessError("This project bills by milestone. Invoice each milestone from the Milestones tab.");
    const existing = await tx.invoice.findFirst({ where: { projectId, source: "PROJECT", status: { not: "CANCELLED" } } });
    if (existing) return existing;
    return createDraftFrom(tx, {
      clientId: project.clientId, projectId, source: "PROJECT", dateKey: today, actorId, gstEnabled: project.offer ? project.offer.taxMode !== "NO_GST" : undefined,
      lines: project.services.map((s) => ({ serviceId: s.serviceId, description: s.description ?? s.service.name, sacCode: s.service.sacCode, quantity: s.quantity.toString(), unit: s.service.unit, rate: s.rate.toString(), discountType: s.discountType, discountValue: s.discountValue.toString(), gstRate: s.gstRate.toString() })),
    });
  });
}

/** A milestone's share of the one-time work, before GST. Billed once, unless its invoice was cancelled. */
export async function createMilestoneDraft(db: Db, milestoneId: string, actorId: string, today = todayKey()) {
  return db.$transaction(async (tx) => {
    await lockInvoice(tx, milestoneId);
    const milestone = await tx.milestone.findUnique({
      where: { id: milestoneId },
      include: { invoices: { where: { status: { not: "CANCELLED" } }, select: { id: true } }, project: { include: { offer: { include: { items: { include: { service: { select: { sacCode: true, unit: true } } } } } }, services: { where: { isActive: true }, include: { service: true } } } } },
    });
    if (!milestone) throw new BusinessError("This milestone no longer exists.");
    if (milestone.invoices.length) throw new BusinessError("This milestone already has an invoice.");
    if (!milestone.paymentPercent) throw new BusinessError("Set this milestone's payment % first.");
    const { project } = milestone;
    const items = project.offer
      ? project.offer.items.map((i) => ({ billingType: i.billingType as string, description: i.description, taxableValue: i.taxableValue, gstRate: i.gstRate.toString(), sacCode: i.sacCode ?? i.service?.sacCode ?? null, serviceId: i.serviceId, unit: null as string | null }))
      : project.services.map((s) => ({ billingType: s.billingType as string, description: s.description ?? s.service.name, taxableValue: computeLine({ quantity: s.quantity, rate: s.rate, discountType: s.discountType, discountValue: s.discountValue, gstRate: s.gstRate }, "NO_GST").taxable, gstRate: s.gstRate.toString(), sacCode: s.service.sacCode, serviceId: s.serviceId, unit: null as string | null }));
    const lines = milestoneLines(items, { name: milestone.name, percent: milestone.paymentPercent });
    if (!lines.length) throw new BusinessError("This project has no one-time work for a milestone to bill.");
    return createDraftFrom(tx, {
      clientId: project.clientId, projectId: project.id, milestoneId, source: "MILESTONE", dateKey: today, actorId, gstEnabled: project.offer ? project.offer.taxMode !== "NO_GST" : undefined,
      lines: lines.map((l) => ({ serviceId: l.item.serviceId, description: l.description, sacCode: l.item.sacCode, quantity: "1", rate: l.rate.toFixed(2), gstRate: l.item.gstRate })),
    });
  });
}

/** A month's retainer. The run key means a month is drafted once, by the job or by hand. Returns null if it already was. */
export async function createRetainerDraftInTx(tx: Tx, projectId: string, month: string, actorId: string | null, today: string) {
  const project = await tx.project.findUnique({ where: { id: projectId }, include: { services: { where: { isActive: true, billingType: "MONTHLY_RETAINER" }, include: { service: true } }, offer: { select: { taxMode: true } } } });
  if (!project?.isRetainer || !project.services.length) return null;
  const { count } = await tx.invoiceRun.createMany({ data: [{ key: `retainer:${projectId}:${month}` }], skipDuplicates: true });
  if (!count) return null;
  if (await tx.invoice.count({ where: { projectId, retainerMonth: month, status: { not: "CANCELLED" } } })) return null;
  const { start } = monthRange(`${month}-01`);
  const name = formatMonthKey(month);
  return createDraftFrom(tx, {
    clientId: project.clientId, projectId, retainerMonth: month, source: "RETAINER_MONTH", dateKey: start > today ? start : today, actorId, gstEnabled: project.offer ? project.offer.taxMode !== "NO_GST" : undefined,
    lines: project.services.map((s) => ({ serviceId: s.serviceId, description: `${s.description ?? s.service.name}: ${name}`, sacCode: s.service.sacCode, quantity: "1", unit: "month", rate: s.monthlyValue.toString(), gstRate: s.gstRate.toString() })),
  });
}

export async function createRetainerDraft(db: Db, projectId: string, month: string, actorId: string, today = todayKey()) {
  return db.$transaction(async (tx) => {
    const invoice = await createRetainerDraftInTx(tx, projectId, month, actorId, today);
    if (invoice) return invoice;
    const existing = await tx.invoice.findFirst({ where: { projectId, retainerMonth: month, status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" } });
    if (existing) return existing;
    throw new BusinessError(`${formatMonthKey(month)} has already been invoiced, or this project has no monthly services.`);
  });
}

/** A renewal, at its renewal price. Once per expiry date, by the job or by hand. Returns null if it already was. */
export async function createRenewalDraftInTx(tx: Tx, assetId: string, actorId: string | null, today: string) {
  const asset = await tx.domainHostingAsset.findUnique({ where: { id: assetId } });
  if (!asset || asset.archivedAt || !toDecimal(asset.renewalPrice).greaterThan(0)) return null;
  const expiry = dateOnlyKey(asset.expiryDate);
  const { count } = await tx.invoiceRun.createMany({ data: [{ key: `renewal:${assetId}:${expiry}` }], skipDuplicates: true });
  if (!count) return null;
  if (await tx.invoice.count({ where: { assetId, status: { not: "CANCELLED" }, invoiceDate: { gte: keyToDate(addDaysKey(expiry, -60)) } } })) return null;
  const service = await tx.service.findFirst({ where: { slug: "domain-hosting" } });
  const settings = await tx.settings.findUniqueOrThrow({ where: { id: "agency" } });
  return createDraftFrom(tx, {
    clientId: asset.clientId, assetId, source: "RENEWAL", dateKey: today, actorId,
    lines: [{ serviceId: service?.id, description: `${assetKindLabel(asset.kind)} renewal: ${asset.name} (expires ${formatDateKey(expiry)})`, sacCode: service?.sacCode, quantity: "1", unit: "year", rate: asset.renewalPrice.toString(), gstRate: (service?.gstRate ?? settings.defaultGstRate).toString() }],
  });
}

export async function createRenewalDraft(db: Db, assetId: string, actorId: string, today = todayKey()) {
  return db.$transaction(async (tx) => {
    const invoice = await createRenewalDraftInTx(tx, assetId, actorId, today);
    if (invoice) return invoice;
    const asset = await tx.domainHostingAsset.findUnique({ where: { id: assetId } });
    if (!asset || asset.archivedAt) throw new BusinessError("This item no longer exists.");
    if (!toDecimal(asset.renewalPrice).greaterThan(0)) throw new BusinessError("Set a renewal price first.");
    const existing = await tx.invoice.findFirst({ where: { assetId, status: { not: "CANCELLED" }, invoiceDate: { gte: keyToDate(addDaysKey(dateOnlyKey(asset.expiryDate), -330)) } }, orderBy: { createdAt: "desc" } });
    if (existing) return existing;
    throw new BusinessError("A renewal invoice for this expiry date was already made and cancelled. Use a new invoice instead.");
  });
}

/** Billable change requests that are approved, on one draft. They come off it if the draft is discarded. */
export async function createChangeRequestDraft(db: Db, input: { projectId: string; ids: string[] }, actorId: string, today = todayKey()) {
  return db.$transaction(async (tx) => {
    const project = await tx.project.findUnique({ where: { id: input.projectId }, include: { offer: { select: { taxMode: true } } } });
    if (!project) throw new BusinessError("This project no longer exists.");
    const rows = await tx.changeRequest.findMany({ where: { id: { in: input.ids }, projectId: project.id, status: "APPROVED", isBillable: true, invoiceItemId: null } });
    if (!rows.length) throw new BusinessError("Only approved, billable change requests can be invoiced.");
    const settings = await tx.settings.findUniqueOrThrow({ where: { id: "agency" } });
    return createDraftFrom(tx, {
      clientId: project.clientId, projectId: project.id, source: "CHANGE_REQUEST", dateKey: today, actorId, gstEnabled: project.offer ? project.offer.taxMode !== "NO_GST" : undefined,
      lines: rows.map((r) => ({ description: `Change request: ${r.description}`.slice(0, 480), quantity: "1", rate: r.estimate.toString(), gstRate: settings.defaultGstRate.toString(), changeRequestId: r.id })),
    });
  });
}

/**
 * The daily job's drafts: each retainer's month on its day, and renewals 30 days before expiry. Always
 * drafts for you to review, never sent. It marks overdue invoices too. Safe to run any number of times.
 */
export async function runInvoiceJob(db: Db, today = todayKey()) {
  const overdue = await markOverdueInvoices(db, today);
  const month = monthKeyOf(today);
  const day = Number(today.slice(8, 10));
  const retainers = await db.project.findMany({ where: { archivedAt: null, status: "ACTIVE", isRetainer: true, retainerTaskDay: { lte: day }, retainerStart: { lte: keyToDate(monthRange(today).end) }, OR: [{ retainerEnd: null }, { retainerEnd: { gte: keyToDate(`${month}-01`) } }] }, select: { id: true, name: true } });
  const assets = await db.domainHostingAsset.findMany({ where: { archivedAt: null, renewalPrice: { gt: 0 }, expiryDate: { lte: keyToDate(addDaysKey(today, 30)) } }, select: { id: true, name: true } });
  let drafts = 0;
  const admins = await db.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
  const tell = async (tx: Tx, id: string, title: string, body: string) => tx.notification.createMany({ data: admins.map((a) => ({ userId: a.id, title, body, href: `/invoices/${id}` })) });
  for (const p of retainers) {
    await db.$transaction(async (tx) => {
      const invoice = await createRetainerDraftInTx(tx, p.id, month, null, today);
      if (invoice) {
        drafts++;
        await tell(tx, invoice.id, "Retainer invoice ready to review", `${p.name}: ${formatMonthKey(month)}`);
      }
    });
  }
  for (const a of assets) {
    await db.$transaction(async (tx) => {
      const invoice = await createRenewalDraftInTx(tx, a.id, null, today);
      if (invoice) {
        drafts++;
        await tell(tx, invoice.id, "Renewal invoice ready to review", a.name);
      }
    });
  }
  return { overdue, drafts };
}

export const parseInvoice = (input: InvoiceInput) => invoiceSchema.safeParse(input);
