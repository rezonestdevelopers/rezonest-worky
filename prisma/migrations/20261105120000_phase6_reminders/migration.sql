-- AlterTable
ALTER TABLE "EmployeeProfile" ADD COLUMN     "emailOnTask" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "emailedAt" TIMESTAMP(3),
ADD COLUMN     "wantsEmail" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Reminder" ADD COLUMN     "doneManually" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "DigestRun" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DigestRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_wantsEmail_emailedAt_idx" ON "Notification"("wantsEmail", "emailedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DigestRun_date_userId_key" ON "DigestRun"("date", "userId");

-- Backfill: anything already marked done was marked by a person, so it stays done
UPDATE "Reminder" SET "doneManually" = true WHERE "status" = 'DONE';
