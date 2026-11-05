import "server-only";
import { db } from "@/lib/db";
import { sendMail } from "@/lib/mailer";
import { runDigests, sendNotificationEmails } from "@/server/services/digest";
import { syncReminders } from "@/server/services/reminders";

/** The whole reminder job: bring reminders up to date, then send what's due. Safe to run any number of times. */
export async function runReminderJob() {
  const reminders = await syncReminders(db);
  const digests = await runDigests(db, sendMail);
  const notifications = await sendNotificationEmails(db, sendMail);
  return { reminders, digests, notifications };
}

let lastRun = 0;
/** Keeps things current between scheduled runs. Pages call it after responding, at most every 10 minutes. */
export async function runReminderJobIfStale() {
  if (Date.now() - lastRun < 10 * 60_000) return;
  lastRun = Date.now();
  await runReminderJob().catch((e) => {
    lastRun = 0;
    console.error("Reminder job failed", e);
  });
}

/** Sent straight after a save, so an assignment email doesn't wait for the next run. */
export async function sendWaitingNotificationEmails() {
  await sendNotificationEmails(db, sendMail).catch((e) => console.error("Notification emails failed", e));
}
