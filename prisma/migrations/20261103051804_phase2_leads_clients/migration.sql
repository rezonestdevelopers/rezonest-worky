-- DropIndex
DROP INDEX "Lead_convertedClientId_key";

-- AlterTable
ALTER TABLE "ClientContact" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "LeadStageHistory" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "fromStage" "LeadStage",
    "toStage" "LeadStage" NOT NULL,
    "note" TEXT,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadStageHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadStageHistory_leadId_idx" ON "LeadStageHistory"("leadId");

-- CreateIndex
CREATE INDEX "LeadStageHistory_toStage_createdAt_idx" ON "LeadStageHistory"("toStage", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_convertedClientId_idx" ON "Lead"("convertedClientId");

-- AddForeignKey
ALTER TABLE "LeadStageHistory" ADD CONSTRAINT "LeadStageHistory_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadStageHistory" ADD CONSTRAINT "LeadStageHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: give every existing lead a starting history row (its current stage, as of its last update)
INSERT INTO "LeadStageHistory" ("id", "leadId", "fromStage", "toStage", "note", "createdAt")
SELECT 'backfill_' || "id", "id", NULL, "stage", 'Stage when history tracking started', "updatedAt" FROM "Lead";
