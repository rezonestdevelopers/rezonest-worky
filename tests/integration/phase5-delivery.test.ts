import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { addDaysKey, monthKeyOf, shiftMonth, todayKey } from "@/lib/dates";
import { publicToken } from "@/lib/public-token";
import { clientCreateSchema } from "@/lib/validators/client";
import { assetSchema, campaignSchema, contentItemSchema, spendEntrySchema } from "@/lib/validators/delivery";
import { convertOfferSchema, employeeSchema } from "@/lib/validators/work";
import { offerSchema } from "@/lib/validators/offer";
import { commitAdImport, previewAdImport, removeSpendEntry, saveCampaign, saveSpendEntry } from "@/server/services/ads";
import { createClient } from "@/server/services/clients";
import {
  approveByHand,
  ensureContentLink,
  findContentLink,
  markPublished,
  reopenForApproval,
  respondToContent,
  revokeContentLink,
  saveContentItem,
  setContentArchived,
  setCreativeLink,
  setDesignStatus,
  undoPublished,
} from "@/server/services/content";
import { acceptOfferViaLink, createOffer, findOfferLink, markOfferSent, prepareForSending } from "@/server/services/offers";
import { convertOfferToProject, createRetainerMonthNow } from "@/server/services/projects";
import { renewAsset, saveAsset, setAssetArchived } from "@/server/services/renewals";
import { changeTaskStatus, type Viewer } from "@/server/services/tasks";
import { createEmployee } from "@/server/services/team";

const db = new PrismaClient();
const TODAY = todayKey();
const MONTH = monthKeyOf(TODAY);

let admin: Viewer;
let social: string;
let design: string;
let serviceId: string;

const makeClient = () =>
  createClient(db, clientCreateSchema.parse({ companyName: `Client ${Math.random()}`, contactName: "Asha", country: "India", stateCode: "27", status: "ACTIVE", email: `c${Math.random()}@x.in`, phone: `9${Math.floor(Math.random() * 1e9).toString().padStart(9, "0")}` }), admin.id);

const item = (clientId: string, over: Record<string, unknown> = {}) =>
  contentItemSchema.parse({ clientId, projectId: "", format: "STATIC_POST", platforms: ["INSTAGRAM"], topic: "Diwali offer", caption: "Happy Diwali", publishDate: TODAY, ...over });

const newItem = async (clientId: string, over: Record<string, unknown> = {}) => (await saveContentItem(db, null, item(clientId, over), admin.id)).item;

const tokenFor = async (clientId: string, month = MONTH) => publicToken((await ensureContentLink(db, { clientId, month, actorId: admin.id })).id);

const answer = (token: string, itemId: string, decision: "APPROVED" | "CHANGES_REQUESTED" = "APPROVED", comment: string | null = null) => respondToContent(db, { token, itemId, decision, name: "Asha", comment, ip: "1.1.1.1" });

/** A real retainer with a package, the way it's made in the app. */
async function retainer(deliverables = [{ format: "REEL", qtyPerMonth: 1 }]) {
  const c = await makeClient();
  const offer = await createOffer(
    db,
    offerSchema.parse({ clientId: c.id, title: "Work", offerDate: TODAY, validUntil: addDaysKey(TODAY, 15), gstEnabled: true, milestones: [], items: [{ serviceId, description: "Reels", billingType: "MONTHLY_RETAINER", quantity: "1", unit: "month", rate: "20000", gstRate: "18", deliverables }] }),
    admin.id,
  );
  const link = await prepareForSending(db, offer.id, admin.id);
  await markOfferSent(db, { offerId: offer.id, followUpDate: addDaysKey(TODAY, 3), actorId: admin.id, via: "email" });
  await acceptOfferViaLink(db, { token: publicToken(link.id), name: "Asha", ip: "1.1.1.1" });
  const project = await convertOfferToProject(db, convertOfferSchema.parse({ offerId: offer.id, name: "My retainer", managerId: admin.id, startDate: TODAY, deadline: "", retainerEnd: addDaysKey(TODAY, 200), autoRenew: false, milestones: [], targets: [], createTasks: true }), admin.id);
  return { clientId: c.id, projectId: project.id };
}

const campaignInput = (clientId: string, over: Record<string, unknown> = {}) =>
  campaignSchema.parse({ clientId, projectId: "", name: "Lead Generation", objective: "Leads", status: "ACTIVE", startDate: addDaysKey(TODAY, -30), endDate: "", plannedBudget: "50000", ...over });

const entryInput = (campaignId: string, over: Record<string, unknown> = {}) =>
  spendEntrySchema.parse({ campaignId, periodStart: addDaysKey(TODAY, -14), periodEnd: addDaysKey(TODAY, -8), spend: "5000", impressions: 100000, clicks: 1500, leads: 20, conversionValue: "", ...over });

const assetInput = (clientId: string, over: Record<string, unknown> = {}) =>
  assetSchema.parse({ clientId, kind: "DOMAIN", name: "Example.com", provider: "GoDaddy", plan: "", purchaseDate: "", expiryDate: addDaysKey(TODAY, 20), emailAccounts: "", costPrice: "799", renewalPrice: "1200", autoRenew: false, credentialsLocation: "Password manager", notes: "", ...over });

beforeAll(async () => {
  await db.settings.upsert({ where: { id: "agency" }, update: { stateCode: "27", offerValidityDays: 15, workingDays: [1, 2, 3, 4, 5, 6], retainerTaskDay: 1 }, create: { id: "agency", agencyName: "Test", address: "Pune", stateCode: "27", workingDays: [1, 2, 3, 4, 5, 6], retainerTaskDay: 1 } });
  const user = await db.user.upsert({ where: { email: "phase5-tester@example.com" }, update: { isActive: true, role: "ADMIN" }, create: { name: "Tester", email: "phase5-tester@example.com", passwordHash: "x", role: "ADMIN" } });
  admin = { id: user.id, role: "ADMIN", departmentId: null };
  social = (await db.department.upsert({ where: { name: "P5 Social" }, update: {}, create: { name: "P5 Social" } })).id;
  design = (await db.department.upsert({ where: { name: "P5 Design" }, update: {}, create: { name: "P5 Design" } })).id;
  serviceId = (await db.service.upsert({ where: { slug: "p5-reels" }, update: {}, create: { name: "P5 Reels", slug: "p5-reels", billingType: "MONTHLY_RETAINER", departmentId: design, revisionsIncluded: 1 } })).id;
  await db.taskTemplate.deleteMany({ where: { OR: [{ serviceId }, { name: { in: ["Post", "Reel"] } }] } });
  await db.taskTemplate.create({ data: { serviceId, name: "Reel", steps: { create: [{ title: "Edit", sortOrder: 0, departmentId: design }, { title: "Client approval", sortOrder: 1, departmentId: social, isClientApproval: true }, { title: "Post", sortOrder: 2, departmentId: social }] } } });
});

beforeEach(async () => {
  await db.invoiceRun.deleteMany();
  await db.paymentAllocation.deleteMany();
  await db.payment.deleteMany();
  await db.creditNote.deleteMany();
  await db.invoiceItem.deleteMany();
  await db.invoice.updateMany({ data: { convertedFromId: null } });
  await db.invoice.deleteMany();
  await db.notification.deleteMany();
  await db.contentApproval.deleteMany();
  await db.contentCalendarItem.deleteMany();
  await db.document.deleteMany();
  await db.adSpendEntry.deleteMany();
  await db.adCampaign.deleteMany();
  await db.domainHostingAsset.deleteMany();
  await db.passwordResetToken.deleteMany();
  await db.changeRequest.deleteMany();
  await db.timeLog.deleteMany();
  await db.task.deleteMany();
  await db.onboardingChecklist.deleteMany();
  await db.project.deleteMany();
  await db.publicLink.deleteMany();
  await db.offerItem.deleteMany();
  await db.offer.deleteMany();
  await db.lead.deleteMany();
  await db.client.deleteMany();
  await db.activityLog.deleteMany();
  await db.numberSequence.deleteMany();
  await db.employeeProfile.deleteMany();
  await db.user.deleteMany({ where: { id: { not: admin.id } } });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("content calendar", () => {
  it("files an item under the month of its publish date, and moves it with the date", async () => {
    const c = await makeClient();
    const a = await newItem(c.id, { publishDate: "2026-12-15" });
    expect(a.month).toBe("2026-12");
    const { item: moved } = await saveContentItem(db, a.id, item(c.id, { publishDate: "2027-01-02" }), admin.id);
    expect(moved.month).toBe("2027-01");
  });

  it("refuses a project that belongs to another client", async () => {
    const r = await retainer();
    const other = await makeClient();
    await expect(saveContentItem(db, null, item(other.id, { projectId: r.projectId }), admin.id)).rejects.toThrow(/isn't one of this client's/);
  });

  it("a retainer month fills the calendar, without doubling", async () => {
    const r = await retainer([{ format: "REEL", qtyPerMonth: 2 }, { format: "STATIC_POST", qtyPerMonth: 1 }]);
    const items = await db.contentCalendarItem.findMany({ where: { projectId: r.projectId, month: MONTH } });
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.deliverableId && i.approvalStatus === "PENDING" && i.designStatus === "NOT_STARTED")).toBe(true);
    const next = shiftMonth(MONTH, 1);
    await createRetainerMonthNow(db, r.projectId, next, admin.id);
    await createRetainerMonthNow(db, r.projectId, next, admin.id);
    expect(await db.contentCalendarItem.count({ where: { projectId: r.projectId, month: next } })).toBe(3);
  });

  it("items you promised in a package can't be archived; extras can", async () => {
    const r = await retainer();
    const promised = await db.contentCalendarItem.findFirstOrThrow({ where: { projectId: r.projectId } });
    await expect(setContentArchived(db, promised.id, true, admin.id)).rejects.toThrow(/can't be archived/);
    const extra = await newItem(r.clientId);
    await setContentArchived(db, extra.id, true, admin.id);
    expect((await db.contentCalendarItem.findUniqueOrThrow({ where: { id: extra.id } })).archivedAt).not.toBeNull();
  });

  it("employees only reach content for projects where they can see a task", async () => {
    const r = await retainer();
    const inDept = await createEmployee(db, employeeSchema.parse({ name: "Dept", email: "a@example.com", role: "EMPLOYEE", phone: "", departmentId: design, designation: "", joiningDate: "", hourlyCost: "", dailyDigest: false, emailOnTask: false }), admin.id);
    const outsider = await createEmployee(db, employeeSchema.parse({ name: "Out", email: "b@example.com", role: "EMPLOYEE", phone: "", departmentId: "", designation: "", joiningDate: "", hourlyCost: "", dailyDigest: false, emailOnTask: false }), admin.id);
    const i = await db.contentCalendarItem.findFirstOrThrow({ where: { projectId: r.projectId } });
    await setDesignStatus(db, { itemId: i.id, designStatus: "READY", viewer: { id: inDept.user.id, role: "EMPLOYEE", departmentId: design } });
    expect((await db.contentCalendarItem.findUniqueOrThrow({ where: { id: i.id } })).designStatus).toBe("READY");
    const out: Viewer = { id: outsider.user.id, role: "EMPLOYEE", departmentId: null };
    await expect(setDesignStatus(db, { itemId: i.id, designStatus: "NOT_STARTED", viewer: out })).rejects.toThrow(/isn't available/);
    await expect(markPublished(db, { itemId: i.id, publishedLink: null, viewer: out })).rejects.toThrow(/isn't available/);
    await expect(setCreativeLink(db, { itemId: i.id, creativeUrl: "https://x.in", viewer: out })).rejects.toThrow(/isn't available/);
  });
});

describe("the client's approval link", () => {
  it("is one working link per client and month, and only a hash is stored", async () => {
    const c = await makeClient();
    await newItem(c.id);
    const first = await ensureContentLink(db, { clientId: c.id, month: MONTH, actorId: admin.id });
    const again = await ensureContentLink(db, { clientId: c.id, month: MONTH, actorId: admin.id });
    expect(again.id).toBe(first.id);
    const token = publicToken(first.id);
    expect(token).toHaveLength(43);
    expect(first.tokenHash).not.toContain(token);
    expect((await findContentLink(db, token))?.id).toBe(first.id);
    expect(first.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
  });

  it("won't be created for a month with nothing in it", async () => {
    const c = await makeClient();
    await expect(ensureContentLink(db, { clientId: c.id, month: MONTH, actorId: admin.id })).rejects.toThrow(/no content planned/);
  });

  it("an offer link can't be used as a content link, or the reverse", async () => {
    const c = await makeClient();
    await newItem(c.id);
    const offer = await createOffer(db, offerSchema.parse({ clientId: c.id, title: "Work", offerDate: TODAY, validUntil: addDaysKey(TODAY, 15), gstEnabled: true, milestones: [], items: [{ description: "One job", billingType: "ONE_TIME", quantity: "1", unit: "job", rate: "100", gstRate: "18" }] }), admin.id);
    const offerLink = await prepareForSending(db, offer.id, admin.id);
    expect(await findContentLink(db, publicToken(offerLink.id))).toBeNull();
    expect(await findOfferLink(db, await tokenFor(c.id))).toBeNull();
    expect(await findContentLink(db, "not-a-token")).toBeNull();
    expect(await findContentLink(db, "x".repeat(43))).toBeNull();
  });

  it("records who approved, when and from where, and tells the team", async () => {
    const c = await makeClient();
    const i = await newItem(c.id);
    await answer(await tokenFor(c.id), i.id);
    const after = await db.contentCalendarItem.findUniqueOrThrow({ where: { id: i.id }, include: { approvals: true } });
    expect(after.approvalStatus).toBe("APPROVED");
    expect(after.approvals[0]).toMatchObject({ decision: "APPROVED", byName: "Asha", ip: "1.1.1.1" });
    expect(after.approvals[0].publicLinkId).not.toBeNull();
    const note = await db.notification.findFirstOrThrow({ where: { userId: admin.id } });
    expect(note.href).toBe(`/content/${i.id}`);
  });

  it("can only touch this client's items for this month", async () => {
    const a = await makeClient();
    const b = await makeClient();
    const mine = await newItem(a.id);
    const theirs = await newItem(b.id);
    const nextMonth = await newItem(a.id, { publishDate: `${shiftMonth(MONTH, 1)}-10` });
    const token = await tokenFor(a.id);
    await expect(answer(token, theirs.id)).rejects.toThrow(/isn't part of this calendar/);
    await expect(answer(token, nextMonth.id)).rejects.toThrow(/isn't part of this calendar/);
    expect((await db.contentCalendarItem.findUniqueOrThrow({ where: { id: theirs.id } })).approvalStatus).toBe("PENDING");
    await answer(token, mine.id);
  });

  it("stops working once withdrawn or expired, and a new link can follow", async () => {
    const c = await makeClient();
    const i = await newItem(c.id);
    const link = await ensureContentLink(db, { clientId: c.id, month: MONTH, actorId: admin.id });
    const token = publicToken(link.id);
    await revokeContentLink(db, link.id, admin.id);
    await expect(answer(token, i.id)).rejects.toThrow(/withdrawn/);
    await expect(revokeContentLink(db, link.id, admin.id)).rejects.toThrow(/already been withdrawn/);

    const fresh = await ensureContentLink(db, { clientId: c.id, month: MONTH, actorId: admin.id });
    expect(fresh.id).not.toBe(link.id);
    await db.publicLink.update({ where: { id: fresh.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(answer(publicToken(fresh.id), i.id)).rejects.toThrow(/expired/);
  });

  it("two answers at once: only one lands", async () => {
    const c = await makeClient();
    const i = await newItem(c.id);
    const token = await tokenFor(c.id);
    const results = await Promise.allSettled([answer(token, i.id), answer(token, i.id, "CHANGES_REQUESTED", "No")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.contentApproval.count({ where: { itemId: i.id } })).toBe(1);
  });

  it("an answered item can't be answered again until it's back with the client", async () => {
    const c = await makeClient();
    const i = await newItem(c.id);
    const token = await tokenFor(c.id);
    await answer(token, i.id, "CHANGES_REQUESTED", "New photo please");
    await expect(answer(token, i.id)).rejects.toThrow(/already have your changes/);
    await reopenForApproval(db, i.id, admin.id);
    await answer(token, i.id);
    await expect(answer(token, i.id)).rejects.toThrow(/already been approved/);
    await expect(reopenForApproval(db, i.id, admin.id)).rejects.toThrow(/isn't waiting on changes/);
  });
});

describe("what a client's answer does to the work", () => {
  it("approving finishes the approval step and leaves other work open", async () => {
    const r = await retainer();
    const i = await db.contentCalendarItem.findFirstOrThrow({ where: { projectId: r.projectId } });
    await answer(await tokenFor(r.clientId), i.id);
    const tasks = await db.task.findMany({ where: { deliverableId: i.deliverableId } });
    expect(tasks.filter((t) => t.status === "DONE").map((t) => t.title.split(": ")[1])).toEqual(["Client approval"]);
    expect((await db.deliverable.findUniqueOrThrow({ where: { id: i.deliverableId! } })).deliveredAt).toBeNull();
  });

  it("asking for changes sends waiting work back and counts a revision, flagging when it's over", async () => {
    const r = await retainer();
    const i = await db.contentCalendarItem.findFirstOrThrow({ where: { projectId: r.projectId } });
    const waiting = await db.task.findFirstOrThrow({ where: { deliverableId: i.deliverableId, title: { contains: "Client approval" } } });
    await changeTaskStatus(db, { taskId: waiting.id, status: "WAITING_CLIENT_APPROVAL", viewer: admin });
    const token = await tokenFor(r.clientId);

    const first = await answer(token, i.id, "CHANGES_REQUESTED", "Too long");
    expect(first.overRevisions).toBe(false);
    expect((await db.task.findUniqueOrThrow({ where: { id: waiting.id } })).status).toBe("IN_PROGRESS");

    await reopenForApproval(db, i.id, admin.id);
    const second = await answer(token, i.id, "CHANGES_REQUESTED", "Still too long");
    expect(second.overRevisions).toBe(true);
    expect((await db.deliverable.findUniqueOrThrow({ where: { id: i.deliverableId! } })).revisionsUsed).toBe(2);
    const note = await db.notification.findFirstOrThrow({ where: { userId: admin.id, title: { contains: "asked for changes" } }, orderBy: { createdAt: "desc" } });
    expect(note.body).toMatch(/change request/);
  });

  it("changing what was approved sends it back to the client; changing only the date doesn't", async () => {
    const c = await makeClient();
    const i = await newItem(c.id);
    await answer(await tokenFor(c.id), i.id);
    const sameWords = await saveContentItem(db, i.id, item(c.id, { publishDate: addDaysKey(TODAY, 2) }), admin.id);
    expect(sameWords.approvalReset).toBe(false);
    expect(sameWords.item.approvalStatus).toBe("APPROVED");
    const newWords = await saveContentItem(db, i.id, item(c.id, { caption: "Different" }), admin.id);
    expect(newWords.approvalReset).toBe(true);
    expect(newWords.item.approvalStatus).toBe("PENDING");

    await answer(await tokenFor(c.id), i.id);
    const link = await setCreativeLink(db, { itemId: i.id, creativeUrl: "https://drive.google.com/x", viewer: admin });
    expect(link.approvalReset).toBe(true);
  });

  it("publishing needs approval, delivers it, finishes its tasks, and can't happen twice", async () => {
    const r = await retainer();
    const i = await db.contentCalendarItem.findFirstOrThrow({ where: { projectId: r.projectId } });
    await expect(markPublished(db, { itemId: i.id, publishedLink: null, viewer: admin })).rejects.toThrow(/hasn't approved/);
    await answer(await tokenFor(r.clientId), i.id);
    const { closed } = await markPublished(db, { itemId: i.id, publishedLink: "https://instagram.com/p/x", viewer: admin });
    expect(closed).toBe(2);
    expect(await db.task.count({ where: { deliverableId: i.deliverableId, status: { not: "DONE" } } })).toBe(0);
    expect((await db.deliverable.findUniqueOrThrow({ where: { id: i.deliverableId! } })).deliveredAt).not.toBeNull();
    await expect(markPublished(db, { itemId: i.id, publishedLink: null, viewer: admin })).rejects.toThrow(/already been marked/);
    await expect(saveContentItem(db, i.id, item(r.clientId, { projectId: r.projectId }), admin.id)).rejects.toThrow(/can't be edited/);
    await undoPublished(db, i.id, admin.id);
    expect((await db.contentCalendarItem.findUniqueOrThrow({ where: { id: i.id } })).publishedAt).toBeNull();
  });

  it("an approval by phone is recorded as such, and finishes the approval step", async () => {
    const r = await retainer();
    const i = await db.contentCalendarItem.findFirstOrThrow({ where: { projectId: r.projectId } });
    await approveByHand(db, { itemId: i.id, comment: "On WhatsApp", actorId: admin.id, actorName: "Tester" });
    const a = await db.contentApproval.findFirstOrThrow({ where: { itemId: i.id } });
    expect(a.byName).toBe("Recorded by Tester");
    expect(a.publicLinkId).toBeNull();
    expect(await db.task.count({ where: { deliverableId: i.deliverableId, status: "DONE" } })).toBe(1);
    await expect(approveByHand(db, { itemId: i.id, comment: "Again", actorId: admin.id, actorName: "Tester" })).rejects.toThrow(/already been approved/);
  });
});

describe("Meta Ads", () => {
  it("campaign names are unique per client, because uploads match on them", async () => {
    const a = await makeClient();
    const b = await makeClient();
    await saveCampaign(db, null, campaignInput(a.id), admin.id);
    await expect(saveCampaign(db, null, campaignInput(a.id, { name: "LEAD generation" }), admin.id)).rejects.toThrow(/already has a campaign/);
    await saveCampaign(db, null, campaignInput(b.id), admin.id);
  });

  it("refuses overlapping dates and future results, and allows editing an entry in place", async () => {
    const c = await makeClient();
    const camp = await saveCampaign(db, null, campaignInput(c.id), admin.id);
    await saveSpendEntry(db, null, entryInput(camp.id), admin.id);
    await expect(saveSpendEntry(db, null, entryInput(camp.id, { periodStart: addDaysKey(TODAY, -8), periodEnd: addDaysKey(TODAY, -2) }), admin.id)).rejects.toThrow(/overlap/);
    await expect(saveSpendEntry(db, null, entryInput(camp.id, { periodStart: TODAY, periodEnd: addDaysKey(TODAY, 1) }), admin.id)).rejects.toThrow(/still to come/);
    const e = await db.adSpendEntry.findFirstOrThrow({ where: { campaignId: camp.id } });
    await saveSpendEntry(db, e.id, entryInput(camp.id, { spend: "6000" }), admin.id);
    expect((await db.adSpendEntry.findUniqueOrThrow({ where: { id: e.id } })).spend.toString()).toBe("6000");
  });

  it("two saves for the same dates at once: only one lands", async () => {
    const c = await makeClient();
    const camp = await saveCampaign(db, null, campaignInput(c.id), admin.id);
    const results = await Promise.allSettled([saveSpendEntry(db, null, entryInput(camp.id), admin.id), saveSpendEntry(db, null, entryInput(camp.id), admin.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.adSpendEntry.count({ where: { campaignId: camp.id } })).toBe(1);
  });

  it("a removed entry stops counting and its dates can be used again", async () => {
    const c = await makeClient();
    const camp = await saveCampaign(db, null, campaignInput(c.id), admin.id);
    await saveSpendEntry(db, null, entryInput(camp.id), admin.id);
    const e = await db.adSpendEntry.findFirstOrThrow({ where: { campaignId: camp.id } });
    await removeSpendEntry(db, e.id, admin.id);
    expect((await db.adSpendEntry.findUniqueOrThrow({ where: { id: e.id } })).archivedAt).not.toBeNull();
    await expect(removeSpendEntry(db, e.id, admin.id)).rejects.toThrow(/no longer exists/);
    await saveSpendEntry(db, null, entryInput(camp.id), admin.id);
    expect(await db.adSpendEntry.count({ where: { campaignId: camp.id, archivedAt: null } })).toBe(1);
  });

  it("ad spend never touches revenue: no invoice or payment is created", async () => {
    const c = await makeClient();
    const camp = await saveCampaign(db, null, campaignInput(c.id), admin.id);
    await saveSpendEntry(db, null, entryInput(camp.id), admin.id);
    expect(await db.invoice.count({ where: { clientId: c.id } })).toBe(0);
    expect(await db.payment.count({ where: { clientId: c.id } })).toBe(0);
  });

  describe("uploading a report", () => {
    const csv = (rows: string[]) => Buffer.from(["Campaign name,Reporting starts,Reporting ends,Amount spent (INR),Impressions,Link clicks,Leads", ...rows].join("\n"));
    const line = (name: string, from: number, to: number, spend = "1,000.50") => `${name},${addDaysKey(TODAY, from)},${addDaysKey(TODAY, to)},"${spend}",5000,100,5`;
    const send = async (clientId: string, buffer: Buffer) => {
      const p = await previewAdImport(db, { clientId, buffer, fileName: "report.csv" });
      return { preview: p, result: await commitAdImport(db, { clientId, rows: p.rows, columns: p.columns, actorId: admin.id }) };
    };

    it("previews without saving, then saves the good rows and skips the rest", async () => {
      const c = await makeClient();
      const camp = await saveCampaign(db, null, campaignInput(c.id), admin.id);
      const p = await previewAdImport(db, { clientId: c.id, buffer: csv([line("Lead Generation", -7, -1), line("Unknown", -7, -1)]), fileName: "report.csv" });
      expect(p.analysed.map((r) => r.errors.length)).toEqual([0, 1]);
      expect(await db.adSpendEntry.count({ where: { campaignId: camp.id } })).toBe(0);
      const r = await commitAdImport(db, { clientId: c.id, rows: p.rows, columns: p.columns, actorId: admin.id });
      expect(r).toEqual({ imported: 1, skipped: 1 });
      const saved = await db.adSpendEntry.findFirstOrThrow({ where: { campaignId: camp.id } });
      expect(saved.spend.toString()).toBe("1000.5");
      expect(saved.source).toBe("csv");
    });

    it("uploading the same report twice adds nothing the second time", async () => {
      const c = await makeClient();
      const camp = await saveCampaign(db, null, campaignInput(c.id), admin.id);
      const file = csv([line("Lead Generation", -7, -1)]);
      expect((await send(c.id, file)).result.imported).toBe(1);
      expect((await send(c.id, file)).result).toEqual({ imported: 0, skipped: 1 });
      expect(await db.adSpendEntry.count({ where: { campaignId: camp.id } })).toBe(1);
    });

    it("can't reach another client's campaign with the same name", async () => {
      const a = await makeClient();
      const b = await makeClient();
      const theirs = await saveCampaign(db, null, campaignInput(b.id), admin.id);
      const { result } = await send(a.id, csv([line("Lead Generation", -7, -1)]));
      expect(result.imported).toBe(0);
      expect(await db.adSpendEntry.count({ where: { campaignId: theirs.id } })).toBe(0);
    });

    it("explains a file missing the columns it needs", async () => {
      const c = await makeClient();
      await expect(previewAdImport(db, { clientId: c.id, buffer: Buffer.from("Name,Cost\nA,1"), fileName: "x.csv" })).rejects.toThrow(/Campaign name/);
      await expect(previewAdImport(db, { clientId: c.id, buffer: Buffer.from(""), fileName: "x.csv" })).rejects.toThrow(/empty/);
      await expect(previewAdImport(db, { clientId: c.id, buffer: Buffer.from("x"), fileName: "x.pdf" })).rejects.toThrow(/Excel/);
    });
  });
});

describe("renewals", () => {
  it("keeps domains in lower case and won't track the same thing twice", async () => {
    const c = await makeClient();
    const a = await saveAsset(db, null, assetInput(c.id), admin.id);
    expect(a.name).toBe("example.com");
    await expect(saveAsset(db, null, assetInput(c.id, { name: "EXAMPLE.com" }), admin.id)).rejects.toThrow(/already being tracked/);
    await saveAsset(db, null, assetInput(c.id, { kind: "HOSTING" }), admin.id);
  });

  it("renewing moves the date on and keeps the old one in the history", async () => {
    const c = await makeClient();
    const a = await saveAsset(db, null, assetInput(c.id), admin.id);
    const next = addDaysKey(TODAY, 385);
    await renewAsset(db, { assetId: a.id, newExpiry: next, actorId: admin.id });
    expect((await db.domainHostingAsset.findUniqueOrThrow({ where: { id: a.id } })).expiryDate.toISOString().slice(0, 10)).toBe(next);
    const log = await db.activityLog.findFirstOrThrow({ where: { entityId: a.id, action: "renewal.renewed" } });
    expect(log.changes).toMatchObject({ expiry: { from: addDaysKey(TODAY, 20), to: next } });
    await expect(renewAsset(db, { assetId: a.id, newExpiry: addDaysKey(TODAY, 30), actorId: admin.id })).rejects.toThrow(/after the current one/);
  });

  it("archiving keeps the record, and an archived item can't be renewed or edited", async () => {
    const c = await makeClient();
    const a = await saveAsset(db, null, assetInput(c.id), admin.id);
    await setAssetArchived(db, a.id, true, admin.id);
    await expect(renewAsset(db, { assetId: a.id, newExpiry: addDaysKey(TODAY, 400), actorId: admin.id })).rejects.toThrow(/no longer exists/);
    await expect(saveAsset(db, a.id, assetInput(c.id), admin.id)).rejects.toThrow(/no longer exists/);
    await saveAsset(db, null, assetInput(c.id), admin.id);
    expect(await db.domainHostingAsset.count({ where: { clientId: c.id } })).toBe(2);
  });

  it("the schema has nowhere to keep a password", async () => {
    const fields = Object.keys(db.domainHostingAsset.fields);
    expect(fields.filter((f) => /pass|secret|pwd/i.test(f))).toEqual([]);
  });
});
