import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { addDaysKey, dateOnlyKey, monthKeyOf, shiftMonth, todayKey } from "@/lib/dates";
import { publicToken } from "@/lib/public-token";
import { clientCreateSchema } from "@/lib/validators/client";
import { leadSchema } from "@/lib/validators/lead";
import { offerSchema } from "@/lib/validators/offer";
import { convertOfferSchema, employeeSchema, taskSchema } from "@/lib/validators/work";
import { isWorkingDay } from "@/lib/work-plan";
import { createClient } from "@/server/services/clients";
import { convertLead, createLead } from "@/server/services/leads";
import { acceptOfferViaLink, createOffer, markOfferSent, prepareForSending } from "@/server/services/offers";
import { addOnboardingItem, ensureOfferOnboarding, saveOnboardingTemplate, setOnboardingItemDone } from "@/server/services/onboarding";
import {
  convertOfferToProject,
  createChangeRequest,
  createRetainerMonthNow,
  decideChangeRequest,
  refreshProject,
  runDailyWork,
  saveMilestone,
  saveTargetProgress,
  setProjectArchived,
} from "@/server/services/projects";
import { addRevision, bulkUpdateTasks, changeTaskStatus, createTask, logTime, type Viewer } from "@/server/services/tasks";
import { createEmployee, deactivateEmployee, reactivateEmployee, updateEmployee } from "@/server/services/team";

const db = new PrismaClient();
const TODAY = todayKey();
const MONTH = monthKeyOf(TODAY);
const WORK_DAYS = [1, 2, 3, 4, 5, 6];

let admin: Viewer;
let social: string;
let design: string;
let retainerService: string;
let contentService: string;
let webService: string;

const employee = (over: Record<string, unknown>) =>
  employeeSchema.parse({ name: "Team Person", email: "person@example.com", role: "EMPLOYEE", phone: "", departmentId: "", designation: "", joiningDate: "", hourlyCost: "", dailyDigest: false, emailOnTask: false, ...over });

const retainerItem = (over: Record<string, unknown> = {}) => ({ serviceId: retainerService, description: "Social retainer", billingType: "MONTHLY_RETAINER", quantity: "1", unit: "month", rate: "20000", gstRate: "18", ...over });
const webItem = (over: Record<string, unknown> = {}) => ({ serviceId: webService, description: "Website", billingType: "MILESTONE", quantity: "1", unit: "project", rate: "100000", gstRate: "18", ...over });

async function makeClient() {
  return createClient(db, clientCreateSchema.parse({ companyName: `Client ${Math.random()}`, contactName: "Asha", country: "India", stateCode: "27", status: "ACTIVE", email: `c${Math.random()}@x.in`, phone: `9${Math.floor(Math.random() * 1e9).toString().padStart(9, "0")}` }), admin.id);
}

async function acceptOffer(who: Record<string, unknown>, items: Record<string, unknown>[]) {
  const offer = await createOffer(
    db,
    offerSchema.parse({ ...who, title: "Work", offerDate: TODAY, validUntil: addDaysKey(TODAY, 15), gstEnabled: true, milestones: [], items }),
    admin.id,
  );
  const link = await prepareForSending(db, offer.id, admin.id);
  await markOfferSent(db, { offerId: offer.id, followUpDate: addDaysKey(TODAY, 3), actorId: admin.id, via: "email" });
  await acceptOfferViaLink(db, { token: publicToken(link.id), name: "Asha", ip: "1.1.1.1" });
  return offer;
}

const convertInput = (offerId: string, over: Record<string, unknown> = {}) =>
  convertOfferSchema.parse({ offerId, name: "My project", managerId: admin.id, startDate: TODAY, deadline: "", retainerEnd: "", autoRenew: false, milestones: [], targets: [], createTasks: true, ...over });

async function retainerProject(items = [retainerItem()], over: Record<string, unknown> = {}) {
  const c = await makeClient();
  const offer = await acceptOffer({ clientId: c.id }, items);
  const project = await convertOfferToProject(db, convertInput(offer.id, { retainerEnd: addDaysKey(TODAY, 200), ...over }), admin.id);
  return { ...project, clientId: c.id, offerId: offer.id };
}

async function webProject(over: Record<string, unknown> = {}) {
  const c = await makeClient();
  const offer = await acceptOffer({ clientId: c.id }, [webItem()]);
  const project = await convertOfferToProject(db, convertInput(offer.id, over), admin.id);
  return { ...project, clientId: c.id, offerId: offer.id };
}

beforeAll(async () => {
  await db.settings.upsert({ where: { id: "agency" }, update: { stateCode: "27", offerValidityDays: 15, workingDays: WORK_DAYS, retainerTaskDay: 1 }, create: { id: "agency", agencyName: "Test", address: "Pune", stateCode: "27", workingDays: WORK_DAYS, retainerTaskDay: 1 } });
  const user = await db.user.upsert({ where: { email: "phase4-tester@example.com" }, update: { isActive: true, role: "ADMIN" }, create: { name: "Tester", email: "phase4-tester@example.com", passwordHash: "x", role: "ADMIN" } });
  admin = { id: user.id, role: "ADMIN", departmentId: null };
  social = (await db.department.upsert({ where: { name: "P4 Social" }, update: {}, create: { name: "P4 Social" } })).id;
  design = (await db.department.upsert({ where: { name: "P4 Design" }, update: {}, create: { name: "P4 Design" } })).id;

  const service = async (name: string, slug: string, billingType: "MONTHLY_RETAINER" | "PER_UNIT" | "MILESTONE", departmentId: string) =>
    (await db.service.upsert({ where: { slug }, update: { revisionsIncluded: 2 }, create: { name, slug, billingType, departmentId, revisionsIncluded: 2 } })).id;
  retainerService = await service("P4 Retainer", "p4-retainer", "MONTHLY_RETAINER", social);
  contentService = await service("P4 Content", "p4-content", "PER_UNIT", design);
  webService = await service("P4 Web", "p4-web", "MILESTONE", design);

  const subPost = await db.subService.findFirst({ where: { serviceId: contentService, name: "Static Post" } })
    ?? await db.subService.create({ data: { serviceId: contentService, name: "Static Post" } });
  const subReel = await db.subService.findFirst({ where: { serviceId: contentService, name: "Reel" } })
    ?? await db.subService.create({ data: { serviceId: contentService, name: "Reel" } });

  await db.taskTemplate.deleteMany({ where: { OR: [{ serviceId: { in: [retainerService, contentService, webService] } }, { name: { in: ["Post", "Reel"] } }] } });
  const template = (serviceId: string, name: string, titles: string[], departmentId: string, subServiceId?: string) =>
    db.taskTemplate.create({ data: { serviceId, name, subServiceId, steps: { create: titles.map((title, sortOrder) => ({ title, sortOrder, departmentId, durationDays: 1 })) } } });
  await template(retainerService, "Monthly Social", ["Calendar", "Report"], social);
  await template(contentService, "Post", ["Design", "Review"], design, subPost.id);
  await template(contentService, "Reel", ["Shoot", "Edit", "Post"], design, subReel.id);
  await template(webService, "Website", ["Requirements", "Development", "Launch"], design);

  await db.onboardingTemplateItem.deleteMany({ where: { OR: [{ serviceId: null }, { serviceId: { in: [retainerService, webService] } }] } });
  await db.onboardingTemplateItem.createMany({
    data: [
      { serviceId: null, title: "Advance received", sortOrder: 0 },
      { serviceId: retainerService, title: "Page access", sortOrder: 1 },
      { serviceId: webService, title: "Hosting access", sortOrder: 1 },
    ],
  });
});

beforeEach(async () => {
  await db.notification.deleteMany();
  await db.passwordResetToken.deleteMany();
  await db.contentCalendarItem.deleteMany();
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

describe("onboarding", () => {
  it("starts when the client accepts, with general and service items", async () => {
    const c = await makeClient();
    const offer = await acceptOffer({ clientId: c.id }, [retainerItem()]);
    const list = await db.onboardingChecklist.findUniqueOrThrow({ where: { offerId: offer.id }, include: { items: { orderBy: { sortOrder: "asc" } } } });
    expect(list.clientId).toBe(c.id);
    expect(list.items.map((i) => i.title)).toEqual(["Advance received", "Page access"]);
  });

  it("is only created once", async () => {
    const c = await makeClient();
    const offer = await acceptOffer({ clientId: c.id }, [retainerItem()]);
    await db.$transaction((tx) => ensureOfferOnboarding(tx, offer.id));
    expect(await db.onboardingChecklist.count({ where: { offerId: offer.id } })).toBe(1);
  });

  it("waits for a lead to become a client", async () => {
    const lead = await createLead(db, leadSchema.parse({ contactName: "Lead Person", phone: "9123456780", servicesInterested: [] }), admin.id);
    const offer = await acceptOffer({ leadId: lead.id }, [retainerItem()]);
    expect(await db.onboardingChecklist.count({ where: { offerId: offer.id } })).toBe(0);
    await convertLead(db, { leadId: lead.id, actorId: admin.id, client: clientCreateSchema.parse({ companyName: "From Lead", contactName: "Lead Person", country: "India", stateCode: "27", status: "ACTIVE" }) });
    expect(await db.onboardingChecklist.count({ where: { offerId: offer.id } })).toBe(1);
  });

  it("moves to the project on conversion, keeping what's done", async () => {
    const c = await makeClient();
    const offer = await acceptOffer({ clientId: c.id }, [retainerItem()]);
    const list = await db.onboardingChecklist.findUniqueOrThrow({ where: { offerId: offer.id }, include: { items: true } });
    await setOnboardingItemDone(db, list.items[0].id, true, admin.id);
    await addOnboardingItem(db, list.id, "Kick-off call", admin.id);
    const project = await convertOfferToProject(db, convertInput(offer.id, { retainerEnd: addDaysKey(TODAY, 90) }), admin.id);
    const after = await db.onboardingChecklist.findUniqueOrThrow({ where: { projectId: project.id }, include: { items: true } });
    expect(after.id).toBe(list.id);
    expect(after.items).toHaveLength(3);
    expect(after.items.filter((i) => i.isDone)).toHaveLength(1);
  });

  it("template changes affect future checklists, not existing ones", async () => {
    const c = await makeClient();
    const first = await acceptOffer({ clientId: c.id }, [webItem()]);
    await saveOnboardingTemplate(db, webService, ["Hosting access", "Domain access"], admin.id);
    const second = await acceptOffer({ clientId: c.id }, [webItem()]);
    const titles = async (offerId: string) => (await db.onboardingItem.findMany({ where: { checklist: { offerId } } })).map((i) => i.title).sort();
    expect(await titles(first.id)).toEqual(["Advance received", "Hosting access"]);
    expect(await titles(second.id)).toEqual(["Advance received", "Domain access", "Hosting access"]);
    await saveOnboardingTemplate(db, webService, ["Hosting access"], admin.id);
  });
});

describe("offer → project", () => {
  it("copies client, services and prices, and creates the tasks", async () => {
    const c = await makeClient();
    const offer = await acceptOffer({ clientId: c.id }, [webItem()]);
    const project = await convertOfferToProject(
      db,
      convertInput(offer.id, {
        milestones: [{ name: "Requirements & Specs", dueDate: addDaysKey(TODAY, 10), paymentPercent: "50" }, { name: "Launch", dueDate: "", paymentPercent: "50" }],
        targets: [{ serviceId: webService, metric: "Pages", unit: "count", targetValue: "12", higherIsBetter: true }, { serviceId: webService, metric: "Skipped", unit: "", targetValue: "", higherIsBetter: true }],
      }),
      admin.id,
    );
    expect(project.code).toMatch(/^PRJ-\d{4}$/);
    const saved = await db.project.findUniqueOrThrow({ where: { id: project.id }, include: { services: true, milestones: { orderBy: { sortOrder: "asc" } }, targets: true, tasks: { orderBy: { sortOrder: "asc" } } } });
    expect(saved.clientId).toBe(c.id);
    expect(saved.status).toBe("ACTIVE");
    expect(saved.isRetainer).toBe(false);
    expect(saved.services).toHaveLength(1);
    expect(saved.services[0].rate.toString()).toBe("100000");
    // 1,00,000 + 18% GST, half each
    expect(saved.milestones[0].amount?.toString()).toBe("59000");
    expect(saved.targets.map((t) => t.metric)).toEqual(["Pages"]);
    expect(saved.tasks.map((t) => t.title)).toEqual(["Requirements", "Development", "Launch"]);
    expect(saved.tasks[0].milestoneId).toBe(saved.milestones[0].id);
    expect(saved.tasks[2].milestoneId).toBe(saved.milestones[1].id);
    expect(saved.tasks.every((t) => t.departmentId === design && t.clientId === c.id)).toBe(true);
    expect(saved.tasks[1].dueDate!.getTime()).toBeGreaterThan(saved.tasks[0].dueDate!.getTime());
  });

  it("can skip tasks", async () => {
    const project = await webProject({ createTasks: false });
    expect(await db.task.count({ where: { projectId: project.id } })).toBe(0);
  });

  it("repeats tasks for each unit of a per-unit item", async () => {
    const c = await makeClient();
    const reel = await db.subService.findFirstOrThrow({ where: { serviceId: contentService, name: "Reel" } });
    const offer = await acceptOffer({ clientId: c.id }, [{ serviceId: contentService, subServiceId: reel.id, description: "Reels", billingType: "PER_UNIT", quantity: "2", unit: "reel", rate: "3500", gstRate: "18" }]);
    const project = await convertOfferToProject(db, convertInput(offer.id), admin.id);
    expect(project.tasks).toBe(6);
    const titles = (await db.task.findMany({ where: { projectId: project.id } })).map((t) => t.title);
    expect(titles).toContain("Reel #2: Edit");
  });

  it("refuses a second conversion, even at the same moment", async () => {
    const c = await makeClient();
    const offer = await acceptOffer({ clientId: c.id }, [webItem()]);
    const results = await Promise.allSettled([convertOfferToProject(db, convertInput(offer.id), admin.id), convertOfferToProject(db, convertInput(offer.id), admin.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason.message).toMatch(/already been converted/);
    expect(await db.project.count({ where: { offerId: offer.id } })).toBe(1);
    expect(await db.task.count({ where: { project: { offerId: offer.id } } })).toBe(3);
    await expect(convertOfferToProject(db, convertInput(offer.id), admin.id)).rejects.toThrow(/already been converted/);
  });

  it("gives projects made at the same moment different codes", async () => {
    const c = await makeClient();
    const offers = await Promise.all([1, 2, 3].map(() => acceptOffer({ clientId: c.id }, [webItem()])));
    const projects = await Promise.all(offers.map((o) => convertOfferToProject(db, convertInput(o.id), admin.id)));
    expect(new Set(projects.map((p) => p.code)).size).toBe(3);
  });

  it("refuses offers that aren't accepted or have no client", async () => {
    const c = await makeClient();
    const draft = await createOffer(db, offerSchema.parse({ clientId: c.id, title: "Draft", offerDate: TODAY, validUntil: addDaysKey(TODAY, 15), gstEnabled: true, milestones: [], items: [webItem()] }), admin.id);
    await expect(convertOfferToProject(db, convertInput(draft.id), admin.id)).rejects.toThrow(/Only an accepted offer/);

    const lead = await createLead(db, leadSchema.parse({ contactName: "Lead Person", phone: "9123456780", servicesInterested: [] }), admin.id);
    const leadOffer = await acceptOffer({ leadId: lead.id }, [webItem()]);
    await expect(convertOfferToProject(db, convertInput(leadOffer.id), admin.id)).rejects.toThrow(/Convert the lead/);
  });

  it("a retainer needs an end date, and a failed conversion leaves nothing behind", async () => {
    const c = await makeClient();
    const offer = await acceptOffer({ clientId: c.id }, [retainerItem()]);
    await expect(convertOfferToProject(db, convertInput(offer.id), admin.id)).rejects.toThrow(/retainer ends/);
    expect(await db.project.count({ where: { offerId: offer.id } })).toBe(0);
  });
});

describe("retainer months", () => {
  const pkg = () => [retainerItem({ deliverables: [{ format: "STATIC_POST", qtyPerMonth: 2 }, { format: "REEL", qtyPerMonth: 1 }] })];

  it("creates the package's deliverables and tasks on conversion, on working days", async () => {
    const items = pkg();
    const p = await retainerProject(items);
    const deliverables = await db.deliverable.findMany({ where: { projectId: p.id } });
    expect(deliverables).toHaveLength(3);
    expect(deliverables.every((d) => d.month === MONTH)).toBe(true);
    const tasks = await db.task.findMany({ where: { projectId: p.id } });
    // Post = 2 tasks each, Reel = 3, the service's monthly work = 2
    expect(tasks).toHaveLength(2 * 2 + 3 + 2);
    expect(p.tasks).toBe(9);
    for (const t of tasks) {
      expect(dateOnlyKey(t.dueDate!) >= dateOnlyKey(t.startDate!)).toBe(true);
      expect(isWorkingDay(dateOnlyKey(t.dueDate!), WORK_DAYS)).toBe(true);
    }
    expect(tasks.filter((t) => t.deliverableId).every((t) => t.title.includes("#"))).toBe(true);
  });

  it("never creates a month twice, even at the same moment", async () => {
    const p = await retainerProject(pkg());
    const next = shiftMonth(MONTH, 1);
    const results = await Promise.all([createRetainerMonthNow(db, p.id, next, admin.id), createRetainerMonthNow(db, p.id, next, admin.id)]);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(await db.deliverable.count({ where: { projectId: p.id, month: next } })).toBe(3);
    expect(await db.retainerRun.count({ where: { projectId: p.id, month: next } })).toBe(1);
    const again = await createRetainerMonthNow(db, p.id, next, admin.id);
    expect(again.created).toBe(false);
    expect(await db.deliverable.count({ where: { projectId: p.id, month: next } })).toBe(3);
  });

  it("does nothing outside the retainer's period", async () => {
    const p = await retainerProject(pkg(), { retainerEnd: addDaysKey(TODAY, 20) });
    expect((await createRetainerMonthNow(db, p.id, shiftMonth(MONTH, -1), admin.id)).created).toBe(false);
    expect((await createRetainerMonthNow(db, p.id, shiftMonth(MONTH, 6), admin.id)).created).toBe(false);
  });

  it("the daily job can run again and again without doubling", async () => {
    const p = await retainerProject(pkg());
    const next = `${shiftMonth(MONTH, 1)}-01`;
    const first = await runDailyWork(db, next);
    expect(first.monthsCreated).toBe(1);
    const count = await db.task.count({ where: { projectId: p.id } });
    const second = await runDailyWork(db, next);
    expect(second.monthsCreated).toBe(0);
    expect(await db.task.count({ where: { projectId: p.id } })).toBe(count);
  });

  it("waits for the chosen day of the month", async () => {
    const p = await retainerProject(pkg());
    await db.project.update({ where: { id: p.id }, data: { retainerTaskDay: 5 } });
    const next = shiftMonth(MONTH, 1);
    expect((await runDailyWork(db, `${next}-04`)).monthsCreated).toBe(0);
    expect((await runDailyWork(db, `${next}-05`)).monthsCreated).toBe(1);
  });

  it("auto-renew extends the period once; without it nothing is created after the end", async () => {
    const ending = addDaysKey(TODAY, 2);
    const renewing = await retainerProject([retainerItem()], { retainerEnd: ending, autoRenew: true });
    const later = addDaysKey(TODAY, 3);
    await runDailyWork(db, later);
    const after = await db.project.findUniqueOrThrow({ where: { id: renewing.id } });
    expect(dateOnlyKey(after.retainerEnd!)).toBe(addDaysKey(ending, 3));
    await runDailyWork(db, later);
    expect(dateOnlyKey((await db.project.findUniqueOrThrow({ where: { id: renewing.id } })).retainerEnd!)).toBe(addDaysKey(ending, 3));

    const stopping = await retainerProject([retainerItem()], { retainerEnd: addDaysKey(TODAY, 2) });
    const farAway = `${shiftMonth(MONTH, 3)}-02`;
    await runDailyWork(db, farAway);
    expect(await db.retainerRun.count({ where: { projectId: stopping.id, month: shiftMonth(MONTH, 3) } })).toBe(0);
  });

  it("skips paused projects", async () => {
    const p = await retainerProject(pkg());
    await db.project.update({ where: { id: p.id }, data: { status: "ON_HOLD" } });
    await runDailyWork(db, `${shiftMonth(MONTH, 1)}-01`);
    expect(await db.retainerRun.count({ where: { projectId: p.id, month: shiftMonth(MONTH, 1) } })).toBe(0);
  });
});

describe("deliverables", () => {
  it("are delivered when all their tasks are done, and un-delivered if one reopens", async () => {
    const p = await retainerProject([retainerItem({ deliverables: [{ format: "REEL", qtyPerMonth: 1 }] })]);
    const d = await db.deliverable.findFirstOrThrow({ where: { projectId: p.id } });
    const tasks = await db.task.findMany({ where: { deliverableId: d.id } });
    for (const t of tasks.slice(0, -1)) await changeTaskStatus(db, { taskId: t.id, status: "DONE", viewer: admin });
    expect((await db.deliverable.findUniqueOrThrow({ where: { id: d.id } })).deliveredAt).toBeNull();
    const last = tasks[tasks.length - 1];
    await changeTaskStatus(db, { taskId: last.id, status: "DONE", viewer: admin });
    expect((await db.deliverable.findUniqueOrThrow({ where: { id: d.id } })).deliveredAt).not.toBeNull();
    await changeTaskStatus(db, { taskId: last.id, status: "IN_PROGRESS", viewer: admin });
    expect((await db.deliverable.findUniqueOrThrow({ where: { id: d.id } })).deliveredAt).toBeNull();
  });

  it("a revision past the included ones flags it, and the change request is tracked", async () => {
    const p = await retainerProject([retainerItem({ deliverables: [{ format: "REEL", qtyPerMonth: 1 }] })]);
    const d = await db.deliverable.findFirstOrThrow({ where: { projectId: p.id } });
    const task = await db.task.findFirstOrThrow({ where: { deliverableId: d.id } });
    expect((await addRevision(db, { taskId: task.id, viewer: admin })).exceeded).toBe(false);
    expect((await addRevision(db, { taskId: task.id, viewer: admin })).exceeded).toBe(false);
    expect((await addRevision(db, { taskId: task.id, viewer: admin })).exceeded).toBe(true);
    expect((await db.deliverable.findUniqueOrThrow({ where: { id: d.id } })).revisionsUsed).toBe(3);

    const cr = await createChangeRequest(db, { projectId: p.id, deliverableId: d.id, description: "Extra edit round", estimate: "2000", isBillable: true }, admin.id);
    expect(cr.status).toBe("PENDING");
    await decideChangeRequest(db, cr.id, "APPROVED", admin.id);
    expect((await db.changeRequest.findUniqueOrThrow({ where: { id: cr.id } })).status).toBe("APPROVED");
    await db.changeRequest.update({ where: { id: cr.id }, data: { status: "INVOICED" } });
    await expect(decideChangeRequest(db, cr.id, "REJECTED", admin.id)).rejects.toThrow(/invoiced/);
  });

  it("a change request can't point at another project's deliverable", async () => {
    const a = await retainerProject([retainerItem({ deliverables: [{ format: "REEL", qtyPerMonth: 1 }] })]);
    const b = await webProject();
    const d = await db.deliverable.findFirstOrThrow({ where: { projectId: a.id } });
    await expect(createChangeRequest(db, { projectId: b.id, deliverableId: d.id, description: "Wrong project", estimate: "100", isBillable: true }, admin.id)).rejects.toThrow(/isn't part of/);
  });
});

describe("who can do what with a task", () => {
  async function people() {
    const inDept = await createEmployee(db, employee({ email: "a@example.com", name: "Dept Person", departmentId: design }), admin.id);
    const other = await createEmployee(db, employee({ email: "b@example.com", name: "Other Person", departmentId: social }), admin.id);
    return {
      inDept: { id: inDept.user.id, role: "EMPLOYEE", departmentId: design } as Viewer,
      other: { id: other.user.id, role: "EMPLOYEE", departmentId: social } as Viewer,
    };
  }
  const task = (over: Record<string, unknown>) => taskSchema.parse({ title: "A job", description: "", projectId: "", clientId: "", serviceId: "", milestoneId: "", assigneeId: "", departmentId: "", priority: "MEDIUM", startDate: "", dueDate: "", ...over });

  it("an employee can work on their department's tasks, and can't touch others", async () => {
    const { inDept, other } = await people();
    const t = await createTask(db, task({ departmentId: design }), admin.id);
    await changeTaskStatus(db, { taskId: t.id, status: "IN_PROGRESS", viewer: inDept });
    await expect(changeTaskStatus(db, { taskId: t.id, status: "DONE", viewer: other })).rejects.toThrow(/isn't available/);
    await expect(logTime(db, { taskId: t.id, date: TODAY, minutes: 30, note: null, viewer: other })).rejects.toThrow(/isn't available/);
    await logTime(db, { taskId: t.id, date: TODAY, minutes: 30, note: null, viewer: inDept });
    expect(await db.timeLog.count({ where: { taskId: t.id } })).toBe(1);
  });

  it("an employee can work on a task assigned to them in another department", async () => {
    const { other } = await people();
    const t = await createTask(db, task({ departmentId: design, assigneeId: other.id }), admin.id);
    await changeTaskStatus(db, { taskId: t.id, status: "DONE", viewer: other });
    expect((await db.task.findUniqueOrThrow({ where: { id: t.id } })).completedAt).not.toBeNull();
  });

  it("Blocked keeps its reason, and bulk changes refuse Blocked", async () => {
    const { inDept } = await people();
    const t = await createTask(db, task({ departmentId: design }), admin.id);
    await expect(changeTaskStatus(db, { taskId: t.id, status: "BLOCKED", viewer: inDept })).rejects.toThrow(/blocking/);
    await changeTaskStatus(db, { taskId: t.id, status: "BLOCKED", blockedReason: "No logo yet", viewer: inDept });
    expect((await db.task.findUniqueOrThrow({ where: { id: t.id } })).blockedReason).toBe("No logo yet");
    await changeTaskStatus(db, { taskId: t.id, status: "TODO", viewer: inDept });
    expect((await db.task.findUniqueOrThrow({ where: { id: t.id } })).blockedReason).toBeNull();
    await expect(bulkUpdateTasks(db, { taskIds: [t.id], status: "BLOCKED" }, admin.id)).rejects.toThrow(/one at a time/);
  });

  it("bulk reassign tells the new person, and inactive people can't be assigned", async () => {
    const { inDept, other } = await people();
    const a = await createTask(db, task({ departmentId: design }), admin.id);
    const b = await createTask(db, task({ departmentId: design }), admin.id);
    await bulkUpdateTasks(db, { taskIds: [a.id, b.id], assigneeId: inDept.id }, admin.id);
    expect(await db.task.count({ where: { assigneeId: inDept.id } })).toBe(2);
    expect(await db.notification.count({ where: { userId: inDept.id } })).toBeGreaterThan(0);
    await deactivateEmployee(db, { userId: other.id, reassignTo: null, actorId: admin.id });
    await expect(createTask(db, task({ assigneeId: other.id }), admin.id)).rejects.toThrow(/inactive/);
    await expect(bulkUpdateTasks(db, { taskIds: [a.id], assigneeId: other.id }, admin.id)).rejects.toThrow(/inactive/);
  });

  it("a task takes its client from the project", async () => {
    const p = await webProject();
    const t = await createTask(db, task({ projectId: p.id, departmentId: design }), admin.id);
    expect(t.clientId).toBe(p.clientId);
  });
});

describe("project health and progress", () => {
  it("follows overdue tasks and missed milestones, and comes back when fixed", async () => {
    const p = await webProject({ milestones: [{ name: "Launch", dueDate: addDaysKey(TODAY, 30), paymentPercent: "" }] });
    const health = async () => (await db.project.findUniqueOrThrow({ where: { id: p.id } })).healthAuto;
    await refreshProject(db, p.id, TODAY);
    expect(await health()).toBe("ON_TRACK");

    await refreshProject(db, p.id, addDaysKey(TODAY, 31));
    expect(await health()).toBe("DELAYED");

    const tasks = await db.task.findMany({ where: { projectId: p.id } });
    for (const t of tasks) await changeTaskStatus(db, { taskId: t.id, status: "DONE", viewer: admin });
    expect((await db.project.findUniqueOrThrow({ where: { id: p.id } })).progressPercent).toBe(100);

    const milestone = await db.milestone.findFirstOrThrow({ where: { projectId: p.id } });
    await saveMilestone(db, { projectId: p.id, id: milestone.id, name: "Launch", dueDate: addDaysKey(TODAY, 30), paymentPercent: null, completed: true }, admin.id);
    await refreshProject(db, p.id, addDaysKey(TODAY, 31));
    expect(await health()).toBe("ON_TRACK");
  });

  it("waiting on the client isn't counted as the agency's delay", async () => {
    const p = await webProject();
    const tasks = await db.task.findMany({ where: { projectId: p.id } });
    for (const t of tasks) await changeTaskStatus(db, { taskId: t.id, status: "WAITING_CLIENT_APPROVAL", viewer: admin });
    await refreshProject(db, p.id, addDaysKey(TODAY, 60));
    expect((await db.project.findUniqueOrThrow({ where: { id: p.id } })).healthAuto).toBe("ON_TRACK");
  });

  it("milestone payments can't pass 100%", async () => {
    const p = await webProject({ milestones: [{ name: "One", dueDate: "", paymentPercent: "60" }] });
    await expect(saveMilestone(db, { projectId: p.id, name: "Two", dueDate: "", paymentPercent: "50", completed: false }, admin.id)).rejects.toThrow(/more than 100%/);
    await saveMilestone(db, { projectId: p.id, name: "Two", dueDate: "", paymentPercent: "40", completed: false }, admin.id);
    expect(await db.milestone.count({ where: { projectId: p.id } })).toBe(2);
  });

  it("entering a month's result again corrects it, and future months are refused", async () => {
    const p = await webProject({ targets: [{ serviceId: webService, metric: "Pages", unit: "", targetValue: "10", higherIsBetter: true }] });
    const target = await db.target.findFirstOrThrow({ where: { projectId: p.id } });
    await saveTargetProgress(db, { targetId: target.id, month: MONTH, actualValue: "3", note: null }, admin.id);
    await saveTargetProgress(db, { targetId: target.id, month: MONTH, actualValue: "5", note: null }, admin.id);
    const rows = await db.targetProgress.findMany({ where: { targetId: target.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].actualValue.toString()).toBe("5");
    await expect(saveTargetProgress(db, { targetId: target.id, month: shiftMonth(MONTH, 1), actualValue: "5", note: null }, admin.id)).rejects.toThrow(/future/);
  });

  it("only finished projects can be archived, and nothing is deleted", async () => {
    const p = await webProject();
    await expect(setProjectArchived(db, p.id, true, admin.id)).rejects.toThrow(/Completed or Cancelled/);
    await db.project.update({ where: { id: p.id }, data: { status: "COMPLETED" } });
    await setProjectArchived(db, p.id, true, admin.id);
    expect((await db.project.findUniqueOrThrow({ where: { id: p.id } })).archivedAt).not.toBeNull();
    expect(await db.task.count({ where: { projectId: p.id } })).toBe(3);
  });
});

describe("team", () => {
  it("a new person gets a link, not a known password, and emails can't repeat", async () => {
    const made = await createEmployee(db, employee({ email: "new@example.com", departmentId: design, hourlyCost: "350" }), admin.id);
    expect(made.token.length).toBeGreaterThan(30);
    const token = await db.passwordResetToken.findFirstOrThrow({ where: { userId: made.user.id } });
    expect(token.tokenHash).not.toBe(made.token);
    const profile = await db.employeeProfile.findUniqueOrThrow({ where: { userId: made.user.id } });
    expect(profile.hourlyCost?.toString()).toBe("350");
    await expect(createEmployee(db, employee({ email: "new@example.com" }), admin.id)).rejects.toThrow(/already exists/);
  });

  it("deactivating keeps history and hands over only open tasks", async () => {
    const leaving = await createEmployee(db, employee({ email: "leaving@example.com" }), admin.id);
    const next = await createEmployee(db, employee({ email: "next@example.com" }), admin.id);
    const t = (title: string) => createTask(db, taskSchema.parse({ title, description: "", projectId: "", clientId: "", serviceId: "", milestoneId: "", assigneeId: leaving.user.id, departmentId: "", priority: "MEDIUM", startDate: "", dueDate: "" }), admin.id);
    const open = await t("Open job");
    const done = await t("Finished job");
    await changeTaskStatus(db, { taskId: done.id, status: "DONE", viewer: admin });

    const moved = await deactivateEmployee(db, { userId: leaving.user.id, reassignTo: next.user.id, actorId: admin.id });
    expect(moved).toBe(1);
    expect((await db.task.findUniqueOrThrow({ where: { id: open.id } })).assigneeId).toBe(next.user.id);
    expect((await db.task.findUniqueOrThrow({ where: { id: done.id } })).assigneeId).toBe(leaving.user.id);
    const user = await db.user.findUniqueOrThrow({ where: { id: leaving.user.id } });
    expect(user.isActive).toBe(false);
    expect(await db.passwordResetToken.count({ where: { userId: user.id } })).toBe(0);

    await reactivateEmployee(db, user.id, admin.id);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).isActive).toBe(true);
  });

  it("won't hand tasks to an inactive person, or to the same person", async () => {
    const a = await createEmployee(db, employee({ email: "a@example.com" }), admin.id);
    const b = await createEmployee(db, employee({ email: "b@example.com" }), admin.id);
    await deactivateEmployee(db, { userId: b.user.id, reassignTo: null, actorId: admin.id });
    await expect(deactivateEmployee(db, { userId: a.user.id, reassignTo: b.user.id, actorId: admin.id })).rejects.toThrow(/inactive/);
    await expect(deactivateEmployee(db, { userId: a.user.id, reassignTo: a.user.id, actorId: admin.id })).rejects.toThrow(/someone else/);
  });

  it("always leaves an admin, and you can't remove your own access", async () => {
    const second = await createEmployee(db, employee({ email: "second@example.com", role: "MANAGER" }), admin.id);
    await expect(deactivateEmployee(db, { userId: admin.id, reassignTo: null, actorId: admin.id })).rejects.toThrow(/deactivate yourself/);
    await expect(deactivateEmployee(db, { userId: admin.id, reassignTo: null, actorId: second.user.id })).rejects.toThrow(/only admin/);
    await expect(updateEmployee(db, admin.id, employee({ email: "phase4-tester@example.com", name: "Tester", role: "EMPLOYEE" }), second.user.id)).rejects.toThrow(/only admin/);
    await updateEmployee(db, second.user.id, employee({ email: "second@example.com", role: "ADMIN" }), admin.id);
    await expect(updateEmployee(db, admin.id, employee({ email: "phase4-tester@example.com", name: "Tester", role: "MANAGER" }), admin.id)).rejects.toThrow(/your own role/);
  });
});
