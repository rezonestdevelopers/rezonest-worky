import "server-only";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { db } from "@/lib/db";
import { putFile, removeFile } from "@/lib/storage";
import { runBackup } from "@/server/services/backups";

const run = promisify(execFile);

/** Runs pg_dump. The password goes through the environment, so it never appears in a process list or an error. */
async function dumpDatabase(): Promise<Buffer> {
  const url = new URL(process.env.DATABASE_URL ?? "");
  const file = path.join(os.tmpdir(), `rezonest-${crypto.randomUUID()}.dump`);
  try {
    await run(
      process.env.PG_DUMP_PATH || "pg_dump",
      ["--format=custom", "--no-owner", "--host", url.hostname, "--port", url.port || "5432", "--username", decodeURIComponent(url.username), "--dbname", url.pathname.slice(1), "--file", file],
      { env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) }, timeout: 10 * 60_000, windowsHide: true },
    );
    return await fs.readFile(file);
  } catch (e) {
    const missing = (e as NodeJS.ErrnoException).code === "ENOENT";
    throw new Error(missing ? "pg_dump wasn't found. Set PG_DUMP_PATH in .env to where it's installed." : `pg_dump failed: ${e instanceof Error ? e.message.replace(url.password, "***") : e}`);
  } finally {
    await fs.rm(file, { force: true });
  }
}

export const runBackupJob = () =>
  runBackup(db, { dump: dumpDatabase, put: (key, body) => putFile(key, body, "application/octet-stream"), remove: removeFile });

let lastTry = 0;
/**
 * For a PC with no scheduled jobs: pages call this after responding, and it tries at most hourly.
 * Off unless BACKUP_AUTO="true", so copies made for testing don't run backups of their own.
 */
export async function runBackupIfDue() {
  if (process.env.BACKUP_AUTO !== "true" || Date.now() - lastTry < 60 * 60_000) return;
  lastTry = Date.now();
  await runBackupJob().catch((e) => console.error("Backup job failed", e));
}
