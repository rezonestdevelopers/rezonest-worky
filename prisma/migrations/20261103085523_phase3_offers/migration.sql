-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "acceptedVersion" INTEGER,
ADD COLUMN     "supplyStateCode" TEXT,
ADD COLUMN     "taxMode" "TaxMode" NOT NULL DEFAULT 'INTRA_STATE';

-- Backfill: existing offers to clients get the tax treatment their totals were worked out with
UPDATE "Offer" o SET
  "taxMode" = (CASE WHEN c."country" <> 'India' THEN 'EXPORT' WHEN c."stateCode" <> s."stateCode" THEN 'INTER_STATE' ELSE 'INTRA_STATE' END)::"TaxMode",
  "supplyStateCode" = c."stateCode"
FROM "Client" c, "Settings" s
WHERE o."clientId" = c."id" AND s."id" = 'agency';
UPDATE "Offer" SET "acceptedVersion" = "currentVersion" WHERE "status" = 'ACCEPTED';
