-- Phase 8: a mistaken communication entry is archived, not deleted.
ALTER TABLE "CommunicationLog" ADD COLUMN "archivedAt" TIMESTAMP(3);
