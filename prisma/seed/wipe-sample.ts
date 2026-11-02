import { PrismaClient } from "@prisma/client";
import readline from "node:readline/promises";

/**
 * Removes ALL business data (sample clients, leads, offers, projects, tasks,
 * invoices, payments, expenses…) and all non-admin users, and resets document
 * numbering. KEEPS: settings, departments, sectors, lead sources, services,
 * task templates, email templates and admin users.
 *
 * Use ONCE before going live. Asks for confirmation (or pass --yes).
 */
const db = new PrismaClient();

async function main() {
  if (!process.argv.includes("--yes")) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      "This deletes ALL clients, leads, offers, projects, tasks, invoices and payments. Type WIPE to continue: ",
    );
    rl.close();
    if (answer.trim() !== "WIPE") {
      console.log("Cancelled. Nothing was deleted.");
      return;
    }
  }

  // Order matters (foreign keys). One transaction: all or nothing.
  await db.$transaction([
    db.activityLog.deleteMany(),
    db.notification.deleteMany(),
    db.reminder.deleteMany(),
    db.emailLog.deleteMany(),
    db.paymentAllocation.deleteMany(),
    db.payment.deleteMany(),
    db.creditNote.deleteMany(),
    db.changeRequest.deleteMany(),
    db.invoiceItem.deleteMany(),
    db.invoice.updateMany({ data: { convertedFromId: null } }),
    db.invoice.deleteMany(),
    db.expense.deleteMany(),
    db.document.deleteMany(),
    db.communicationLog.deleteMany(),
    db.contentApproval.deleteMany(),
    db.contentCalendarItem.deleteMany(),
    db.adSpendEntry.deleteMany(),
    db.adCampaign.deleteMany(),
    db.domainHostingAsset.deleteMany(),
    db.timeLog.deleteMany(),
    db.taskComment.deleteMany(),
    db.taskChecklistItem.deleteMany(),
    db.task.deleteMany(),
    db.deliverable.deleteMany(),
    db.retainerRun.deleteMany(),
    db.targetProgress.deleteMany(),
    db.target.deleteMany(),
    db.milestone.deleteMany(),
    db.projectService.deleteMany(),
    db.onboardingItem.deleteMany(),
    db.onboardingChecklist.deleteMany(),
    db.project.deleteMany(),
    db.publicLink.deleteMany(),
    db.offerStatusHistory.deleteMany(),
    db.offerVersion.deleteMany(),
    db.offerMilestone.deleteMany(),
    db.offerItem.deleteMany(),
    db.offer.deleteMany(),
    db.lead.deleteMany(),
    db.clientContact.deleteMany(),
    db.client.deleteMany(),
    db.numberSequence.deleteMany(),
    db.employeeProfile.deleteMany({ where: { user: { role: { not: "ADMIN" } } } }),
    db.passwordResetToken.deleteMany({ where: { user: { role: { not: "ADMIN" } } } }),
    db.user.deleteMany({ where: { role: { not: "ADMIN" } } }),
  ]);
  console.log("✓ Sample data removed. Settings, master data and admin login kept.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
