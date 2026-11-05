import bcrypt from "bcryptjs";
import { addDaysKey, istDateKey, keyToDate, monthRange } from "@/lib/dates";
import { onTimeStats } from "@/lib/reports";
import { BusinessError, logActivity, type Db } from "./shared";

/** Anyone can change their own password, as long as they know the current one. */
export async function changePassword(db: Db, input: { userId: string; current: string; next: string }) {
  const user = await db.user.findUnique({ where: { id: input.userId } });
  if (!user || !user.isActive) throw new BusinessError("This account no longer exists.");
  if (!(await bcrypt.compare(input.current, user.passwordHash))) throw new BusinessError("Your current password isn't right.");
  const passwordHash = await bcrypt.hash(input.next, 12);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, failedLoginCount: 0, lockedUntil: null } });
    // Any reset link already emailed stops working.
    await tx.passwordResetToken.deleteMany({ where: { userId: user.id } });
    await logActivity(tx, { actorId: user.id, action: "account.password_changed", entityType: "User", entityId: user.id });
  });
}

/** What people can change about themselves. Their role, department and hourly cost stay with an admin. */
export async function updateMyProfile(db: Db, userId: string, input: { name: string; phone: string | null; dailyDigest: boolean; emailOnTask: boolean }) {
  await db.$transaction(async (tx) => {
    const user = await tx.user.update({ where: { id: userId }, data: { name: input.name } });
    const fields = { phone: input.phone, dailyDigest: input.dailyDigest, emailOnTask: input.emailOnTask };
    await tx.employeeProfile.upsert({ where: { userId }, update: fields, create: { userId, ...fields } });
    await logActivity(tx, { actorId: user.id, action: "account.profile_updated", entityType: "User", entityId: user.id });
  });
}

/** Monday of the week a day falls in. */
export function weekStart(today: string): string {
  const day = new Date(`${today}T00:00:00.000Z`).getUTCDay();
  return addDaysKey(today, -((day + 6) % 7));
}

/** The numbers on someone's own dashboard: their own work, and nothing about money or anyone else. */
export async function myWeek(db: Db, userId: string, today: string) {
  const month = monthRange(today);
  const [logs, done] = await Promise.all([
    db.timeLog.aggregate({ where: { userId, date: { gte: keyToDate(weekStart(today)), lte: keyToDate(today) } }, _sum: { minutes: true } }),
    db.task.findMany({
      where: { assigneeId: userId, archivedAt: null, status: "DONE", completedAt: { gte: new Date(`${month.start}T00:00:00+05:30`) } },
      select: { dueDate: true, completedAt: true },
    }),
  ]);
  const stats = onTimeStats(done.map((t) => ({ dueKey: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null, doneKey: t.completedAt ? istDateKey(t.completedAt) : null })));
  return { minutesThisWeek: logs._sum.minutes ?? 0, finishedThisMonth: done.length, onTimePercent: stats.percent };
}
