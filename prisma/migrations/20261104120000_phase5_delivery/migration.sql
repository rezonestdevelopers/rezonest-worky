-- AlterTable
ALTER TABLE "AdSpendEntry" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ContentCalendarItem" ADD COLUMN     "creativeUrl" TEXT;

-- Backfill: retainer deliverables created before the calendar existed get their calendar item
INSERT INTO "ContentCalendarItem" ("id", "clientId", "projectId", "deliverableId", "platforms", "format", "topic", "publishDate", "month", "updatedAt")
SELECT 'backfill_' || d."id", p."clientId", d."projectId", d."id", '{}', d."format", d."title", d."dueDate", d."month", CURRENT_TIMESTAMP
FROM "Deliverable" d
JOIN "Project" p ON p."id" = d."projectId"
LEFT JOIN "ContentCalendarItem" c ON c."deliverableId" = d."id"
WHERE c."id" IS NULL AND d."format" IS NOT NULL AND d."month" IS NOT NULL;
