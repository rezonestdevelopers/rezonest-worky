import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { addDaysKey, todayKey } from "@/lib/dates";
import { clientCreateSchema } from "@/lib/validators/client";
import { assetSchema, campaignSchema, spendEntrySchema } from "@/lib/validators/delivery";
import { employeeSchema, taskSchema } from "@/lib/validators/work";
import { saveCampaign, saveSpendEntry } from "@/server/services/ads";
import { createClient } from "@/server/services/clients";
import { runDigests, sendDigestNow, sendNotificationEmails, type Mailer } from "@/server/services/digest";
import { getTemplate, resetTemplate, saveTemplate } from "@/server/services/email-templates";
import { reminderAttentionCount, reminderScope, restoreSnoozed, setReminderState, syncReminders } from "@/server/services/reminders";
import { saveAsset } from "@/server/services/renewals";
import { addComment, bulkUpdateTasks, changeTaskStatus, createTask, setTaskArchived, updateTask, type Viewer } from "@/server/services/tasks";
import { createEmployee } from "@/server/services/team";

const db = new PrismaClient();
const TODAY = todayKey();

let admin: Viewer;

const client = () => createClient(db, clientCreateSchema.parse({ companyName: `Client ${Math.random()}`, contactName: "Asha", country: "India", stateCode: "27", status: "ACTIVE", email: `c${Math.random()}@x.in`, phone: `9${Math.floor(Math.random() * 1e9).toString().padStart(9, "0")}` }), admin.id);
const taskInput = (over: Record<string, unknown>) => taskSchema.parse({ title: "A job", description: "", projectId: "", clientId: "", serviceId: "", milestoneId: "", assigneeId: admin.id, departmentId: "", priority: "MEDIUM", startDate: "", dueDate: TODAY, ...over });
const task = (over: Record<string, unknown> = {}) => createTask(db, taskInput(over), admin.id);
const person = async (email: string, over: Record<string, unknown> = {}) => {
  const made = await createEmployee(db, employeeSchema.parse({ name: email.length > 15 ? email.split("@")[0] : `${email.split("@")[0]} person`, email, role: "EMPLOYEE", phone: "", departmentId: "", designation: "", joiningDate: "", hourlyCost: "", dailyDigest: false, emailOnTask: false, ...over }), admin.id);
  return { id: made.user.id, role: made.user.role, departmentId: null } as Viewer;
};
const reminder = (key: string) => db.reminder.findUnique({ where: { dedupeKey: key } });
const action = (key: string, a: { id: string }, over: Record<string, unknown> = {}) => ({ key, type: "TASK_OVERDUE" as const, title: "T", entityType: "Task", entityId: a.id, action: "done" as const, ...over });

const mailer = () => {
  const sent: { to: string; subject: string; text: string }[] = [];
  const send: Mailer = async (m) => {
    sent.push(m);
    return { ok: true };
  };
  return { sent, send };
};

/** A time today in IST, so digest tests don't depend on when they run. */
const at = (hhmm: string) => new Date(`${TODAY}T${hhmm}:00+05:30`);

beforeAll(async () => {
  await db.settings.upsert({ where: { id: "agency" }, update: { digestEnabled: true, digestTime: "09:00", dueSoonDays: 3, adBudgetAlertPercent: 85, approvalWaitDays: 2, renewalAlertDays: [30, 15, 7, 1] }, create: { id: "agency", agencyName: "Test", address: "Pune", stateCode: "27" } });
  const user = await db.user.upsert({ where: { email: "phase6-tester@example.com" }, update: { isActive: true, role: "ADMIN", name: "Boss" }, create: { name: "Boss", email: "phase6-tester@example.com", passwordHash: "x", role: "ADMIN" } });
  admin = { id: user.id, role: "ADMIN", departmentId: null };
  await db.user.updateMany({ where: { role: "ADMIN", id: { not: user.id } }, data: { isActive: false } });
});

beforeEach(async () => {
  await db.invoiceRun.deleteMany();
  await db.paymentAllocation.deleteMany();
  await db.payment.deleteMany();
  await db.creditNote.deleteMany();
  await db.invoiceItem.deleteMany();
  await db.invoice.updateMany({ data: { convertedFromId: null } });
  await db.invoice.deleteMany();
  await db.reminder.deleteMany();
  await db.digestRun.deleteMany();
  await db.notification.deleteMany();
  await db.emailTemplate.deleteMany({ where: { key: { in: ["offer_send", "daily_digest"] } } });
  await db.adSpendEntry.deleteMany();
  await db.adCampaign.deleteMany();
  await db.domainHostingAsset.deleteMany();
  await db.contentApproval.deleteMany();
  await db.contentCalendarItem.deleteMany();
  await db.document.deleteMany();
  await db.passwordResetToken.deleteMany();
  await db.changeRequest.deleteMany();
  await db.timeLog.deleteMany();
  await db.taskComment.deleteMany();
  await db.task.deleteMany();
  await db.onboardingChecklist.deleteMany();
  await db.project.deleteMany();
  await db.publicLink.deleteMany();
  await db.offerItem.deleteMany();
  await db.offer.deleteMany();
  await db.lead.deleteMany();
  await db.client.deleteMany();
  await db.activityLog.deleteMany();
  await db.employeeProfile.deleteMany();
  await db.user.deleteMany({ where: { role: { not: "ADMIN" } } });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("the reminder job", () => {
  it("creates one reminder per situation, however many times it runs", async () => {
    const late = await task({ dueDate: addDaysKey(TODAY, -2) });
    const todayTask = await task();
    const soon = await task({ dueDate: addDaysKey(TODAY, 2) });
    await task({ dueDate: addDaysKey(TODAY, 20) });
    const first = await syncReminders(db);
    expect(first.created).toBe(3);
    const second = await syncReminders(db);
    expect(second.created).toBe(0);
    expect(second.closed).toBe(0);
    await Promise.all([syncReminders(db), syncReminders(db), syncReminders(db)]);
    expect(await db.reminder.count()).toBe(3);
    expect((await reminder(`TASK_OVERDUE:${late.id}`))?.assigneeId).toBe(admin.id);
    expect(await reminder(`TASK_DUE_TODAY:${todayTask.id}:${TODAY}`)).not.toBeNull();
    expect(await reminder(`TASK_DUE_SOON:${soon.id}:${addDaysKey(TODAY, 2)}`)).not.toBeNull();
  });

  it("closes a reminder by itself when the work is done, and reopens it if the work reopens", async () => {
    const t = await task({ dueDate: addDaysKey(TODAY, -2) });
    const key = `TASK_OVERDUE:${t.id}`;
    await syncReminders(db);
    await changeTaskStatus(db, { taskId: t.id, status: "DONE", viewer: admin });
    expect((await syncReminders(db)).closed).toBe(1);
    const closed = await reminder(key);
    expect(closed?.status).toBe("DONE");
    expect(closed?.doneManually).toBe(false);
    await changeTaskStatus(db, { taskId: t.id, status: "IN_PROGRESS", viewer: admin });
    await syncReminders(db);
    expect((await reminder(key))?.status).toBe("OPEN");
  });

  it("stays done if someone marked it done, even while the task is still overdue", async () => {
    const t = await task({ dueDate: addDaysKey(TODAY, -2) });
    const key = `TASK_OVERDUE:${t.id}`;
    await syncReminders(db);
    await setReminderState(db, action(key, t), admin);
    await syncReminders(db);
    const r = await reminder(key);
    expect(r?.status).toBe("DONE");
    expect(r?.doneManually).toBe(true);
  });

  it("a snooze holds until its time, then comes back", async () => {
    const t = await task({ dueDate: addDaysKey(TODAY, -2) });
    const key = `TASK_OVERDUE:${t.id}`;
    await syncReminders(db);
    const now = new Date();
    await setReminderState(db, action(key, t, { action: "snooze", days: 3 }), admin, now);
    const r = await reminder(key);
    expect(r?.status).toBe("SNOOZED");
    expect(r!.snoozedUntil!.getTime()).toBe(now.getTime() + 3 * 86_400_000);
    await syncReminders(db, TODAY, now);
    expect((await reminder(key))?.status).toBe("SNOOZED");
    await syncReminders(db, TODAY, new Date(now.getTime() + 3 * 86_400_000 + 1000));
    const woken = await reminder(key);
    expect(woken?.status).toBe("OPEN");
    expect(woken?.snoozedUntil).toBeNull();
  });

  it("a renewal alerts again at each threshold, even if the last one was snoozed", async () => {
    const c = await client();
    const asset = await saveAsset(db, null, assetSchema.parse({ clientId: c.id, kind: "DOMAIN", name: "example.com", provider: "", plan: "", purchaseDate: "", expiryDate: addDaysKey(TODAY, 20), emailAccounts: "", costPrice: "100", renewalPrice: "200", autoRenew: false, credentialsLocation: "", notes: "" }), admin.id);
    await syncReminders(db);
    const at20 = await db.reminder.findFirstOrThrow({ where: { type: "RENEWAL_DUE", entityId: asset.id } });
    expect(at20.dedupeKey).toContain(":30");
    await setReminderState(db, { key: at20.dedupeKey, type: "RENEWAL_DUE", title: "x", entityType: "DomainHostingAsset", entityId: asset.id, action: "snooze", days: 30 }, admin);
    await syncReminders(db, addDaysKey(TODAY, 7));
    const open = await db.reminder.findMany({ where: { type: "RENEWAL_DUE", entityId: asset.id, status: "OPEN" } });
    expect(open).toHaveLength(1);
    expect(open[0].dedupeKey).toContain(":15");
  });

  it("flags ad budgets past the alert level, and an offer's reminder clears once it's resolved", async () => {
    const c = await client();
    const camp = await saveCampaign(db, null, campaignSchema.parse({ clientId: c.id, projectId: "", name: "Leads", objective: "", status: "ACTIVE", startDate: addDaysKey(TODAY, -30), endDate: "", plannedBudget: "1000" }), admin.id);
    await saveSpendEntry(db, null, spendEntrySchema.parse({ campaignId: camp.id, periodStart: addDaysKey(TODAY, -5), periodEnd: addDaysKey(TODAY, -1), spend: "840", impressions: 100, clicks: 1, leads: 0, conversionValue: "" }), admin.id);
    await syncReminders(db);
    expect(await db.reminder.count({ where: { type: "AD_BUDGET_ALERT" } })).toBe(0);
    await saveSpendEntry(db, null, spendEntrySchema.parse({ campaignId: camp.id, periodStart: addDaysKey(TODAY, -8), periodEnd: addDaysKey(TODAY, -6), spend: "10", impressions: 100, clicks: 1, leads: 0, conversionValue: "" }), admin.id);
    await syncReminders(db);
    expect((await db.reminder.findFirstOrThrow({ where: { type: "AD_BUDGET_ALERT" } })).severity).toBe("WARNING");
  });

  it("drops reminders for archived tasks", async () => {
    const t = await task({ dueDate: addDaysKey(TODAY, -2) });
    await syncReminders(db);
    await setTaskArchived(db, t.id, true, admin.id);
    await syncReminders(db);
    expect((await reminder(`TASK_OVERDUE:${t.id}`))?.status).toBe("DONE");
  });
});

describe("who sees and changes what", () => {
  it("employees see only their own; managers see everything but money", async () => {
    const a = await person("a@example.com");
    const b = await person("b@example.com");
    await task({ assigneeId: a.id, dueDate: addDaysKey(TODAY, -1) });
    await task({ assigneeId: b.id, dueDate: addDaysKey(TODAY, -1) });
    await db.reminder.create({ data: { type: "PAYMENT_OVERDUE", title: "Owes", dedupeKey: "PAYMENT_OVERDUE:x", entityType: "Invoice", entityId: "x" } });
    await syncReminders(db);
    await db.reminder.upsert({ where: { dedupeKey: "PAYMENT_OVERDUE:x" }, update: { status: "OPEN" }, create: { type: "PAYMENT_OVERDUE", title: "Owes", dedupeKey: "PAYMENT_OVERDUE:x", entityType: "Invoice", entityId: "x" } });
    const seen = (v: Viewer) => db.reminder.count({ where: { status: "OPEN", ...reminderScope(v) } });
    expect(await seen(a)).toBe(1);
    expect(await seen({ id: "m", role: "MANAGER", departmentId: null })).toBe(2);
    expect(await seen(admin)).toBe(3);
    expect(await reminderAttentionCount(db, a)).toBe(1);
  });

  it("an employee can't touch someone else's reminder, stored or not", async () => {
    const a = await person("a@example.com");
    const b = await person("b@example.com");
    const theirs = await task({ assigneeId: b.id, dueDate: addDaysKey(TODAY, -1) });
    const key = `TASK_OVERDUE:${theirs.id}`;
    await expect(setReminderState(db, action(key, theirs), a)).rejects.toThrow(/isn't available/);
    await syncReminders(db);
    await expect(setReminderState(db, action(key, theirs), a)).rejects.toThrow(/isn't available/);
    expect((await reminder(key))?.status).toBe("OPEN");
    await setReminderState(db, action(key, theirs), b);
    expect((await reminder(key))?.status).toBe("DONE");
  });

  it("a manager can't act on money reminders", async () => {
    const m: Viewer = { id: admin.id, role: "MANAGER", departmentId: null };
    await expect(setReminderState(db, { key: "PAYMENT_OVERDUE:x", type: "PAYMENT_OVERDUE", title: "x", entityType: "Invoice", entityId: "x", action: "done" }, m)).rejects.toThrow(/isn't available/);
    expect(await reminder("PAYMENT_OVERDUE:x")).toBeNull();
  });

  it("restoring snoozed reminders only touches your own", async () => {
    const a = await person("a@example.com");
    const b = await person("b@example.com");
    const mine = await task({ assigneeId: a.id, dueDate: addDaysKey(TODAY, -1) });
    const theirs = await task({ assigneeId: b.id, dueDate: addDaysKey(TODAY, -1) });
    await syncReminders(db);
    await setReminderState(db, action(`TASK_OVERDUE:${mine.id}`, mine, { action: "snooze", days: 5 }), a);
    await setReminderState(db, action(`TASK_OVERDUE:${theirs.id}`, theirs, { action: "snooze", days: 5 }), b);
    expect(await restoreSnoozed(db, a)).toBe(1);
    expect((await reminder(`TASK_OVERDUE:${mine.id}`))?.status).toBe("OPEN");
    expect((await reminder(`TASK_OVERDUE:${theirs.id}`))?.status).toBe("SNOOZED");
  });
});

describe("daily digests", () => {
  it("waits for the digest time", async () => {
    const { sent, send } = mailer();
    expect((await runDigests(db, send, at("08:59"))).skipped).toBe("not yet");
    expect(sent).toHaveLength(0);
    await runDigests(db, send, at("09:00"));
    expect(sent.map((m) => m.to)).toEqual(["phase6-tester@example.com"]);
  });

  it("goes once a day, even if the job runs twice at the same moment", async () => {
    await task({ dueDate: addDaysKey(TODAY, -1) });
    await syncReminders(db);
    const { sent, send } = mailer();
    await Promise.all([runDigests(db, send, at("09:05")), runDigests(db, send, at("09:05")), runDigests(db, send, at("09:05"))]);
    await runDigests(db, send, at("17:00"));
    expect(sent).toHaveLength(1);
  });

  it("can be switched off", async () => {
    await db.settings.update({ where: { id: "agency" }, data: { digestEnabled: false } });
    const { sent, send } = mailer();
    expect((await runDigests(db, send, at("10:00"))).skipped).toBe("off");
    expect(sent).toHaveLength(0);
    await db.settings.update({ where: { id: "agency" }, data: { digestEnabled: true } });
  });

  it("tries again after a failed send", async () => {
    const attempts: string[] = [];
    await runDigests(db, async (m) => { attempts.push(m.to); return { ok: false, error: "SMTP down" }; }, at("09:00"));
    expect(await db.digestRun.count()).toBe(0);
    const { sent, send } = mailer();
    await runDigests(db, send, at("10:00"));
    expect(attempts).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it("leaves out snoozed and done reminders, and lists the rest with the summary", async () => {
    const shown = await task({ title: "Shown task", dueDate: addDaysKey(TODAY, -1) });
    const snoozed = await task({ title: "Snoozed task", dueDate: addDaysKey(TODAY, -1) });
    const done = await task({ title: "Done task", dueDate: addDaysKey(TODAY, -1) });
    await syncReminders(db);
    await setReminderState(db, action(`TASK_OVERDUE:${snoozed.id}`, snoozed, { action: "snooze", days: 2 }), admin);
    await setReminderState(db, action(`TASK_OVERDUE:${done.id}`, done), admin);
    const { sent, send } = mailer();
    await runDigests(db, send, at("09:00"));
    expect(sent[0].text).toContain(shown.title);
    expect(sent[0].text).not.toContain("Snoozed task");
    expect(sent[0].text).not.toContain("Done task");
    expect(sent[0].subject).toContain("1 needs attention");
    expect(sent[0].text).toContain("Good morning Boss");
  });

  it("says all clear when nothing's open", async () => {
    const { sent, send } = mailer();
    await runDigests(db, send, at("09:00"));
    expect(sent[0].subject).toContain("All clear");
    expect(sent[0].text).toContain("Nothing needs your attention");
  });

  it("employees who opted in get only their own tasks, and nothing if nothing's due", async () => {
    const yes = await person("yes@example.com", { dailyDigest: true });
    const idle = await person("idle@example.com", { dailyDigest: true });
    const no = await person("no@example.com");
    await task({ title: "Yes task", assigneeId: yes.id, dueDate: addDaysKey(TODAY, -1) });
    await task({ title: "No task", assigneeId: no.id, dueDate: addDaysKey(TODAY, -1) });
    await syncReminders(db);
    expect(idle.id).toBeTruthy();
    const { sent, send } = mailer();
    await runDigests(db, send, at("09:00"));
    const toEmployees = sent.filter((m) => m.to !== "phase6-tester@example.com");
    expect(toEmployees.map((m) => m.to)).toEqual(["yes@example.com"]);
    expect(toEmployees[0].text).toContain("Yes task");
    expect(toEmployees[0].text).not.toContain("No task");
    expect(toEmployees[0].subject).toContain("1 overdue");
  });

  it("an on-request digest doesn't use up the day's digest", async () => {
    const { sent, send } = mailer();
    await sendDigestNow(db, send, { id: admin.id, name: "Boss", email: "phase6-tester@example.com" }, at("08:00"));
    expect(sent).toHaveLength(1);
    expect(await db.digestRun.count()).toBe(0);
    await runDigests(db, send, at("09:00"));
    expect(sent).toHaveLength(2);
  });

  it("an edited template is what goes out", async () => {
    await saveTemplate(db, { key: "daily_digest", subject: "My digest {{date}}", body: "Hi {{name}}\n{{sections}}", whatsapp: null }, admin.id);
    const { sent, send } = mailer();
    await runDigests(db, send, at("09:00"));
    expect(sent[0].subject).toMatch(/^My digest /);
    expect(sent[0].text).toMatch(/^Hi Boss/);
  });
});

describe("emails for task notifications", () => {
  it("go only to people who chose them, once, when assigned or mentioned", async () => {
    const wants = await person("wants@example.com", { emailOnTask: true });
    const not = await person("not@example.com");
    const t = await task({ title: "Fix the logo", assigneeId: wants.id });
    await task({ assigneeId: not.id });
    const { sent, send } = mailer();
    await Promise.all([sendNotificationEmails(db, send), sendNotificationEmails(db, send)]);
    expect(sent.map((m) => m.to)).toEqual(["wants@example.com"]);
    expect(sent[0].text).toContain("Fix the logo");
    await sendNotificationEmails(db, send);
    expect(sent).toHaveLength(1);
    expect(await db.notification.count({ where: { userId: not.id } })).toBe(1);

    await addComment(db, { taskId: t.id, body: "@wants please look", viewer: admin });
    await sendNotificationEmails(db, send);
    expect(sent).toHaveLength(2);
    expect(sent[1].subject).toContain("mentioned");
  });

  it("cover reassignment and bulk changes, but not status notices", async () => {
    const wants = await person("wants@example.com", { emailOnTask: true });
    const t = await task();
    const u = await task();
    await updateTask(db, t.id, taskInput({ assigneeId: wants.id }), admin.id);
    await bulkUpdateTasks(db, { taskIds: [u.id], assigneeId: wants.id }, admin.id);
    const { sent, send } = mailer();
    await sendNotificationEmails(db, send);
    expect(sent).toHaveLength(2);
  });

  it("don't send a backlog of old notifications", async () => {
    const wants = await person("wants@example.com", { emailOnTask: true });
    await task({ assigneeId: wants.id });
    await db.notification.updateMany({ data: { createdAt: new Date(Date.now() - 2 * 86_400_000) } });
    const { sent, send } = mailer();
    await sendNotificationEmails(db, send);
    expect(sent).toHaveLength(0);
  });
});

describe("email templates", () => {
  it("uses the starting text until edited, and Reset brings it back", async () => {
    const original = await getTemplate(db, "offer_send");
    expect(original.subject).toContain("{{offerNumber}}");
    await saveTemplate(db, { key: "offer_send", subject: "New {{offerNumber}}", body: "Body", whatsapp: "W" }, admin.id);
    expect((await getTemplate(db, "offer_send")).subject).toBe("New {{offerNumber}}");
    await resetTemplate(db, "offer_send", admin.id);
    expect((await getTemplate(db, "offer_send")).subject).toBe(original.subject);
  });

  it("refuses a placeholder it can't fill, and unknown templates", async () => {
    await expect(saveTemplate(db, { key: "offer_send", subject: "Hi {{ofrNumber}}", body: "Body", whatsapp: null }, admin.id)).rejects.toThrow(/ofrNumber/);
    await expect(saveTemplate(db, { key: "nope", subject: "Hi", body: "Body", whatsapp: null }, admin.id)).rejects.toThrow(/no longer exists/);
  });

  it("doesn't store WhatsApp text on a template that has none", async () => {
    await saveTemplate(db, { key: "daily_digest", subject: "S", body: "B", whatsapp: "Sneaked in" }, admin.id);
    expect((await getTemplate(db, "daily_digest")).whatsapp).toBeNull();
  });
});
