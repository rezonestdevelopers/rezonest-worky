import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { dateOnlyKey, addDaysKey, keyToDate, todayKey } from "@/lib/dates";
import { computeTotals, determineTaxMode, type TaxMode } from "@/lib/money/gst";
import { stateName } from "@/lib/india-states";
import { nextDocNumber } from "@/lib/numbering";
import { buildOfferDocument, type OfferDocInput } from "@/lib/offer-document";
import { canEdit, canRevise, isOpen, publicResponseError, statusChangeError } from "@/lib/offer-status";
import { hashPublicToken, looksLikeToken, publicToken } from "@/lib/public-token";
import type { OfferData, TemplateData } from "@/lib/validators/offer";
import { ensureOfferOnboarding } from "./onboarding";
import { BusinessError, logActivity, type Db, type Tx } from "./shared";

const money = (v: { toFixed(n: number): string }) => v.toFixed(2);
type ItemData = OfferData["items"][number];
type MilestoneData = OfferData["milestones"][number];

/** Works out the tax treatment. A client's own state decides it; a lead has only the state chosen on the offer. */
async function resolveTax(tx: Tx, input: { clientId?: string | null; gstEnabled: boolean; supplyStateCode?: string | null }) {
  const settings = await tx.settings.findUniqueOrThrow({ where: { id: "agency" } });
  let stateCode = input.supplyStateCode || settings.stateCode;
  let country = "India";
  if (input.clientId) {
    const client = await tx.client.findUnique({ where: { id: input.clientId } });
    if (!client) throw new BusinessError("That client no longer exists.");
    if (client.archivedAt) throw new BusinessError("That client is archived. Restore them first.");
    stateCode = client.stateCode;
    country = client.country;
  }
  const taxMode = determineTaxMode({ gstEnabled: input.gstEnabled, agencyStateCode: settings.stateCode, clientStateCode: stateCode, clientCountry: country });
  return { taxMode, supplyStateCode: stateCode };
}

/** Stored totals and item rows, from the same calculator used for invoices. */
function computed(items: ItemData[], taxMode: TaxMode) {
  const totals = computeTotals(items, taxMode);
  return {
    columns: {
      subtotal: money(totals.subtotal),
      discountTotal: money(totals.discountTotal),
      taxableTotal: money(totals.taxableTotal),
      taxTotal: money(totals.taxTotal),
      grandTotal: money(totals.grandTotal),
    },
    itemRows: items.map((item, i) => ({
      serviceId: item.serviceId,
      subServiceId: item.subServiceId,
      description: item.description,
      billingType: item.billingType,
      quantity: item.quantity,
      unit: item.unit,
      rate: item.rate,
      discountType: item.discountType,
      discountValue: item.discountValue,
      gstRate: item.gstRate,
      sacCode: item.sacCode,
      durationMonths: item.durationMonths,
      deliverables: item.deliverables.length ? item.deliverables : undefined,
      taxableValue: money(totals.lines[i].taxable),
      sortOrder: i,
    })),
  };
}

const milestoneRows = (list: MilestoneData[]) => list.map((m, i) => ({ name: m.name, percent: m.percent, sortOrder: i }));

const commonColumns = (d: OfferData | TemplateData) => ({
  title: d.title,
  offerDate: keyToDate(d.offerDate),
  validUntil: keyToDate(d.validUntil),
  durationMonths: d.durationMonths,
  paymentTerms: d.paymentTerms,
  terms: d.terms,
  notes: d.notes,
});

async function assertRecipient(tx: Tx, d: OfferData) {
  if (d.leadId) {
    const lead = await tx.lead.findUnique({ where: { id: d.leadId } });
    if (!lead || lead.archivedAt) throw new BusinessError("That lead no longer exists or is archived.");
    // A converted lead is a client now, so the offer belongs with the client.
    if (lead.convertedClientId) return { clientId: lead.convertedClientId, leadId: lead.id };
  }
  return { clientId: d.clientId, leadId: d.leadId };
}

export async function createOffer(db: Db, data: OfferData, actorId: string, duplicatedFromId?: string) {
  return db.$transaction(async (tx) => {
    const { clientId, leadId } = await assertRecipient(tx, data);
    const tax = await resolveTax(tx, { clientId, gstEnabled: data.gstEnabled, supplyStateCode: data.supplyStateCode });
    const { columns, itemRows } = computed(data.items, tax.taxMode);
    const number = await nextDocNumber(tx, "QUOTATION", data.offerDate);
    const offer = await tx.offer.create({
      data: {
        ...commonColumns(data),
        ...columns,
        ...tax,
        number,
        clientId,
        leadId,
        status: "DRAFT",
        duplicatedFromId,
        createdById: actorId,
        items: { create: itemRows },
        milestones: { create: milestoneRows(data.milestones) },
        statusHistory: { create: { toStatus: "DRAFT", changedById: actorId } },
      },
    });
    await logActivity(tx, { actorId, action: duplicatedFromId ? "offer.duplicated" : "offer.created", entityType: "Offer", entityId: offer.id, clientId, changes: { number } });
    return offer;
  });
}

export async function updateDraftOffer(db: Db, id: string, data: OfferData, actorId: string) {
  return db.$transaction(async (tx) => {
    const before = await tx.offer.findUnique({ where: { id } });
    if (!before || before.isTemplate) throw new BusinessError("This offer no longer exists.");
    if (before.archivedAt) throw new BusinessError("This offer is archived. Restore it before making changes.");
    if (!canEdit(before.status)) throw new BusinessError("Only drafts can be edited. Create a new version to change an offer that has been sent.");
    const { clientId, leadId } = await assertRecipient(tx, data);
    const tax = await resolveTax(tx, { clientId, gstEnabled: data.gstEnabled, supplyStateCode: data.supplyStateCode });
    const { columns, itemRows } = computed(data.items, tax.taxMode);
    await tx.offerItem.deleteMany({ where: { offerId: id } });
    await tx.offerMilestone.deleteMany({ where: { offerId: id } });
    const after = await tx.offer.update({
      where: { id },
      data: { ...commonColumns(data), ...columns, ...tax, clientId, leadId, items: { create: itemRows }, milestones: { create: milestoneRows(data.milestones) } },
    });
    await logActivity(tx, {
      actorId, action: "offer.updated", entityType: "Offer", entityId: id, clientId,
      changes: { grandTotal: { from: before.grandTotal.toString(), to: after.grandTotal.toString() } },
    });
    return after;
  });
}

const offerGraph = {
  items: { orderBy: { sortOrder: "asc" } },
  milestones: { orderBy: { sortOrder: "asc" } },
  client: { include: { contacts: { where: { isPrimary: true, archivedAt: null }, take: 1 } } },
  lead: true,
} satisfies Prisma.OfferInclude;
type OfferGraph = Prisma.OfferGetPayload<{ include: typeof offerGraph }>;

function recipientOf(o: OfferGraph): OfferDocInput["recipient"] {
  if (o.client) {
    const c = o.client;
    return {
      name: c.companyName,
      contact: c.contacts[0]?.name ?? null,
      address: [c.billingAddress, c.pincode].filter(Boolean).join(" ") || c.city,
      state: c.country === "India" ? `${c.state} (${c.stateCode})` : c.country,
      gstin: c.gstin,
      email: c.contacts[0]?.email ?? c.email,
      phone: c.contacts[0]?.phone ?? c.phone,
    };
  }
  return {
    name: o.lead?.companyName ?? o.lead?.contactName ?? "",
    contact: o.lead?.companyName ? o.lead.contactName : null,
    address: o.lead?.city ?? null,
    state: o.supplyStateCode ? `${stateName(o.supplyStateCode) ?? ""} (${o.supplyStateCode})` : null,
    email: o.lead?.email ?? null,
    phone: o.lead?.phone ?? o.lead?.whatsapp ?? null,
  };
}

/** Everything needed to show or print an offer. */
export async function loadOfferDocument(db: Db | Tx, offerId: string) {
  const [offer, settings] = await Promise.all([
    db.offer.findUnique({ where: { id: offerId }, include: offerGraph }),
    db.settings.findUniqueOrThrow({ where: { id: "agency" } }),
  ]);
  if (!offer) return null;
  const doc = buildOfferDocument({
    number: offer.number,
    title: offer.title,
    version: offer.currentVersion,
    offerDate: dateOnlyKey(offer.offerDate),
    validUntil: dateOnlyKey(offer.validUntil),
    durationMonths: offer.durationMonths,
    paymentTerms: offer.paymentTerms,
    terms: offer.terms,
    notes: offer.notes,
    taxMode: offer.taxMode,
    recipient: recipientOf(offer),
    agency: {
      name: settings.agencyName, address: settings.address, city: settings.city, state: settings.state, pincode: settings.pincode,
      email: settings.email, phone: settings.phone, website: settings.website, gstin: settings.gstin,
    },
    items: offer.items.map((i) => ({
      description: i.description, billingType: i.billingType, quantity: i.quantity, unit: i.unit, rate: i.rate,
      discountType: i.discountType, discountValue: i.discountValue, gstRate: i.gstRate, sacCode: i.sacCode, durationMonths: i.durationMonths,
      deliverables: i.deliverables as { format: string; qtyPerMonth: number }[] | null,
    })),
    milestones: offer.milestones.map((m) => ({ name: m.name, percent: m.percent })),
  });
  return { offer, doc, settings };
}

/** Re-prices a draft against the client's state today, in case it changed since the draft was saved. */
async function refreshDraftTax(tx: Tx, offerId: string) {
  const offer = await tx.offer.findUniqueOrThrow({ where: { id: offerId }, include: { items: { orderBy: { sortOrder: "asc" } } } });
  const gstEnabled = offer.taxMode !== "NO_GST";
  const tax = await resolveTax(tx, { clientId: offer.clientId, gstEnabled, supplyStateCode: offer.supplyStateCode });
  const totals = computeTotals(offer.items, tax.taxMode);
  return tx.offer.update({
    where: { id: offerId },
    data: {
      ...tax,
      subtotal: money(totals.subtotal), discountTotal: money(totals.discountTotal), taxableTotal: money(totals.taxableTotal),
      taxTotal: money(totals.taxTotal), grandTotal: money(totals.grandTotal),
    },
    include: { items: true, milestones: true },
  });
}

/** The client's link for this offer. An existing valid link is reused, so links already shared keep working. */
export async function ensureOfferLink(db: Db | Tx, offerId: string, actorId: string | null) {
  const offer = await db.offer.findUniqueOrThrow({ where: { id: offerId } });
  const expiresAt = new Date(keyToDate(addDaysKey(dateOnlyKey(offer.validUntil), 1)).getTime() - 330 * 60_000);
  const existing = await db.publicLink.findFirst({ where: { offerId, type: "OFFER", revokedAt: null, expiresAt } });
  if (existing) return existing;
  const id = crypto.randomUUID();
  return db.publicLink.create({
    data: { id, type: "OFFER", tokenHash: hashPublicToken(publicToken(id)), offerId, clientId: offer.clientId, expiresAt, createdById: actorId },
  });
}

async function revokeLinks(tx: Tx, offerId: string) {
  await tx.publicLink.updateMany({ where: { offerId, revokedAt: null }, data: { revokedAt: new Date() } });
}

/** Prepares a draft for sending: fresh tax and a link, without changing its status. */
export async function prepareForSending(db: Db, offerId: string, actorId: string) {
  return db.$transaction(async (tx) => {
    const offer = await tx.offer.findUnique({ where: { id: offerId } });
    if (!offer || offer.isTemplate || offer.archivedAt) throw new BusinessError("This offer can't be sent.");
    if (offer.status === "DRAFT") await refreshDraftTax(tx, offerId);
    else if (!isOpen(offer.status)) throw new BusinessError("This offer is closed. Create a new version to send it again.");
    return ensureOfferLink(tx, offerId, actorId);
  });
}

/** Marks an offer as sent and freezes this version's contents in its history. Safe to repeat for a resend. */
export async function markOfferSent(db: Db, input: { offerId: string; followUpDate: string; changeNote?: string | null; actorId: string; via: string }) {
  return db.$transaction(async (tx) => {
    const offer = await tx.offer.findUnique({ where: { id: input.offerId }, include: { items: { orderBy: { sortOrder: "asc" } }, milestones: { orderBy: { sortOrder: "asc" } } } });
    if (!offer || offer.isTemplate || offer.archivedAt) throw new BusinessError("This offer can't be sent.");
    const today = todayKey();
    if (offer.status === "SENT") {
      await tx.offer.update({ where: { id: offer.id }, data: { followUpDate: keyToDate(input.followUpDate) } });
      await logActivity(tx, { actorId: input.actorId, action: "offer.resent", entityType: "Offer", entityId: offer.id, clientId: offer.clientId, changes: { via: input.via } });
      return offer;
    }
    const problem = statusChangeError({ from: offer.status, to: "SENT", todayKey: today, validUntilKey: dateOnlyKey(offer.validUntil), followUpKey: input.followUpDate });
    if (problem) throw new BusinessError(problem);

    const { count } = await tx.offer.updateMany({ where: { id: offer.id, status: offer.status }, data: { status: "SENT", followUpDate: keyToDate(input.followUpDate) } });
    if (!count) throw new BusinessError("This offer was just changed by someone else. Please reload.");

    if (offer.status === "DRAFT") {
      await tx.offerVersion.upsert({
        where: { offerId_version: { offerId: offer.id, version: offer.currentVersion } },
        update: {},
        create: {
          offerId: offer.id,
          version: offer.currentVersion,
          changeNote: input.changeNote,
          createdById: input.actorId,
          snapshot: JSON.parse(
            JSON.stringify({
              title: offer.title, validUntil: dateOnlyKey(offer.validUntil), paymentTerms: offer.paymentTerms, terms: offer.terms, notes: offer.notes, taxMode: offer.taxMode,
              subtotal: offer.subtotal, discountTotal: offer.discountTotal, taxableTotal: offer.taxableTotal, taxTotal: offer.taxTotal, grandTotal: offer.grandTotal,
              items: offer.items.map((i) => ({ description: i.description, quantity: i.quantity, unit: i.unit, rate: i.rate, discountType: i.discountType, discountValue: i.discountValue, gstRate: i.gstRate, billingType: i.billingType, taxableValue: i.taxableValue })),
              milestones: offer.milestones.map((m) => ({ name: m.name, percent: m.percent })),
            }),
          ),
        },
      });
    }
    await tx.offerStatusHistory.create({ data: { offerId: offer.id, fromStatus: offer.status, toStatus: "SENT", note: input.changeNote ?? `Sent by ${input.via}`, changedById: input.actorId } });

    // An open lead moves to "Offer Sent" automatically. Won and Lost leads are left alone.
    if (offer.leadId) {
      const lead = await tx.lead.findUnique({ where: { id: offer.leadId } });
      if (lead && !lead.convertedClientId && ["NEW", "CONTACTED", "REQUIREMENT_DISCUSSED"].includes(lead.stage)) {
        await tx.lead.update({ where: { id: lead.id }, data: { stage: "OFFER_SENT" } });
        await tx.leadStageHistory.create({ data: { leadId: lead.id, fromStage: lead.stage, toStage: "OFFER_SENT", note: `Offer ${offer.number} sent`, changedById: input.actorId } });
      }
    }
    await logActivity(tx, {
      actorId: input.actorId, action: "offer.sent", entityType: "Offer", entityId: offer.id, clientId: offer.clientId,
      changes: { status: { from: offer.status, to: "SENT" }, version: offer.currentVersion, via: input.via },
    });
    return offer;
  });
}

export async function changeOfferStatus(
  db: Db,
  input: { offerId: string; to: "ON_HOLD" | "SENT" | "ACCEPTED" | "REJECTED"; followUpDate?: string | null; reason?: string | null; acceptedByName?: string | null; actorId: string },
) {
  return db.$transaction(async (tx) => {
    const offer = await tx.offer.findUnique({ where: { id: input.offerId } });
    if (!offer || offer.isTemplate) throw new BusinessError("This offer no longer exists.");
    if (offer.archivedAt) throw new BusinessError("This offer is archived. Restore it first.");
    if (offer.status === "DRAFT") throw new BusinessError("Send the offer first.");
    const problem = statusChangeError({
      from: offer.status, to: input.to, todayKey: todayKey(), validUntilKey: dateOnlyKey(offer.validUntil),
      followUpKey: input.followUpDate, rejectReason: input.reason, acceptedByName: input.acceptedByName,
    });
    if (problem) throw new BusinessError(problem);

    const closing = input.to === "ACCEPTED" || input.to === "REJECTED";
    const { count } = await tx.offer.updateMany({
      where: { id: offer.id, status: offer.status },
      data: {
        status: input.to,
        followUpDate: closing ? null : keyToDate(input.followUpDate!),
        rejectReason: input.to === "REJECTED" ? input.reason : null,
        ...(input.to === "ACCEPTED" ? { acceptedAt: new Date(), acceptedByName: input.acceptedByName, acceptedVersion: offer.currentVersion } : {}),
      },
    });
    if (!count) throw new BusinessError("This offer was just changed by someone else. Please reload.");
    if (input.to === "REJECTED") await revokeLinks(tx, offer.id);
    if (input.to === "ACCEPTED") await ensureOfferOnboarding(tx, offer.id);
    await tx.offerStatusHistory.create({
      data: { offerId: offer.id, fromStatus: offer.status, toStatus: input.to, note: input.reason ?? (input.acceptedByName ? `Accepted by ${input.acceptedByName}` : null), changedById: input.actorId },
    });
    await logActivity(tx, {
      actorId: input.actorId, action: "offer.status_changed", entityType: "Offer", entityId: offer.id, clientId: offer.clientId,
      changes: { status: { from: offer.status, to: input.to } },
    });
  });
}

export async function setOfferFollowUp(db: Db, offerId: string, followUpDate: string, actorId: string) {
  await db.$transaction(async (tx) => {
    const offer = await tx.offer.findUnique({ where: { id: offerId } });
    if (!offer || !isOpen(offer.status)) throw new BusinessError("Follow-ups apply only to offers that are Sent or On Hold.");
    if (followUpDate < todayKey()) throw new BusinessError("The follow-up date can't be in the past.");
    await tx.offer.update({ where: { id: offerId }, data: { followUpDate: keyToDate(followUpDate) } });
    await logActivity(tx, { actorId, action: "offer.follow_up_set", entityType: "Offer", entityId: offerId, clientId: offer.clientId, changes: { followUpDate } });
  });
}

/**
 * Starts the next version as a draft. The client's existing links stop working straight away,
 * so nobody can accept terms that are being changed.
 */
export async function reviseOffer(db: Db, offerId: string, actorId: string) {
  await db.$transaction(async (tx) => {
    const offer = await tx.offer.findUnique({ where: { id: offerId } });
    if (!offer || offer.isTemplate) throw new BusinessError("This offer no longer exists.");
    if (!canRevise(offer.status)) {
      throw new BusinessError(offer.status === "ACCEPTED" ? "An accepted offer can't be changed." : "Edit the draft directly.");
    }
    const { count } = await tx.offer.updateMany({
      where: { id: offerId, status: offer.status },
      data: { status: "DRAFT", currentVersion: offer.currentVersion + 1, followUpDate: null, rejectReason: null },
    });
    if (!count) throw new BusinessError("This offer was just changed by someone else. Please reload.");
    await revokeLinks(tx, offerId);
    await tx.offerStatusHistory.create({
      data: { offerId, fromStatus: offer.status, toStatus: "DRAFT", note: `New version v${offer.currentVersion + 1} started`, changedById: actorId },
    });
    await logActivity(tx, { actorId, action: "offer.revised", entityType: "Offer", entityId: offerId, clientId: offer.clientId, changes: { version: { from: offer.currentVersion, to: offer.currentVersion + 1 } } });
  });
}

const copyItem = (i: Prisma.OfferItemGetPayload<object>) => ({
  serviceId: i.serviceId, subServiceId: i.subServiceId, description: i.description, billingType: i.billingType, quantity: i.quantity, unit: i.unit, rate: i.rate,
  discountType: i.discountType, discountValue: i.discountValue, gstRate: i.gstRate, sacCode: i.sacCode, durationMonths: i.durationMonths,
  deliverables: i.deliverables ?? undefined, taxableValue: i.taxableValue, sortOrder: i.sortOrder,
});

/** A fresh draft with a new number, dated today, for the same recipient. */
export async function duplicateOffer(db: Db, offerId: string, actorId: string) {
  return db.$transaction(async (tx) => {
    const source = await tx.offer.findUnique({ where: { id: offerId }, include: { items: true, milestones: true } });
    if (!source || source.isTemplate) throw new BusinessError("This offer no longer exists.");
    const settings = await tx.settings.findUniqueOrThrow({ where: { id: "agency" } });
    const today = todayKey();
    const number = await nextDocNumber(tx, "QUOTATION", today);
    const copy = await tx.offer.create({
      data: {
        number, clientId: source.clientId, leadId: source.leadId, title: source.title, status: "DRAFT",
        offerDate: keyToDate(today), validUntil: keyToDate(addDaysKey(today, settings.offerValidityDays)),
        durationMonths: source.durationMonths, paymentTerms: source.paymentTerms, terms: source.terms, notes: source.notes,
        subtotal: source.subtotal, discountTotal: source.discountTotal, taxableTotal: source.taxableTotal, taxTotal: source.taxTotal, grandTotal: source.grandTotal,
        taxMode: source.taxMode, supplyStateCode: source.supplyStateCode, duplicatedFromId: source.id, createdById: actorId,
        items: { create: source.items.map(copyItem) as never },
        milestones: { create: source.milestones.map((m) => ({ name: m.name, percent: m.percent, sortOrder: m.sortOrder })) },
        statusHistory: { create: { toStatus: "DRAFT", note: `Copied from ${source.number}`, changedById: actorId } },
      },
    });
    await logActivity(tx, { actorId, action: "offer.duplicated", entityType: "Offer", entityId: copy.id, clientId: source.clientId, changes: { from: source.number, number } });
    return copy;
  });
}

/** Templates don't use a quotation number, so they never leave a gap in your numbering. */
export async function saveTemplate(db: Db, id: string | null, data: TemplateData, actorId: string) {
  return db.$transaction(async (tx) => {
    const tax = await resolveTax(tx, { gstEnabled: data.gstEnabled, supplyStateCode: data.supplyStateCode });
    const { columns, itemRows } = computed(data.items, tax.taxMode);
    if (id) {
      const existing = await tx.offer.findUnique({ where: { id } });
      if (!existing?.isTemplate) throw new BusinessError("This template no longer exists.");
      await tx.offerItem.deleteMany({ where: { offerId: id } });
      await tx.offerMilestone.deleteMany({ where: { offerId: id } });
    }
    const body = { ...commonColumns(data), ...columns, ...tax, templateName: data.templateName, items: { create: itemRows }, milestones: { create: milestoneRows(data.milestones) } };
    const template = id
      ? await tx.offer.update({ where: { id }, data: body })
      : await tx.offer.create({ data: { ...body, number: `TPL-${crypto.randomUUID()}`, isTemplate: true, status: "DRAFT", createdById: actorId } });
    await logActivity(tx, { actorId, action: id ? "offer_template.updated" : "offer_template.created", entityType: "Offer", entityId: template.id, changes: { name: data.templateName } });
    return template;
  });
}

/** Saves a copy of an offer as a reusable template. */
export async function offerToTemplate(db: Db, offerId: string, templateName: string, actorId: string) {
  return db.$transaction(async (tx) => {
    const source = await tx.offer.findUnique({ where: { id: offerId }, include: { items: true, milestones: true } });
    if (!source) throw new BusinessError("This offer no longer exists.");
    const template = await tx.offer.create({
      data: {
        number: `TPL-${crypto.randomUUID()}`, isTemplate: true, templateName, title: source.title, status: "DRAFT",
        offerDate: source.offerDate, validUntil: source.validUntil, durationMonths: source.durationMonths, paymentTerms: source.paymentTerms, terms: source.terms, notes: source.notes,
        subtotal: source.subtotal, discountTotal: source.discountTotal, taxableTotal: source.taxableTotal, taxTotal: source.taxTotal, grandTotal: source.grandTotal, taxMode: source.taxMode === "NO_GST" ? "NO_GST" : "INTRA_STATE",
        createdById: actorId,
        items: { create: source.items.map(copyItem) as never },
        milestones: { create: source.milestones.map((m) => ({ name: m.name, percent: m.percent, sortOrder: m.sortOrder })) },
      },
    });
    await logActivity(tx, { actorId, action: "offer_template.created", entityType: "Offer", entityId: template.id, changes: { name: templateName, from: source.number } });
    return template;
  });
}

export async function setOfferArchived(db: Db, offerId: string, archived: boolean, actorId: string) {
  await db.$transaction(async (tx) => {
    const offer = await tx.offer.findUnique({ where: { id: offerId } });
    if (!offer) throw new BusinessError("This offer no longer exists.");
    if (!!offer.archivedAt === archived) return;
    if (archived && offer.status === "ACCEPTED" && !offer.isTemplate) throw new BusinessError("An accepted offer can't be archived. It's part of your sales record.");
    if (archived) await revokeLinks(tx, offerId);
    await tx.offer.update({ where: { id: offerId }, data: { archivedAt: archived ? new Date() : null } });
    await logActivity(tx, { actorId, action: archived ? "offer.archived" : "offer.restored", entityType: "Offer", entityId: offerId, clientId: offer.clientId });
  });
}

/** Moves offers past their validity to Expired. Safe to run any number of times. */
export async function expireOverdueOffers(db: Db, today = todayKey()): Promise<number> {
  const due = await db.offer.findMany({
    where: { isTemplate: false, archivedAt: null, status: { in: ["SENT", "ON_HOLD"] }, validUntil: { lt: keyToDate(today) } },
    select: { id: true, status: true, clientId: true },
  });
  let expired = 0;
  for (const offer of due) {
    await db.$transaction(async (tx) => {
      const { count } = await tx.offer.updateMany({ where: { id: offer.id, status: offer.status }, data: { status: "EXPIRED", followUpDate: null } });
      if (!count) return;
      await tx.offerStatusHistory.create({ data: { offerId: offer.id, fromStatus: offer.status, toStatus: "EXPIRED", note: "Validity ended", changedVia: "system" } });
      await logActivity(tx, { actorId: null, action: "offer.expired", entityType: "Offer", entityId: offer.id, clientId: offer.clientId, changes: { status: { from: offer.status, to: "EXPIRED" } } });
      expired++;
    });
  }
  return expired;
}

// ─── The client's no-login link ──────────────────────────────────────────────

/** Finds the link for a token. It reveals only that one offer, and returns null for anything invalid. */
export async function findOfferLink(db: Db | Tx, token: string) {
  if (!looksLikeToken(token)) return null;
  const link = await db.publicLink.findUnique({ where: { tokenHash: hashPublicToken(token) } });
  if (!link || link.type !== "OFFER" || !link.offerId) return null;
  return link;
}

async function notifyTeam(tx: Tx, input: { title: string; body: string; href: string }) {
  const admins = await tx.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
  await tx.notification.createMany({ data: admins.map((a) => ({ userId: a.id, ...input })) });
}

async function respondableOffer(tx: Tx, token: string) {
  const link = await findOfferLink(tx, token);
  if (!link) throw new BusinessError("This link is not valid.");
  const offer = await tx.offer.findUniqueOrThrow({ where: { id: link.offerId! } });
  const problem = publicResponseError({
    status: offer.status, todayKey: todayKey(), validUntilKey: dateOnlyKey(offer.validUntil),
    revoked: !!link.revokedAt || !!offer.archivedAt, linkExpired: link.expiresAt < new Date(),
  });
  if (problem) throw new BusinessError(problem);
  return { link, offer };
}

/** The client accepts. Records who, when and from where, and tells you. */
export async function acceptOfferViaLink(db: Db, input: { token: string; name: string; ip: string }) {
  return db.$transaction(async (tx) => {
    const { offer } = await respondableOffer(tx, input.token);
    const { count } = await tx.offer.updateMany({
      where: { id: offer.id, status: { in: ["SENT", "ON_HOLD"] } },
      data: { status: "ACCEPTED", acceptedAt: new Date(), acceptedByName: input.name, acceptedIp: input.ip, acceptedVersion: offer.currentVersion, followUpDate: null },
    });
    if (!count) throw new BusinessError("This offer has already been accepted.");
    await tx.offerStatusHistory.create({
      data: { offerId: offer.id, fromStatus: offer.status, toStatus: "ACCEPTED", note: `Accepted by ${input.name} (IP ${input.ip})`, changedVia: "public_link" },
    });
    await logActivity(tx, {
      actorId: null, action: "offer.accepted", entityType: "Offer", entityId: offer.id, clientId: offer.clientId,
      changes: { status: { from: offer.status, to: "ACCEPTED" }, by: input.name, version: offer.currentVersion },
    });
    await ensureOfferOnboarding(tx, offer.id);
    await notifyTeam(tx, { title: `Offer ${offer.number} accepted`, body: `${input.name} accepted “${offer.title}”.`, href: `/offers/${offer.id}` });
    return offer;
  });
}

/** The client asks for changes. The offer goes On Hold and you get their message. */
export async function requestChangesViaLink(db: Db, input: { token: string; name: string; comment: string; ip: string }) {
  return db.$transaction(async (tx) => {
    const { offer } = await respondableOffer(tx, input.token);
    if (offer.status === "SENT") {
      await tx.offer.updateMany({ where: { id: offer.id, status: "SENT" }, data: { status: "ON_HOLD", followUpDate: keyToDate(todayKey()) } });
    } else {
      await tx.offer.update({ where: { id: offer.id }, data: { followUpDate: keyToDate(todayKey()) } });
    }
    await tx.offerStatusHistory.create({
      data: { offerId: offer.id, fromStatus: offer.status, toStatus: "ON_HOLD", note: `Changes requested by ${input.name}: ${input.comment}`, changedVia: "public_link" },
    });
    await logActivity(tx, {
      actorId: null, action: "offer.changes_requested", entityType: "Offer", entityId: offer.id, clientId: offer.clientId,
      changes: { by: input.name, comment: input.comment },
    });
    await notifyTeam(tx, { title: `Changes requested on ${offer.number}`, body: `${input.name}: ${input.comment.slice(0, 200)}`, href: `/offers/${offer.id}` });
    return offer;
  });
}
