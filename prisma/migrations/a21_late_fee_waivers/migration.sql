-- "Waive late fee for this month": one row per tenant and rent month that
-- was waived (and, once taken back, the day it was). Additive: one new
-- table. Safe to run twice, per prisma/migrations/README.md.

CREATE TABLE IF NOT EXISTS "LateFeeWaiver" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "waivedById" TEXT,
    "waivedByName" TEXT NOT NULL DEFAULT '',
    "waivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "unwaivedAt" TIMESTAMP(3),
    "unwaivedById" TEXT,
    "unwaivedByName" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "LateFeeWaiver_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LateFeeWaiver_tenantId_month_key" ON "LateFeeWaiver"("tenantId", "month");

DO $$ BEGIN
    ALTER TABLE "LateFeeWaiver" ADD CONSTRAINT "LateFeeWaiver_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "LateFeeWaiver" ADD CONSTRAINT "LateFeeWaiver_waivedById_fkey" FOREIGN KEY ("waivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "LateFeeWaiver" ADD CONSTRAINT "LateFeeWaiver_unwaivedById_fkey" FOREIGN KEY ("unwaivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
