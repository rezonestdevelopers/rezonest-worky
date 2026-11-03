import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { addDaysKey, todayKey } from "@/lib/dates";
import { publicToken } from "@/lib/public-token";
import { clientCreateSchema } from "@/lib/validators/client";
import { leadSchema } from "@/lib/validators/lead";
import { offerSchema, templateSchema } from "@/lib/validators/offer";
import { createClient } from "@/server/services/clients";
import { convertLead, createLead } from "@/server/services/leads";
import {
  acceptOfferViaLink,
  changeOfferStatus,
  createOffer,
  duplicateOffer,
  ensureOfferLink,
  expireOverdueOffers,
  findOfferLink,
  loadOfferDocument,
  markOfferSent,
  offerToTemplate,
  prepareForSending,
  requestChangesViaLink,
  reviseOffer,
  saveTemplate,
  setOfferArchived,
  updateDraftOffer,
} from "@/server/services/offers";

const db = new PrismaClient();
let actorId: string;
const TODAY = todayKey();
const FOLLOW_UP = addDaysKey(TODAY, 3);

const client = (over: Record<string, unknown> = {}) =>
  createClient(db, clientCreateSchema.parse({ companyName: "Asha Foods", contactName: "Asha", country: "India", stateCode: "27", status: "ACTIVE", email: "asha@x.in", phone: "9000000001", ...over }), actorId);

const input = (who: Record<string, unknown>, over: Record<string, unknown> = {}) =>
  offerSchema.parse({
    ...who,
    title: "Retainer", offerDate: TODAY, validUntil: addDaysKey(TODAY, 15), gstEnabled: true, milestones: [],
    items: [{ description: "Social media", billingType: "MONTHLY_RETAINER", quantity: "1", unit: "month", rate: "25000", gstRate: "18" }],
    ...over,
  });

async function sentOffer(over: Record<string, unknown> = {}) {
  const c = await client();
  const offer = await createOffer(db, input({ clientId: c.id }, over), actorId);
  const link = await prepareForSending(db, offer.id, actorId);
  await markOfferSent(db, { offerId: offer.id, followUpDate: FOLLOW_UP, actorId, via: "email" });
  return { offer, link, token: publicToken(link.id) };
}
const reload = (id: string) => db.offer.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  await db.settings.upsert({ where: { id: "agency" }, update: { stateCode: "27", offerValidityDays: 15 }, create: { id: "agency", agencyName: "Test", address: "Pune", stateCode: "27" } });
  const user = await db.user.upsert({ where: { email: "phase3-tester@example.com" }, update: {}, create: { name: "Tester", email: "phase3-tester@example.com", passwordHash: "x", role: "ADMIN" } });
  actorId = user.id;
});

beforeEach(async () => {
  await db.notification.deleteMany();
  await db.publicLink.deleteMany();
  await db.offerItem.deleteMany();
  await db.offer.deleteMany();
  await db.lead.deleteMany();
  await db.client.deleteMany();
  await db.activityLog.deleteMany();
  await db.numberSequence.deleteMany();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("creating offers", () => {
  it("gets the next number, totals and tax from the client's state", async () => {
    const c = await client();
    const a = await createOffer(db, input({ clientId: c.id }), actorId);
    const b = await createOffer(db, input({ clientId: c.id }), actorId);
    expect(a.number).toMatch(/^REZ\/QT\/\d{4}-\d{2}\/0001$/);
    expect(b.number).toMatch(/0002$/);
    expect(a).toMatchObject({ status: "DRAFT", taxMode: "INTRA_STATE", currentVersion: 1 });
    expect(a.taxableTotal.toString()).toBe("25000");
    expect(a.taxTotal.toString()).toBe("4500");
    expect(a.grandTotal.toString()).toBe("29500");
  });

  it("a client in another state gets IGST; abroad gets none; GST can be switched off", async () => {
    const other = await client({ companyName: "Vertex", stateCode: "29" });
    expect((await createOffer(db, input({ clientId: other.id }), actorId)).taxMode).toBe("INTER_STATE");
    const abroad = await client({ companyName: "Dubai LLC", country: "UAE", stateCode: "" });
    const exp = await createOffer(db, input({ clientId: abroad.id }), actorId);
    expect(exp.taxMode).toBe("EXPORT");
    expect(exp.grandTotal.toString()).toBe("25000");
    const off = await createOffer(db, input({ clientId: other.id }, { gstEnabled: false }), actorId);
    expect(off.taxMode).toBe("NO_GST");
  });

  it("a client's state can't be overridden by the form", async () => {
    const c = await client({ stateCode: "29", companyName: "Vertex" });
    const offer = await createOffer(db, input({ clientId: c.id }, { supplyStateCode: "27" }), actorId);
    expect(offer).toMatchObject({ taxMode: "INTER_STATE", supplyStateCode: "29" });
  });

  it("a lead's offer uses the place of supply chosen on it", async () => {
    const lead = await createLead(db, leadSchema.parse({ contactName: "Ravi", phone: "9000000002", servicesInterested: [] }), actorId);
    expect((await createOffer(db, input({ leadId: lead.id }, { supplyStateCode: "29" }), actorId)).taxMode).toBe("INTER_STATE");
    expect((await createOffer(db, input({ leadId: lead.id }), actorId)).taxMode).toBe("INTRA_STATE");
  });

  it("an offer for a converted lead goes to its client", async () => {
    const lead = await createLead(db, leadSchema.parse({ contactName: "Ravi", phone: "9000000002", servicesInterested: [] }), actorId);
    const { clientId } = await convertLead(db, { leadId: lead.id, client: clientCreateSchema.parse({ companyName: "Ravi Co", contactName: "Ravi", country: "India", stateCode: "27", status: "ACTIVE" }), actorId });
    expect((await createOffer(db, input({ leadId: lead.id }), actorId)).clientId).toBe(clientId);
  });

  it("refuses archived recipients, and a failure uses up no number", async () => {
    const c = await client();
    await db.client.update({ where: { id: c.id }, data: { archivedAt: new Date() } });
    await expect(createOffer(db, input({ clientId: c.id }), actorId)).rejects.toThrow(/archived/);
    expect(await db.numberSequence.count()).toBe(0);
  });

  it("the document shows the same figures as the stored totals", async () => {
    const c = await client();
    const offer = await createOffer(db, input({ clientId: c.id }, {
      items: [{ description: "Reels", billingType: "PER_UNIT", quantity: "7", unit: "reel", rate: "3333.33", discountType: "PERCENT", discountValue: "7.5", gstRate: "18" }],
    }), actorId);
    const loaded = await loadOfferDocument(db, offer.id);
    const printed = Number(loaded!.doc.grandTotal.replace(/[₹,]/g, ""));
    expect(printed).toBe(Number(offer.grandTotal.toString()));
  });
});

describe("drafts and versions", () => {
  it("drafts can be edited, with items replaced and totals redone", async () => {
    const c = await client();
    const offer = await createOffer(db, input({ clientId: c.id }), actorId);
    const updated = await updateDraftOffer(db, offer.id, input({ clientId: c.id }, { items: [{ description: "New", billingType: "ONE_TIME", quantity: "2", unit: "job", rate: "1000", gstRate: "18" }] }), actorId);
    expect(updated.grandTotal.toString()).toBe("2360");
    expect(await db.offerItem.count({ where: { offerId: offer.id } })).toBe(1);
  });

  it("sent offers can't be edited directly", async () => {
    const { offer } = await sentOffer();
    await expect(updateDraftOffer(db, offer.id, input({ clientId: offer.clientId }), actorId)).rejects.toThrow(/Only drafts/);
  });

  it("sending freezes the version, and re-sending doesn't add another", async () => {
    const { offer } = await sentOffer();
    await markOfferSent(db, { offerId: offer.id, followUpDate: addDaysKey(TODAY, 5), actorId, via: "email" });
    const versions = await db.offerVersion.findMany({ where: { offerId: offer.id } });
    expect(versions).toHaveLength(1);
    expect((versions[0].snapshot as { grandTotal: string }).grandTotal).toBe("29500");
    expect(await db.offerStatusHistory.count({ where: { offerId: offer.id, toStatus: "SENT" } })).toBe(1);
  });

  it("a new version keeps the number, resets to draft, and kills the old client link", async () => {
    const { offer, token } = await sentOffer();
    await reviseOffer(db, offer.id, actorId);
    const after = await reload(offer.id);
    expect(after).toMatchObject({ status: "DRAFT", currentVersion: 2, number: offer.number, followUpDate: null });
    await expect(acceptOfferViaLink(db, { token, name: "Asha", ip: "1.1.1.1" })).rejects.toThrow(/no longer valid/);

    await updateDraftOffer(db, offer.id, input({ clientId: offer.clientId }, { items: [{ description: "Bigger", billingType: "ONE_TIME", quantity: "1", unit: "job", rate: "50000", gstRate: "18" }] }), actorId);
    const link2 = await prepareForSending(db, offer.id, actorId);
    await markOfferSent(db, { offerId: offer.id, followUpDate: FOLLOW_UP, changeNote: "Bigger scope", actorId, via: "email" });
    const versions = await db.offerVersion.findMany({ where: { offerId: offer.id }, orderBy: { version: "asc" } });
    expect(versions.map((v) => (v.snapshot as { grandTotal: string }).grandTotal)).toEqual(["29500", "59000"]);
    expect(versions[1].changeNote).toBe("Bigger scope");

    expect(publicToken(link2.id)).not.toBe(token);
    await acceptOfferViaLink(db, { token: publicToken(link2.id), name: "Asha", ip: "1.1.1.1" });
    expect((await reload(offer.id)).acceptedVersion).toBe(2);
  });

  it("re-pricing on send picks up a change to the client's state", async () => {
    const c = await client();
    const offer = await createOffer(db, input({ clientId: c.id }), actorId);
    await db.client.update({ where: { id: c.id }, data: { stateCode: "29", state: "Karnataka" } });
    await prepareForSending(db, offer.id, actorId);
    expect((await reload(offer.id)).taxMode).toBe("INTER_STATE");
  });

  it("an existing link is reused while it's valid", async () => {
    const { offer, link } = await sentOffer();
    expect((await ensureOfferLink(db, offer.id, actorId)).id).toBe(link.id);
    expect(await db.publicLink.count({ where: { offerId: offer.id } })).toBe(1);
  });

  it("accepted offers can't be revised or archived", async () => {
    const { offer, token } = await sentOffer();
    await acceptOfferViaLink(db, { token, name: "Asha", ip: "1.1.1.1" });
    await expect(reviseOffer(db, offer.id, actorId)).rejects.toThrow(/accepted offer/);
    await expect(setOfferArchived(db, offer.id, true, actorId)).rejects.toThrow(/accepted offer/);
  });

  it("duplicating makes a new draft with a new number, leaving the original alone", async () => {
    const { offer } = await sentOffer();
    const copy = await duplicateOffer(db, offer.id, actorId);
    expect(copy.number).not.toBe(offer.number);
    expect(copy).toMatchObject({ status: "DRAFT", currentVersion: 1, duplicatedFromId: offer.id, clientId: offer.clientId });
    expect(await db.offerItem.count({ where: { offerId: copy.id } })).toBe(1);
    expect((await reload(offer.id)).status).toBe("SENT");
  });
});

describe("status changes", () => {
  it("records each change with history", async () => {
    const { offer } = await sentOffer();
    await changeOfferStatus(db, { offerId: offer.id, to: "ON_HOLD", followUpDate: FOLLOW_UP, actorId });
    await changeOfferStatus(db, { offerId: offer.id, to: "SENT", followUpDate: FOLLOW_UP, actorId });
    await changeOfferStatus(db, { offerId: offer.id, to: "REJECTED", reason: "Too costly", actorId });
    const after = await reload(offer.id);
    expect(after).toMatchObject({ status: "REJECTED", rejectReason: "Too costly", followUpDate: null });
    const history = await db.offerStatusHistory.findMany({ where: { offerId: offer.id }, orderBy: { createdAt: "asc" } });
    expect(history.map((h) => h.toStatus)).toEqual(["DRAFT", "SENT", "ON_HOLD", "SENT", "REJECTED"]);
    expect(history.at(-1)).toMatchObject({ note: "Too costly", changedById: actorId });
  });

  it("rejecting stops the client's link", async () => {
    const { offer, token } = await sentOffer();
    await changeOfferStatus(db, { offerId: offer.id, to: "REJECTED", reason: "Too costly", actorId });
    await expect(acceptOfferViaLink(db, { token, name: "Asha", ip: "1.1.1.1" })).rejects.toThrow(/no longer valid/);
  });

  it("marking accepted by hand records who and which version", async () => {
    const { offer } = await sentOffer();
    await changeOfferStatus(db, { offerId: offer.id, to: "ACCEPTED", acceptedByName: "Asha", actorId });
    expect(await reload(offer.id)).toMatchObject({ status: "ACCEPTED", acceptedByName: "Asha", acceptedVersion: 1, followUpDate: null });
  });

  it("sending moves an open lead to Offer Sent, with history", async () => {
    const lead = await createLead(db, leadSchema.parse({ contactName: "Ravi", phone: "9000000002", servicesInterested: [] }), actorId);
    const offer = await createOffer(db, input({ leadId: lead.id }), actorId);
    await prepareForSending(db, offer.id, actorId);
    await markOfferSent(db, { offerId: offer.id, followUpDate: FOLLOW_UP, actorId, via: "email" });
    const after = await db.lead.findUniqueOrThrow({ where: { id: lead.id }, include: { stageHistory: true } });
    expect(after.stage).toBe("OFFER_SENT");
    expect(after.stageHistory.some((h) => h.toStage === "OFFER_SENT")).toBe(true);
  });

  it("sending doesn't reopen a Lost lead", async () => {
    const lead = await createLead(db, leadSchema.parse({ contactName: "Ravi", phone: "9000000002", servicesInterested: [] }), actorId);
    const offer = await createOffer(db, input({ leadId: lead.id }), actorId);
    await db.lead.update({ where: { id: lead.id }, data: { stage: "LOST" } });
    await markOfferSent(db, { offerId: offer.id, followUpDate: FOLLOW_UP, actorId, via: "email" });
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).stage).toBe("LOST");
  });
});

describe("expiry", () => {
  it("expires open offers after validity, once, and stops their link", async () => {
    const { offer, token } = await sentOffer({ validUntil: TODAY });
    expect(await expireOverdueOffers(db, TODAY)).toBe(0);
    const tomorrow = addDaysKey(TODAY, 1);
    expect(await expireOverdueOffers(db, tomorrow)).toBe(1);
    expect(await expireOverdueOffers(db, tomorrow)).toBe(0);
    expect(await reload(offer.id)).toMatchObject({ status: "EXPIRED", followUpDate: null });
    expect(await db.offerStatusHistory.count({ where: { offerId: offer.id, toStatus: "EXPIRED", changedVia: "system" } })).toBe(1);
    await expect(acceptOfferViaLink(db, { token, name: "Asha", ip: "1.1.1.1" })).rejects.toThrow(/no longer open/);
  });

  it("the link refuses after validity even if the job hasn't run", async () => {
    const { offer, token } = await sentOffer();
    await db.offer.update({ where: { id: offer.id }, data: { validUntil: new Date(`${addDaysKey(TODAY, -1)}T00:00:00Z`) } });
    await expect(acceptOfferViaLink(db, { token, name: "Asha", ip: "1.1.1.1" })).rejects.toThrow(/validity/);
    expect((await reload(offer.id)).status).toBe("SENT");
  });

  it("drafts, accepted offers and templates are left alone", async () => {
    const c = await client();
    const draft = await createOffer(db, input({ clientId: c.id }, { validUntil: TODAY }), actorId);
    await saveTemplate(db, null, templateSchema.parse({ templateName: "Template", title: "Template", offerDate: TODAY, validUntil: TODAY, gstEnabled: true, milestones: [], items: [{ description: "SMM", billingType: "MONTHLY_RETAINER", quantity: "1", unit: "month", rate: "20000", gstRate: "18" }] }), actorId);
    expect(await expireOverdueOffers(db, addDaysKey(TODAY, 30))).toBe(0);
    expect((await reload(draft.id)).status).toBe("DRAFT");
  });
});

describe("the client's link", () => {
  it("accepting records name, time, IP and version, and tells admins", async () => {
    const { offer, token } = await sentOffer();
    await acceptOfferViaLink(db, { token, name: "Asha Kulkarni", ip: "49.36.112.18" });
    const after = await reload(offer.id);
    expect(after).toMatchObject({ status: "ACCEPTED", acceptedByName: "Asha Kulkarni", acceptedIp: "49.36.112.18", acceptedVersion: 1, followUpDate: null });
    expect(after.acceptedAt).not.toBeNull();
    const history = await db.offerStatusHistory.findFirstOrThrow({ where: { offerId: offer.id, toStatus: "ACCEPTED" } });
    expect(history).toMatchObject({ changedVia: "public_link", changedById: null });
    expect(await db.notification.count({ where: { userId: actorId, href: `/offers/${offer.id}` } })).toBe(1);
  });

  it("three clicks at the same moment count as one acceptance", async () => {
    const { offer, token } = await sentOffer();
    const results = await Promise.allSettled([1, 2, 3].map(() => acceptOfferViaLink(db, { token, name: "Asha", ip: "1.1.1.1" })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.offerStatusHistory.count({ where: { offerId: offer.id, toStatus: "ACCEPTED" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: actorId } })).toBe(1);
  });

  it("forged, altered and other offers' tokens get nothing", async () => {
    const { offer, token } = await sentOffer();
    const forged = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    expect(await findOfferLink(db, forged)).toBeNull();
    expect(await findOfferLink(db, publicToken("not-a-real-link"))).toBeNull();
    expect(await findOfferLink(db, "x")).toBeNull();
    await expect(acceptOfferViaLink(db, { token: forged, name: "Mallory", ip: "6.6.6.6" })).rejects.toThrow(/not valid/);
    expect((await reload(offer.id)).status).toBe("SENT");
  });

  it("a stored hash can't be used as a token", async () => {
    const { link, offer } = await sentOffer();
    await expect(acceptOfferViaLink(db, { token: link.tokenHash, name: "Mallory", ip: "6.6.6.6" })).rejects.toThrow(/not valid/);
    expect((await reload(offer.id)).status).toBe("SENT");
  });

  it("an expired link is refused", async () => {
    const { offer, link, token } = await sentOffer();
    await db.publicLink.update({ where: { id: link.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(acceptOfferViaLink(db, { token, name: "Asha", ip: "1.1.1.1" })).rejects.toThrow(/validity/);
    expect((await reload(offer.id)).status).toBe("SENT");
  });

  it("archiving stops the link", async () => {
    const { offer, token } = await sentOffer();
    await setOfferArchived(db, offer.id, true, actorId);
    await expect(acceptOfferViaLink(db, { token, name: "Asha", ip: "1.1.1.1" })).rejects.toThrow(/no longer valid/);
  });

  it("a draft can't be accepted, even with a valid link", async () => {
    const c = await client();
    const offer = await createOffer(db, input({ clientId: c.id }), actorId);
    const link = await prepareForSending(db, offer.id, actorId);
    await expect(acceptOfferViaLink(db, { token: publicToken(link.id), name: "Asha", ip: "1.1.1.1" })).rejects.toThrow(/no longer open/);
  });

  it("asking for changes puts it on hold, saves the message, and it can still be accepted", async () => {
    const { offer, token } = await sentOffer();
    await requestChangesViaLink(db, { token, name: "Asha", comment: "Please add two more reels", ip: "1.1.1.1" });
    const after = await reload(offer.id);
    expect(after.status).toBe("ON_HOLD");
    expect(after.followUpDate?.toISOString().slice(0, 10)).toBe(TODAY);
    const history = await db.offerStatusHistory.findFirstOrThrow({ where: { offerId: offer.id, toStatus: "ON_HOLD" } });
    expect(history.note).toContain("Please add two more reels");
    expect(await db.notification.count({ where: { userId: actorId } })).toBe(1);
    await acceptOfferViaLink(db, { token, name: "Asha", ip: "1.1.1.1" });
    expect((await reload(offer.id)).status).toBe("ACCEPTED");
  });
});

describe("templates", () => {
  const tpl = (over: Record<string, unknown> = {}) =>
    templateSchema.parse({
      templateName: "Starter", title: "Starter", offerDate: TODAY, validUntil: TODAY, gstEnabled: true, milestones: [],
      items: [{ description: "SMM", billingType: "MONTHLY_RETAINER", quantity: "1", unit: "month", rate: "20000", gstRate: "18" }], ...over,
    });

  it("don't use up quotation numbers", async () => {
    const t = await saveTemplate(db, null, tpl(), actorId);
    expect(t.isTemplate).toBe(true);
    expect(t.number).toMatch(/^TPL-/);
    expect(await db.numberSequence.count()).toBe(0);
    const c = await client();
    expect((await createOffer(db, input({ clientId: c.id }), actorId)).number).toMatch(/0001$/);
  });

  it("can be edited, and a copy of any offer can become one", async () => {
    const t = await saveTemplate(db, null, tpl(), actorId);
    const edited = await saveTemplate(db, t.id, tpl({ templateName: "Starter Plus" }), actorId);
    expect(edited.templateName).toBe("Starter Plus");
    expect(await db.offerItem.count({ where: { offerId: t.id } })).toBe(1);

    const { offer } = await sentOffer();
    const fromOffer = await offerToTemplate(db, offer.id, "From offer", actorId);
    expect(fromOffer).toMatchObject({ isTemplate: true, clientId: null, leadId: null, status: "DRAFT" });
    expect(await db.offerItem.count({ where: { offerId: fromOffer.id } })).toBe(1);
    expect((await reload(offer.id)).status).toBe("SENT");
  });

  it("a real offer can't be overwritten through the template route", async () => {
    const { offer } = await sentOffer();
    await expect(saveTemplate(db, offer.id, tpl(), actorId)).rejects.toThrow(/template/);
    expect((await reload(offer.id)).isTemplate).toBe(false);
  });

  it("templates can't be sent", async () => {
    const t = await saveTemplate(db, null, tpl(), actorId);
    await expect(prepareForSending(db, t.id, actorId)).rejects.toThrow(/can't be sent/);
    await expect(markOfferSent(db, { offerId: t.id, followUpDate: FOLLOW_UP, actorId, via: "email" })).rejects.toThrow(/can't be sent/);
  });
});
