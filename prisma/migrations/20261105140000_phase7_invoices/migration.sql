-- Phase 7: credit notes keep their lines and round-off; each retainer month and renewal is drafted once.
ALTER TABLE "CreditNote" ADD COLUMN "roundOff" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "CreditNote" ADD COLUMN "lines" JSONB;

CREATE TABLE "InvoiceRun" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InvoiceRun_key_key" ON "InvoiceRun"("key");
