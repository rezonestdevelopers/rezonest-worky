import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { addDaysKey, todayKey } from "@/lib/dates";
import type { Db } from "./shared";

export const BACKUP_KEEP_DAYS = 30;
const STUCK_AFTER_MS = 30 * 60_000;

export type BackupTools = {
  /** Makes the backup file and returns it. */
  dump: () => Promise<Buffer>;
  put: (key: string, body: Buffer) => Promise<void>;
  remove: (key: string) => Promise<void>;
};

/** Marks today's backup as started. False if it's already done, or running right now. */
async function claimDay(db: Db, day: string, now: Date) {
  try {
    await db.backupRun.create({ data: { day, status: "RUNNING" } });
    return true;
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") throw e;
  }
  const { count } = await db.backupRun.updateMany({
    where: { day, OR: [{ status: "FAILED" }, { status: "RUNNING", updatedAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) } }] },
    data: { status: "RUNNING", error: null },
  });
  return count > 0;
}

/**
 * One backup a day, however often this runs. A failure is recorded, you're told, and the next run tries
 * again. Old copies are only removed after today's has succeeded, so a run of failures can't eat your backups.
 */
export async function runBackup(db: Db, tools: BackupTools, today = todayKey(), now = new Date()) {
  if (!(await claimDay(db, today, now))) return { status: "skipped" as const };
  try {
    const body = await tools.dump();
    if (!body.length) throw new Error("The backup file came out empty.");
    // A random name, so the file can't be guessed.
    const storageKey = `private/backups/${today}-${crypto.randomBytes(12).toString("hex")}.dump`;
    await tools.put(storageKey, body);
    await db.backupRun.update({ where: { day: today }, data: { status: "DONE", storageKey, sizeBytes: body.length, error: null } });
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await db.backupRun.update({ where: { day: today }, data: { status: "FAILED", error } });
    const admins = await db.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
    await db.notification.createMany({ data: admins.map((a) => ({ userId: a.id, title: "Today's backup failed", body: "It will try again. See Settings → Backups.", href: "/settings/backups" })) });
    return { status: "failed" as const, error };
  }
  const removed = await pruneBackups(db, tools, today);
  return { status: "done" as const, removed };
}

/** Removes files older than the keep period. The record stays, marked as removed. */
export async function pruneBackups(db: Db, tools: Pick<BackupTools, "remove">, today = todayKey()) {
  const oldest = addDaysKey(today, -(BACKUP_KEEP_DAYS - 1));
  const old = await db.backupRun.findMany({ where: { day: { lt: oldest }, status: "DONE", deletedAt: null, storageKey: { not: null } } });
  let removed = 0;
  for (const run of old) {
    await tools.remove(run.storageKey!);
    await db.backupRun.update({ where: { id: run.id }, data: { deletedAt: new Date() } });
    removed++;
  }
  return removed;
}

export const listBackups = (db: Db) => db.backupRun.findMany({ orderBy: { day: "desc" }, take: 60 });
