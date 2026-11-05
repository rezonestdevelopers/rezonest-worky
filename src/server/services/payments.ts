import { dateOnlyKey, keyToDate, todayKey } from "@/lib/dates";
import { advanceLeft, allocationError, buildLedger, paymentModeLabel, type LedgerEntry } from "@/lib/invoice-rules";
import { sum, toDecimal } from "@/lib/money";
import type { PaymentData } from "@/lib/validators/invoice";
import { lockInvoice, recomputeInvoice } from "./invoices";
import { BusinessError, logActivity, type Db, type Tx } from "./shared";

const money = (v: { toFixed(n: number): string }) => v.toFixed(2);

/** Applies money to an invoice. It must be this client's issued tax invoice, and can't go past its balance. */
async function applyToInvoice(tx: Tx, input: { paymentId: string; clientId: string; invoiceId: string; amount: string; tdsAmount: string }, today: string) {
  await lockInvoice(tx, input.invoiceId);
  const invoice = await tx.invoice.findUnique({ where: { id: input.invoiceId } });
  if (!invoice || invoice.clientId !== input.clientId) throw new BusinessError("That invoice isn't one of this client's.");
  if (invoice.type !== "TAX" || invoice.status !== "ISSUED") throw new BusinessError(`${invoice.number ?? "That invoice"} can't take a payment. Payments apply to issued tax invoices.`);
  const applying = toDecimal(input.amount).plus(toDecimal(input.tdsAmount));
  if (applying.greaterThan(toDecimal(invoice.balanceDue))) throw new BusinessError(`${invoice.number} has only ₹${toDecimal(invoice.balanceDue).toFixed(2)} left to pay.`);
  await tx.paymentAllocation.upsert({
    where: { paymentId_invoiceId: { paymentId: input.paymentId, invoiceId: input.invoiceId } },
    create: { paymentId: input.paymentId, invoiceId: input.invoiceId, amount: input.amount, tdsAmount: input.tdsAmount },
    update: { amount: { increment: input.amount }, tdsAmount: { increment: input.tdsAmount } },
  });
  await recomputeInvoice(tx, input.invoiceId, today);
}

/** Money received. It can be split across invoices; whatever isn't applied stays as the client's advance. */
export async function recordPayment(db: Db, data: PaymentData, actorId: string, today = todayKey()) {
  if (data.date > today) throw new BusinessError("The payment date can't be in the future.");
  const allocations = data.allocations.filter((a) => toDecimal(a.amount).greaterThan(0) || toDecimal(a.tdsAmount).greaterThan(0));
  const problem = allocationError({ amount: data.amount, tdsAmount: data.tdsAmount, allocations });
  if (problem) throw new BusinessError(problem);
  if (new Set(allocations.map((a) => a.invoiceId)).size !== allocations.length) throw new BusinessError("The same invoice is listed twice.");
  return db.$transaction(async (tx) => {
    const client = await tx.client.findUnique({ where: { id: data.clientId } });
    if (!client) throw new BusinessError("That client no longer exists.");
    if (data.reference && !data.allowDuplicate) {
      const same = await tx.payment.findFirst({ where: { clientId: data.clientId, reference: data.reference, amount: data.amount, voidedAt: null } });
      if (same) throw new BusinessError(`A payment of this amount with reference ${data.reference} is already recorded. If this is really a second one, tick the box to save it anyway.`);
    }
    const payment = await tx.payment.create({
      data: { clientId: data.clientId, date: keyToDate(data.date), amount: data.amount, tdsAmount: data.tdsAmount, tdsSection: toDecimal(data.tdsAmount).greaterThan(0) ? data.tdsSection : null, mode: data.mode, reference: data.reference, notes: data.notes, createdById: actorId },
    });
    for (const a of allocations) await applyToInvoice(tx, { paymentId: payment.id, clientId: data.clientId, invoiceId: a.invoiceId, amount: a.amount, tdsAmount: a.tdsAmount }, today);
    await logActivity(tx, { actorId, action: "payment.recorded", entityType: "Payment", entityId: payment.id, clientId: data.clientId, changes: { amount: data.amount, tds: data.tdsAmount, mode: data.mode, applied: money(sum(allocations.map((a) => a.amount))) } });
    return payment;
  });
}

/** Uses part of a client's advance against an invoice. */
export async function applyAdvance(db: Db, input: { paymentId: string; invoiceId: string; amount: string }, actorId: string, today = todayKey()) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.paymentId}))`;
    const payment = await tx.payment.findUnique({ where: { id: input.paymentId }, include: { allocations: true } });
    if (!payment || payment.voidedAt) throw new BusinessError("This payment no longer exists.");
    const left = advanceLeft(payment.amount, payment.allocations);
    if (!toDecimal(input.amount).greaterThan(0)) throw new BusinessError("Enter an amount to apply.");
    if (toDecimal(input.amount).greaterThan(left)) throw new BusinessError(`Only ₹${left.toFixed(2)} of this payment is left to apply.`);
    await applyToInvoice(tx, { paymentId: payment.id, clientId: payment.clientId, invoiceId: input.invoiceId, amount: input.amount, tdsAmount: "0" }, today);
    await logActivity(tx, { actorId, action: "payment.applied", entityType: "Payment", entityId: payment.id, clientId: payment.clientId, changes: { invoiceId: input.invoiceId, amount: input.amount } });
  });
}

/** Takes a payment off an invoice. The cash goes back to being the client's advance. TDS has no advance to go to, so it's cleared from the payment. */
export async function removeAllocation(db: Db, input: { paymentId: string; invoiceId: string }, actorId: string, today = todayKey()) {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.paymentId}))`;
    await lockInvoice(tx, input.invoiceId);
    const allocation = await tx.paymentAllocation.findUnique({ where: { paymentId_invoiceId: input }, include: { payment: true } });
    if (!allocation || allocation.payment.voidedAt) throw new BusinessError("This payment isn't applied to that invoice.");
    await tx.paymentAllocation.delete({ where: { id: allocation.id } });
    if (toDecimal(allocation.tdsAmount).greaterThan(0)) await tx.payment.update({ where: { id: input.paymentId }, data: { tdsAmount: { decrement: allocation.tdsAmount } } });
    await recomputeInvoice(tx, input.invoiceId, today);
    await logActivity(tx, { actorId, action: "payment.unapplied", entityType: "Payment", entityId: input.paymentId, clientId: allocation.payment.clientId, changes: { invoiceId: input.invoiceId, amount: allocation.amount.toString(), tds: allocation.tdsAmount.toString() } });
  });
}

/** For a mistaken entry or a bounced cheque. The record stays, marked void, and invoices go back to owing. */
export async function voidPayment(db: Db, id: string, reason: string, actorId: string, today = todayKey()) {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
    const payment = await tx.payment.findUnique({ where: { id }, include: { allocations: true } });
    if (!payment) throw new BusinessError("This payment no longer exists.");
    if (payment.voidedAt) throw new BusinessError("This payment is already void.");
    for (const a of payment.allocations) await lockInvoice(tx, a.invoiceId);
    await tx.payment.update({ where: { id }, data: { voidedAt: new Date(), voidReason: reason } });
    for (const a of payment.allocations) await recomputeInvoice(tx, a.invoiceId, today);
    await logActivity(tx, { actorId, action: "payment.voided", entityType: "Payment", entityId: id, clientId: payment.clientId, changes: { amount: payment.amount.toString(), reason } });
  });
}

/** A client's statement of account: tax invoices against money received, TDS and credit notes. Proformas aren't bills, so they stay out. */
export async function clientLedger(db: Db | Tx, clientId: string, from: string, to: string) {
  const [invoices, payments, notes] = await Promise.all([
    db.invoice.findMany({ where: { clientId, type: "TAX", status: "ISSUED" }, select: { number: true, invoiceDate: true, grandTotal: true, dueDate: true } }),
    db.payment.findMany({ where: { clientId, voidedAt: null }, select: { date: true, amount: true, tdsAmount: true, tdsSection: true, mode: true, reference: true } }),
    db.creditNote.findMany({ where: { clientId }, select: { number: true, date: true, totalAmount: true, reason: true } }),
  ]);
  const entries: LedgerEntry[] = [
    ...invoices.map((i): LedgerEntry => ({ dateKey: dateOnlyKey(i.invoiceDate), kind: "INVOICE", reference: i.number ?? "", description: "Invoice", debit: i.grandTotal, credit: 0 })),
    ...payments.flatMap((p): LedgerEntry[] => {
      const key = dateOnlyKey(p.date);
      const reference = p.reference ?? paymentModeLabel(p.mode);
      return [
        ...(toDecimal(p.amount).greaterThan(0) ? [{ dateKey: key, kind: "PAYMENT" as const, reference, description: "Payment received", debit: 0, credit: p.amount }] : []),
        ...(toDecimal(p.tdsAmount).greaterThan(0) ? [{ dateKey: key, kind: "TDS" as const, reference, description: `TDS deducted${p.tdsSection ? ` (${p.tdsSection})` : ""}`, debit: 0, credit: p.tdsAmount }] : []),
      ];
    }),
    ...notes.map((n): LedgerEntry => ({ dateKey: dateOnlyKey(n.date), kind: "CREDIT_NOTE", reference: n.number, description: `Credit note: ${n.reason}`, debit: 0, credit: n.totalAmount })),
  ];
  return buildLedger(entries, from, to);
}
