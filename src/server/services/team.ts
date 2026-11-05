import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { keyToDate } from "@/lib/dates";
import type { EmployeeData } from "@/lib/validators/work";
import { BusinessError, logActivity, type Db, type Tx } from "./shared";

function profile(d: EmployeeData) {
  return { phone: d.phone, departmentId: d.departmentId, designation: d.designation, joiningDate: d.joiningDate ? keyToDate(d.joiningDate) : null, hourlyCost: d.hourlyCost, dailyDigest: d.dailyDigest, emailOnTask: d.emailOnTask };
}

/** A single-use link to choose a password. Only its hash is stored. */
export async function issuePasswordLink(tx: Db | Tx, userId: string, hoursValid: number): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  await tx.passwordResetToken.create({
    data: { userId, tokenHash: crypto.createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + hoursValid * 3_600_000) },
  });
  return token;
}

/** New people get a link to set their own password. Nobody, including you, ever sees it. */
export async function createEmployee(db: Db, data: EmployeeData, actorId: string) {
  return db.$transaction(async (tx) => {
    const exists = await tx.user.findUnique({ where: { email: data.email } });
    if (exists) throw new BusinessError("Someone with this email already exists.");
    const user = await tx.user.create({
      data: {
        name: data.name,
        email: data.email,
        role: data.role,
        passwordHash: await bcrypt.hash(crypto.randomBytes(32).toString("base64url"), 10),
        employee: { create: profile(data) },
      },
    });
    const token = await issuePasswordLink(tx, user.id, 72);
    await logActivity(tx, { actorId, action: "team.member_added", entityType: "User", entityId: user.id, changes: { name: data.name, role: data.role } });
    return { user, token };
  });
}

async function adminsLeft(tx: Tx, excludingId: string) {
  return tx.user.count({ where: { role: "ADMIN", isActive: true, id: { not: excludingId } } });
}

export async function updateEmployee(db: Db, id: string, data: EmployeeData, actorId: string) {
  await db.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id }, include: { employee: true } });
    if (!before) throw new BusinessError("This person no longer exists.");
    if (before.role === "ADMIN" && data.role !== "ADMIN" && (await adminsLeft(tx, id)) === 0) throw new BusinessError("This is the only admin, so their role can't be changed.");
    if (id === actorId && data.role !== before.role) throw new BusinessError("You can't change your own role.");
    if (data.email !== before.email && (await tx.user.findUnique({ where: { email: data.email } }))) throw new BusinessError("Someone with this email already exists.");
    await tx.user.update({
      where: { id },
      data: { name: data.name, email: data.email, role: data.role, employee: { upsert: { create: profile(data), update: profile(data) } } },
    });
    await logActivity(tx, { actorId, action: "team.member_updated", entityType: "User", entityId: id, changes: { name: data.name, role: { from: before.role, to: data.role } } });
  });
}

/**
 * Deactivating keeps all history and stops them signing in on their next click. Open tasks must be
 * handed to someone, or back to the department queue; this is never done silently.
 */
export async function deactivateEmployee(db: Db, input: { userId: string; reassignTo: string | null; actorId: string }) {
  return db.$transaction(
    async (tx) => {
      const user = await tx.user.findUnique({ where: { id: input.userId } });
      if (!user) throw new BusinessError("This person no longer exists.");
      if (user.id === input.actorId) throw new BusinessError("You can't deactivate yourself.");
      if (!user.isActive) return 0;
      if (user.role === "ADMIN" && (await adminsLeft(tx, user.id)) === 0) throw new BusinessError("This is the only admin, so they can't be deactivated.");
      if (input.reassignTo) {
        if (input.reassignTo === user.id) throw new BusinessError("Choose someone else to take over the tasks.");
        const next = await tx.user.findUnique({ where: { id: input.reassignTo } });
        if (!next?.isActive) throw new BusinessError("That person is inactive, so they can't take over the tasks.");
      }
      const open = { assigneeId: user.id, archivedAt: null, status: { not: "DONE" as const } };
      const { count } = await tx.task.updateMany({ where: open, data: { assigneeId: input.reassignTo } });
      await tx.user.update({ where: { id: user.id }, data: { isActive: false } });
      await tx.passwordResetToken.deleteMany({ where: { userId: user.id } });
      if (input.reassignTo && count) {
        await tx.notification.create({ data: { userId: input.reassignTo, title: `${count} task${count === 1 ? "" : "s"} handed to you`, body: `From ${user.name}`, href: "/tasks?mine=1" } });
      }
      await logActivity(tx, { actorId: input.actorId, action: "team.member_deactivated", entityType: "User", entityId: user.id, changes: { name: user.name, tasksMoved: count, reassignTo: input.reassignTo } });
      return count;
    },
    { timeout: 30_000 },
  );
}

export async function reactivateEmployee(db: Db, userId: string, actorId: string) {
  await db.$transaction(async (tx) => {
    const user = await tx.user.update({ where: { id: userId }, data: { isActive: true, failedLoginCount: 0, lockedUntil: null } });
    await logActivity(tx, { actorId, action: "team.member_reactivated", entityType: "User", entityId: user.id, changes: { name: user.name } });
  });
}
