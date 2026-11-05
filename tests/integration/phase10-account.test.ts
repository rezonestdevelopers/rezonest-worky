import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { addDaysKey, keyToDate, todayKey } from "@/lib/dates";
import { changePassword, myWeek, updateMyProfile, weekStart } from "@/server/services/account";

const db = new PrismaClient();
const TODAY = todayKey();
const OLD = "old-pass-1";
let userId: string;

beforeAll(async () => {
  const user = await db.user.upsert({ where: { email: "phase10-tester@example.com" }, update: {}, create: { name: "Tester", email: "phase10-tester@example.com", passwordHash: "x", role: "EMPLOYEE" } });
  userId = user.id;
});

beforeEach(async () => {
  await db.timeLog.deleteMany({ where: { userId } });
  await db.task.deleteMany({ where: { assigneeId: userId } });
  await db.passwordResetToken.deleteMany({ where: { userId } });
  await db.employeeProfile.deleteMany({ where: { userId } });
  await db.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(OLD, 4), isActive: true, name: "Tester", failedLoginCount: 3 } });
});

afterAll(async () => {
  await db.timeLog.deleteMany({ where: { userId } });
  await db.task.deleteMany({ where: { assigneeId: userId } });
  await db.$disconnect();
});

describe("changing your own password", () => {
  it("works with the right current password, and stores only a hash", async () => {
    await changePassword(db, { userId, current: OLD, next: "new-pass-1" });
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.passwordHash).not.toContain("new-pass-1");
    expect(await bcrypt.compare("new-pass-1", user.passwordHash)).toBe(true);
    expect(await bcrypt.compare(OLD, user.passwordHash)).toBe(false);
    expect(user.failedLoginCount).toBe(0);
    const log = await db.activityLog.findFirstOrThrow({ where: { entityId: userId, action: "account.password_changed" } });
    expect(JSON.stringify(log.changes ?? {})).not.toContain("pass");
  });
  it("refuses the wrong current password, and changes nothing", async () => {
    await expect(changePassword(db, { userId, current: "wrong-pass-1", next: "new-pass-1" })).rejects.toThrow(/isn't right/);
    expect(await bcrypt.compare(OLD, (await db.user.findUniqueOrThrow({ where: { id: userId } })).passwordHash)).toBe(true);
  });
  it("stops any reset link already sent", async () => {
    await db.passwordResetToken.create({ data: { userId, tokenHash: `hash-${Math.random()}`, expiresAt: new Date(Date.now() + 3_600_000) } });
    await changePassword(db, { userId, current: OLD, next: "new-pass-1" });
    expect(await db.passwordResetToken.count({ where: { userId } })).toBe(0);
  });
  it("a deactivated account can't", async () => {
    await db.user.update({ where: { id: userId }, data: { isActive: false } });
    await expect(changePassword(db, { userId, current: OLD, next: "new-pass-1" })).rejects.toThrow(/no longer exists/);
  });
});

describe("my details", () => {
  it("saves my name, phone and email choices, even with no profile yet", async () => {
    await updateMyProfile(db, userId, { name: "New Name", phone: "9876543210", dailyDigest: true, emailOnTask: true });
    const user = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { employee: true } });
    expect([user.name, user.employee?.phone, user.employee?.dailyDigest, user.employee?.emailOnTask]).toEqual(["New Name", "9876543210", true, true]);
    expect(user.role).toBe("EMPLOYEE");
  });
  it("leaves hourly cost and department alone", async () => {
    await db.employeeProfile.create({ data: { userId, hourlyCost: "500", designation: "Designer" } });
    await updateMyProfile(db, userId, { name: "Tester", phone: null, dailyDigest: false, emailOnTask: false });
    const p = await db.employeeProfile.findUniqueOrThrow({ where: { userId } });
    expect([p.hourlyCost?.toString(), p.designation]).toEqual(["500", "Designer"]);
  });
});

describe("my week", () => {
  it("weeks start on Monday", () => {
    expect(weekStart("2026-11-05")).toBe("2026-11-02"); // Thursday
    expect(weekStart("2026-11-02")).toBe("2026-11-02"); // Monday
    expect(weekStart("2026-11-08")).toBe("2026-11-02"); // Sunday
  });
  it("adds this week's time, leaving out last week's and other people's", async () => {
    const task = await db.task.create({ data: { title: "Mine", assigneeId: userId } });
    await db.timeLog.create({ data: { taskId: task.id, userId, date: keyToDate(TODAY), minutes: 90 } });
    await db.timeLog.create({ data: { taskId: task.id, userId, date: keyToDate(addDaysKey(weekStart(TODAY), -1)), minutes: 500 } });
    expect((await myWeek(db, userId, TODAY)).minutesThisWeek).toBe(90);
  });
  it("on-time share is only my finished tasks with a due date", async () => {
    const start = new Date(`${TODAY.slice(0, 7)}-01T12:00:00+05:30`);
    const later = new Date(start.getTime() + 2 * 86_400_000);
    const due = keyToDate(`${TODAY.slice(0, 7)}-01`);
    await db.task.create({ data: { title: "On time", assigneeId: userId, status: "DONE", dueDate: due, completedAt: start } });
    await db.task.create({ data: { title: "Late", assigneeId: userId, status: "DONE", dueDate: due, completedAt: later } });
    await db.task.create({ data: { title: "No date", assigneeId: userId, status: "DONE", completedAt: start } });
    await db.task.create({ data: { title: "Not done", assigneeId: userId, status: "TODO", dueDate: due } });
    const w = await myWeek(db, userId, TODAY);
    expect([w.finishedThisMonth, w.onTimePercent]).toEqual([3, 50]);
  });
  it("shows no percentage with nothing finished", async () => {
    expect((await myWeek(db, userId, TODAY)).onTimePercent).toBeNull();
  });
});
