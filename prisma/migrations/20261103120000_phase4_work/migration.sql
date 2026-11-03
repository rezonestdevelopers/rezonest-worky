-- AlterTable
ALTER TABLE "OnboardingChecklist" ADD COLUMN     "offerId" TEXT;

-- AlterTable
ALTER TABLE "ProjectService" ADD COLUMN     "subServiceId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingChecklist_offerId_key" ON "OnboardingChecklist"("offerId");

-- AddForeignKey
ALTER TABLE "OnboardingChecklist" ADD CONSTRAINT "OnboardingChecklist_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectService" ADD CONSTRAINT "ProjectService_subServiceId_fkey" FOREIGN KEY ("subServiceId") REFERENCES "SubService"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: retainer months that already have deliverables or tasks count as generated, so the monthly job never doubles them
INSERT INTO "RetainerRun" ("id", "projectId", "month")
SELECT 'backfill_' || "projectId" || '_' || "month", "projectId", "month"
FROM (
  SELECT "projectId", "month" FROM "Deliverable" WHERE "month" IS NOT NULL
  UNION
  SELECT t."projectId", to_char(t."dueDate", 'YYYY-MM')
  FROM "Task" t JOIN "Project" p ON p."id" = t."projectId"
  WHERE p."isRetainer" AND t."dueDate" IS NOT NULL
) d
ON CONFLICT DO NOTHING;
