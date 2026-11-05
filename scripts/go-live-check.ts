/**
 * Run before going live: pnpm go-live-check
 * Only reads. Prints what's still needed, and fails if anything must be fixed first.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { todayKey } from "../src/lib/dates";
import { goLiveProblems } from "../src/lib/go-live";

try {
  process.loadEnvFile?.(".env");
} catch {
  // No .env file: the real environment is used.
}

const SAMPLE_PASSWORDS = [process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe@123", "Employee@123"];
const SAMPLE_CLIENT = "Pristine Heights Realty LLP";

async function main() {
  const db = new PrismaClient();
  try {
    const [settings, users, sample, missingSac, backup] = await Promise.all([
      db.settings.findUnique({ where: { id: "agency" } }),
      db.user.findMany({ where: { isActive: true }, select: { email: true, passwordHash: true } }),
      db.client.count({ where: { companyName: SAMPLE_CLIENT } }),
      db.service.count({ where: { isActive: true, OR: [{ sacCode: null }, { sacCode: "" }] } }),
      db.backupRun.findFirst({ where: { status: "DONE", deletedAt: null }, orderBy: { day: "desc" }, select: { day: true } }),
    ]);
    const defaultPasswordUsers: string[] = [];
    for (const u of users) {
      for (const p of SAMPLE_PASSWORDS) {
        if (await bcrypt.compare(p, u.passwordHash)) {
          defaultPasswordUsers.push(u.email);
          break;
        }
      }
    }
    const items = goLiveProblems({
      authSecret: process.env.AUTH_SECRET,
      appUrl: process.env.APP_URL,
      cronSecret: process.env.CRON_SECRET,
      smtpHost: process.env.SMTP_HOST,
      storageDriver: process.env.STORAGE_DRIVER,
      defaultPasswordUsers,
      sampleDataPresent: sample > 0,
      gstin: settings?.gstin,
      bankAccount: settings?.bankAccountNumber,
      upiId: settings?.upiId,
      invoiceTerms: settings?.invoiceTerms,
      signatureKey: settings?.signatureKey,
      servicesMissingSac: missingSac,
      lastBackupDay: backup?.day,
      today: todayKey(),
    });
    const must = items.filter((i) => i.level === "must");
    const should = items.filter((i) => i.level === "should");
    if (must.length) console.log(`\nFix these before going live (${must.length}):\n${must.map((i) => `  ✗ ${i.text}`).join("\n")}`);
    if (should.length) console.log(`\nWorth doing (${should.length}):\n${should.map((i) => `  • ${i.text}`).join("\n")}`);
    if (!items.length) console.log("\n✓ Everything checked is ready.");
    else if (!must.length) console.log("\n✓ Nothing is blocking going live.");
    process.exitCode = must.length ? 1 : 0;
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error("The check couldn't run:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
