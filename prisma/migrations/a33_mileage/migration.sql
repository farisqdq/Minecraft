-- The mileage log (a33). Additive only: one new table. A trip is a drive to
-- a property for its business, deducted at the IRS standard mileage rate;
-- see lib/mileage.ts. Safe to run twice, per prisma/migrations/README.md.

CREATE TABLE IF NOT EXISTS "Trip" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "miles" DOUBLE PRECISION NOT NULL,
    "purpose" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Trip_propertyId_date_idx" ON "Trip"("propertyId", "date");

DO $$ BEGIN
    ALTER TABLE "Trip" ADD CONSTRAINT "Trip_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "Trip" ADD CONSTRAINT "Trip_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
