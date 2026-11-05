import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runReminderJob } from "@/server/reminder-jobs";

/** Reminder job. Call it hourly: the digest goes on the first run after the digest time. Needs "Authorization: Bearer <CRON_SECRET>". */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await runReminderJob());
}
