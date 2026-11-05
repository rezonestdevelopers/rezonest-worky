"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { invalid, type ActionResult } from "@/lib/action-result";
import { assertPermission } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { formatDateKey, dateOnlyKey } from "@/lib/dates";
import { renderTemplate } from "@/lib/email-templates";
import { sendMail } from "@/lib/mailer";
import { formatINR } from "@/lib/money/format";
import { pdfFileName, renderInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { isValidDateKey } from "@/lib/validators/common";
import { creditNoteSchema, invoiceSchema, paymentSchema, reasonSchema, type CreditNoteInput, type InvoiceInput, type PaymentInput } from "@/lib/validators/invoice";
import { runAction } from "@/server/action-guard";
import { getClientAdvances, getOpenInvoices, loadInvoice } from "@/server/queries/invoices";
import { getTemplate } from "@/server/services/email-templates";
import {
  cancelInvoice,
  convertAndApplyAdvance,
  convertProforma,
  createChangeRequestDraft,
  createCreditNote,
  createMilestoneDraft,
  createProjectDraft,
  createRenewalDraft,
  createRetainerDraft,
  discardDraft,
  issueInvoice,
  saveDraftInvoice,
} from "@/server/services/invoices";
import { applyAdvance, recordPayment, removeAllocation, voidPayment } from "@/server/services/payments";
import { logActivity } from "@/server/services/shared";

const PERM = "finance.manage";

function refresh(id?: string) {
  revalidatePath("/invoices");
  revalidatePath("/payments");
  revalidatePath("/payments/ageing");
  if (id) revalidatePath(`/invoices/${id}`);
  revalidatePath("/dashboard");
}

export async function saveInvoiceAction(id: string | null, input: InvoiceInput): Promise<ActionResult> {
  return runAction(PERM, async (user) => {
    const parsed = invoiceSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const invoice = await saveDraftInvoice(db, id, parsed.data, user.id);
    refresh(invoice.id);
    return { ok: true, id: invoice.id, message: "Draft saved." };
  });
}

export async function issueInvoiceAction(id: string): Promise<ActionResult> {
  return runAction(PERM, async (user) => {
    const invoice = await issueInvoice(db, id, user.id);
    refresh(id);
    return { ok: true, id, message: `Issued as ${invoice.number}.` };
  });
}

export async function discardInvoiceAction(id: string): Promise<ActionResult> {
  return runAction(PERM, async (user) => {
    await discardDraft(db, id, user.id);
    refresh(id);
    return { ok: true, message: "Draft discarded." };
  });
}

export async function cancelInvoiceAction(id: string, reason: string): Promise<ActionResult> {
  return runAction(PERM, async (user) => {
    const parsed = reasonSchema.safeParse(reason);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
    await cancelInvoice(db, id, parsed.data, user.id);
    refresh(id);
    return { ok: true, message: "Invoice cancelled. Its number stays on record." };
  });
}

export async function convertProformaAction(id: string, date: string): Promise<ActionResult> {
  return runAction(PERM, async (user) => {
    if (!isValidDateKey(date)) return { ok: false, error: "Enter a valid date." };
    const invoice = await convertProforma(db, id, date, user.id);
    refresh(id);
    return { ok: true, id: invoice.id, message: `Tax invoice ${invoice.number} created.` };
  });
}

export async function createCreditNoteAction(input: CreditNoteInput): Promise<ActionResult> {
  return runAction(PERM, async (user) => {
    const parsed = creditNoteSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const note = await createCreditNote(db, parsed.data, user.id);
    refresh(parsed.data.invoiceId);
    return { ok: true, id: parsed.data.invoiceId, message: `Credit note ${note.number} created.` };
  });
}

const draftFrom = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project"), id: z.string().min(1) }),
  z.object({ kind: z.literal("milestone"), id: z.string().min(1) }),
  z.object({ kind: z.literal("renewal"), id: z.string().min(1) }),
  z.object({ kind: z.literal("retainer"), id: z.string().min(1), month: z.string().regex(/^\d{4}-\d{2}$/) }),
  z.object({ kind: z.literal("changes"), id: z.string().min(1), ids: z.array(z.string().min(1)).min(1).max(100) }),
]);

/** Makes a draft from existing work. Opening it for review is the next step: nothing is sent. */
export async function createDraftFromAction(input: z.input<typeof draftFrom>): Promise<ActionResult> {
  return runAction(PERM, async (user) => {
    const p = draftFrom.safeParse(input);
    if (!p.success) return { ok: false, error: "That request wasn't valid. Please reload and try again." };
    const d = p.data;
    const invoice =
      d.kind === "project"
        ? await createProjectDraft(db, d.id, user.id)
        : d.kind === "milestone"
          ? await createMilestoneDraft(db, d.id, user.id)
          : d.kind === "renewal"
            ? await createRenewalDraft(db, d.id, user.id)
            : d.kind === "retainer"
              ? await createRetainerDraft(db, d.id, d.month, user.id)
              : await createChangeRequestDraft(db, { projectId: d.id, ids: d.ids }, user.id);
    refresh(invoice.id);
    return { ok: true, id: invoice.id, message: "Draft ready to review." };
  });
}

const templateValues = (loaded: NonNullable<Awaited<ReturnType<typeof loadInvoice>>>, amount: string) => ({
  contactName: loaded.doc.client.contact ?? loaded.doc.client.name ?? "",
  invoiceNumber: loaded.doc.number,
  amount,
  dueDate: formatDateKey(dateOnlyKey(loaded.invoice.dueDate)),
  upiId: loaded.doc.bank.upiId ?? "",
  agencyName: loaded.doc.agency.name,
});

const sendSchema = z.object({ invoiceId: z.string().min(1), to: z.string().trim().toLowerCase().email("Enter a valid email address") });

export async function sendInvoiceEmailAction(input: { invoiceId: string; to: string }): Promise<ActionResult> {
  return runAction(PERM, async (user) => {
    const parsed = sendSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
    const loaded = await loadInvoice(parsed.data.invoiceId);
    if (!loaded) return { ok: false, error: "This invoice no longer exists." };
    if (loaded.invoice.status !== "ISSUED") return { ok: false, error: "Issue this invoice before sending it." };
    const message = renderTemplate(await getTemplate(db, "invoice_send"), templateValues(loaded, formatINR(loaded.invoice.grandTotal)));
    const pdf = await renderInvoicePdf(loaded.doc, { logoKey: loaded.logoKey, signatureKey: loaded.signatureKey, payAmount: loaded.invoice.balanceDue });
    const mail = await sendMail({ to: parsed.data.to, subject: message.subject, text: message.text, templateKey: "invoice_send", entityType: "Invoice", entityId: loaded.invoice.id, attachments: [{ filename: pdfFileName(loaded.doc.number), content: pdf, contentType: "application/pdf" }] });
    if (!mail.ok) return { ok: false, error: `The email could not be sent. ${mail.error ?? ""}`.trim() };
    await logActivity(db, { actorId: user.id, action: "invoice.emailed", entityType: "Invoice", entityId: loaded.invoice.id, clientId: loaded.invoice.clientId, changes: { to: parsed.data.to } });
    return { ok: true, message: `Sent to ${parsed.data.to}.` };
  });
}

const reminderSchema = z.object({
  invoiceId: z.string().min(1),
  level: z.enum(["polite", "firm", "final"]),
  channel: z.enum(["email", "whatsapp"]),
  to: z.string().trim().toLowerCase().email("Enter a valid email address").optional(),
});

/** Only ever runs from your click. A WhatsApp reminder opens on your phone; this just records it. */
export async function sendPaymentReminderAction(input: z.input<typeof reminderSchema>): Promise<ActionResult> {
  return runAction(PERM, async (user) => {
    const parsed = reminderSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
    const { invoiceId, level, channel, to } = parsed.data;
    const loaded = await loadInvoice(invoiceId);
    if (!loaded) return { ok: false, error: "This invoice no longer exists." };
    if (loaded.invoice.type !== "TAX" || loaded.invoice.status !== "ISSUED" || !loaded.invoice.balanceDue.greaterThan(0)) return { ok: false, error: "Nothing is owed on this invoice." };
    if (channel === "email") {
      if (!to) return { ok: false, error: "Enter the email address to send to." };
      const key = `payment_reminder_${level}`;
      const message = renderTemplate(await getTemplate(db, key), templateValues(loaded, formatINR(loaded.invoice.balanceDue)));
      const mail = await sendMail({ to, subject: message.subject, text: message.text, templateKey: key, entityType: "Invoice", entityId: invoiceId });
      if (!mail.ok) return { ok: false, error: `The email could not be sent. ${mail.error ?? ""}`.trim() };
    }
    await logActivity(db, { actorId: user.id, action: "invoice.payment_reminder", entityType: "Invoice", entityId: invoiceId, clientId: loaded.invoice.clientId, changes: { level, channel, ...(to ? { to } : {}) } });
    revalidatePath(`/invoices/${invoiceId}`);
    return { ok: true, message: channel === "email" ? `Reminder sent to ${to}.` : "WhatsApp reminder recorded." };
  });
}

export async function recordPaymentAction(input: PaymentInput): Promise<ActionResult> {
  return runAction(PERM, async (user) => {
    const parsed = paymentSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const payment = await recordPayment(db, parsed.data, user.id);
    refresh();
    revalidatePath(`/clients/${parsed.data.clientId}`);
    return { ok: true, id: payment.id, message: "Payment recorded." };
  });
}

const paymentRefresh = (paymentId: string, invoiceId?: string) => {
  refresh(invoiceId);
  revalidatePath(`/payments/${paymentId}`);
};

const applySchema = z.object({ paymentId: z.string().min(1), invoiceId: z.string().min(1), amount: z.string().trim().regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter an amount like 25000 or 25000.50") });

export async function applyAdvanceAction(input: z.input<typeof applySchema>): Promise<ActionResult> {
  return runAction(PERM, async (user) => {
    const parsed = applySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
    await applyAdvance(db, parsed.data, user.id);
    paymentRefresh(parsed.data.paymentId, parsed.data.invoiceId);
    return { ok: true, message: "Applied to the invoice." };
  });
}

export async function removeAllocationAction(input: { paymentId: string; invoiceId: string }): Promise<ActionResult> {
  return runAction(PERM, async (user) => {
    await removeAllocation(db, { paymentId: String(input.paymentId), invoiceId: String(input.invoiceId) }, user.id);
    paymentRefresh(input.paymentId, input.invoiceId);
    return { ok: true, message: "Removed. The money is now the client's advance." };
  });
}

export async function voidPaymentAction(id: string, reason: string): Promise<ActionResult> {
  return runAction(PERM, async (user) => {
    const parsed = reasonSchema.safeParse(reason);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
    await voidPayment(db, id, parsed.data, user.id);
    paymentRefresh(id);
    return { ok: true, message: "Payment voided. Its invoices owe that amount again." };
  });
}

export async function convertAndApplyAction(input: { proformaId: string; paymentId: string }): Promise<ActionResult> {
  return runAction(PERM, async (user) => {
    const invoice = await convertAndApplyAdvance(db, { proformaId: String(input.proformaId), paymentId: String(input.paymentId) }, user.id);
    paymentRefresh(input.paymentId, invoice.id);
    return { ok: true, id: invoice.id, message: `Tax invoice ${invoice.number} created and the advance applied.` };
  });
}

/** What the payment form needs once a client is chosen. */
export async function getClientOpenItemsAction(clientId: string) {
  await assertPermission(PERM);
  const [invoices, advances] = await Promise.all([getOpenInvoices(String(clientId)), getClientAdvances(String(clientId))]);
  return { invoices, advances };
}
