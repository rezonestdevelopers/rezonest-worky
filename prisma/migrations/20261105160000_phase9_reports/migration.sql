-- Phase 9: words you add to a client's monthly report, and a record of each daily backup.
CREATE TABLE "ClientReportNote" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "highlights" TEXT,
    "nextPlan" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientReportNote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientReportNote_clientId_month_key" ON "ClientReportNote"("clientId", "month");

ALTER TABLE "ClientReportNote" ADD CONSTRAINT "ClientReportNote_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BackupRun" (
    "id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "storageKey" TEXT,
    "sizeBytes" INTEGER,
    "error" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackupRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BackupRun_day_key" ON "BackupRun"("day");
