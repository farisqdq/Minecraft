-- Lease renewals (a25). Additive only: two nullable columns on RentChange
-- and a new table. Existing rent history is untouched — every existing row
-- reads as neither scheduled nor applied, which is what it is: a change
-- recorded in the month it took effect. Safe to run twice, per
-- prisma/migrations/README.md.

-- A raise agreed ahead of time is written into the rent history from the
-- month it starts. scheduledAt marks such a row; appliedAt is set once the
-- place's current rent has been moved to it.
ALTER TABLE "RentChange" ADD COLUMN IF NOT EXISTS "scheduledAt" TIMESTAMP(3);
ALTER TABLE "RentChange" ADD COLUMN IF NOT EXISTS "appliedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "LeaseRenewal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "previousEnd" TIMESTAMP(3),
    "newEnd" TIMESTAMP(3) NOT NULL,
    "previousRent" DOUBLE PRECISION NOT NULL,
    "newRent" DOUBLE PRECISION NOT NULL,
    "rentFrom" TEXT NOT NULL,
    "rentChangeId" TEXT,
    "note" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaseRenewal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "LeaseRenewal_tenantId_idx" ON "LeaseRenewal"("tenantId");
CREATE INDEX IF NOT EXISTS "LeaseRenewal_rentChangeId_idx" ON "LeaseRenewal"("rentChangeId");

DO $$ BEGIN
    ALTER TABLE "LeaseRenewal" ADD CONSTRAINT "LeaseRenewal_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "LeaseRenewal" ADD CONSTRAINT "LeaseRenewal_rentChangeId_fkey" FOREIGN KEY ("rentChangeId") REFERENCES "RentChange"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "LeaseRenewal" ADD CONSTRAINT "LeaseRenewal_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
