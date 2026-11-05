import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runBackupJob } from "@/server/backup-job";

/** Daily database backup; keeps 30 days. Running it twice in a day does nothing. Needs "Authorization: Bearer <CRON_SECRET>". */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runBackupJob();
  return NextResponse.json(result, { status: result.status === "failed" ? 500 : 200 });
}
