"use server";

import { revalidatePath } from "next/cache";
import { invalid, type ActionResult } from "@/lib/action-result";
import { assertPermission } from "@/lib/auth-guard";
import { dateOnlyKey, formatDateKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { fillTemplate, sendMail } from "@/lib/mailer";
import { pdfFileName, renderOfferPdf } from "@/lib/pdf/offer-pdf";
import { publicOfferUrl } from "@/lib/public-token";
import { isOpen } from "@/lib/offer-status";
import {
  offerSchema,
  offerStatusSchema,
  sendOfferSchema,
  templateSchema,
  type OfferInput,
  type OfferStatusInput,
  type SendOfferInput,
  type TemplateInput,
} from "@/lib/validators/offer";
import { isValidDateKey } from "@/lib/validators/common";
import { runAction } from "@/server/action-guard";
import {
  changeOfferStatus,
  createOffer,
  duplicateOffer,
  ensureOfferLink,
  loadOfferDocument,
  markOfferSent,
  offerToTemplate,
  prepareForSending,
  reviseOffer,
  saveTemplate,
  setOfferArchived,
  setOfferFollowUp,
  updateDraftOffer,
} from "@/server/services/offers";

function refresh(id?: string) {
  revalidatePath("/offers");
  if (id) revalidatePath(`/offers/${id}`);
  revalidatePath("/dashboard");
}

export async function saveOfferAction(id: string | null, input: OfferInput): Promise<ActionResult> {
  return runAction("sales.manage", async (user) => {
    const parsed = offerSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const offer = id ? await updateDraftOffer(db, id, parsed.data, user.id) : await createOffer(db, parsed.data, user.id);
    refresh(offer.id);
    return { ok: true, id: offer.id, message: id ? "Draft saved." : `Draft ${offer.number} created.` };
  });
}

/** Words for the email and WhatsApp messages, from your editable template. */
async function shareMessage(offerId: string, link: string) {
  const [loaded, template] = await Promise.all([loadOfferDocument(db, offerId), db.emailTemplate.findUnique({ where: { key: "offer_send" } })]);
  if (!loaded) return null;
  const { offer, doc, settings } = loaded;
  const values = {
    contactName: doc.recipient.contact ?? doc.recipient.name,
    offerNumber: offer.number,
    offerTitle: offer.title,
    offerLink: link,
    validUntil: formatDateKey(dateOnlyKey(offer.validUntil)),
    agencyName: settings.agencyName,
  };
  return {
    doc,
    logoKey: settings.logoKey,
    subject: fillTemplate(template?.subject ?? "Quotation {{offerNumber}} from {{agencyName}}", values),
    body: fillTemplate(template?.body ?? "Dear {{contactName}},\n\nPlease see our quotation {{offerNumber}}: {{offerLink}}\n\nValid until {{validUntil}}.\n\n{{agencyName}}", values),
    whatsapp: fillTemplate(template?.whatsapp ?? "Hello {{contactName}}, please see our quotation {{offerNumber}}: {{offerLink}}", values),
    phone: doc.recipient.phone ?? null,
  };
}

export type SendResult = { ok: true; message: string; link: string; whatsapp: string; phone: string | null } | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * Sends the offer. The status only becomes Sent after the email has really gone, so a failed
 * email never leaves an offer looking delivered when it wasn't.
 */
export async function sendOfferAction(input: SendOfferInput): Promise<SendResult> {
  let result: SendResult | undefined;
  const outcome = await runAction("sales.manage", async (user) => {
    const parsed = sendOfferSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const { offerId, channel, to, followUpDate, changeNote } = parsed.data;
    if (channel === "email" && !to) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: { to: "Enter the email address to send to" } };

    const link = await prepareForSending(db, offerId, user.id);
    const url = publicOfferUrl(link.id);
    const share = await shareMessage(offerId, url);
    if (!share) return { ok: false, error: "This offer no longer exists." };

    if (channel === "email") {
      const pdf = await renderOfferPdf(share.doc, share.logoKey);
      const mail = await sendMail({
        to: to!,
        subject: share.subject,
        text: share.body,
        templateKey: "offer_send",
        entityType: "Offer",
        entityId: offerId,
        attachments: [{ filename: pdfFileName(share.doc.number), content: pdf, contentType: "application/pdf" }],
      });
      if (!mail.ok) return { ok: false, error: `The email could not be sent, so the offer was not marked as sent. ${mail.error ?? ""}`.trim() };
    }
    await markOfferSent(db, { offerId, followUpDate, changeNote, actorId: user.id, via: channel === "email" ? "email" : "WhatsApp or by hand" });
    refresh(offerId);
    result = { ok: true, message: channel === "email" ? `Emailed to ${to}.` : "Marked as sent.", link: url, whatsapp: share.whatsapp, phone: share.phone };
    return { ok: true };
  });
  if (result) return result;
  if (outcome.ok) return { ok: false, error: "Something went wrong." };
  return { ok: false, error: outcome.error, fieldErrors: outcome.fieldErrors };
}

/** The link and message for sharing an offer that has already gone out. */
export async function getShareLinkAction(offerId: string): Promise<SendResult> {
  try {
    const user = await assertPermission("sales.manage");
    const offer = await db.offer.findUnique({ where: { id: offerId } });
    if (!offer || !isOpen(offer.status) || offer.archivedAt) return { ok: false, error: "Only offers that are Sent or On Hold can be shared." };
    const link = await ensureOfferLink(db, offerId, user.id);
    const url = publicOfferUrl(link.id);
    const share = await shareMessage(offerId, url);
    if (!share) return { ok: false, error: "This offer no longer exists." };
    return { ok: true, message: "Link ready.", link: url, whatsapp: share.whatsapp, phone: share.phone };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." };
  }
}

export async function changeOfferStatusAction(input: OfferStatusInput): Promise<ActionResult> {
  return runAction("sales.manage", async (user) => {
    const parsed = offerStatusSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await changeOfferStatus(db, { ...parsed.data, actorId: user.id });
    refresh(parsed.data.offerId);
    return { ok: true, message: "Status updated." };
  });
}

export async function setFollowUpAction(offerId: string, followUpDate: string): Promise<ActionResult> {
  return runAction("sales.manage", async (user) => {
    if (!isValidDateKey(followUpDate)) return { ok: false, error: "Please choose a valid date." };
    await setOfferFollowUp(db, offerId, followUpDate, user.id);
    refresh(offerId);
    return { ok: true, message: "Follow-up date saved." };
  });
}

export async function reviseOfferAction(offerId: string): Promise<ActionResult> {
  return runAction("sales.manage", async (user) => {
    await reviseOffer(db, offerId, user.id);
    refresh(offerId);
    return { ok: true, id: offerId, message: "New version started. The client's old link no longer works." };
  });
}

export async function duplicateOfferAction(offerId: string): Promise<ActionResult> {
  return runAction("sales.manage", async (user) => {
    const copy = await duplicateOffer(db, offerId, user.id);
    refresh(copy.id);
    return { ok: true, id: copy.id, message: `Copied to ${copy.number}.` };
  });
}

export async function setOfferArchivedAction(offerId: string, archived: boolean): Promise<ActionResult> {
  return runAction("sales.manage", async (user) => {
    await setOfferArchived(db, offerId, archived, user.id);
    refresh(offerId);
    revalidatePath("/offers/templates");
    return { ok: true, message: archived ? "Archived." : "Restored." };
  });
}

export async function saveTemplateAction(id: string | null, input: TemplateInput): Promise<ActionResult> {
  return runAction("sales.manage", async (user) => {
    const parsed = templateSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const template = await saveTemplate(db, id, parsed.data, user.id);
    revalidatePath("/offers/templates");
    return { ok: true, id: template.id, message: "Template saved." };
  });
}

export async function offerToTemplateAction(offerId: string, name: string): Promise<ActionResult> {
  return runAction("sales.manage", async (user) => {
    const clean = name.trim();
    if (clean.length < 2 || clean.length > 120) return { ok: false, error: "Please name the template." };
    const template = await offerToTemplate(db, offerId, clean, user.id);
    revalidatePath("/offers/templates");
    return { ok: true, id: template.id, message: "Saved as a template." };
  });
}
