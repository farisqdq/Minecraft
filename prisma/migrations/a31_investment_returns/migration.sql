-- Investment returns (a31). Additive only: three nullable columns on
-- "Property" — what was paid, when, and how much of the owner's own cash went
-- in — and a new table of what the place has been worth since. Every
-- existing row is unchanged (the columns start null, meaning "not entered").
-- Safe to run twice, per prisma/migrations/README.md.

ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "purchasePrice" DOUBLE PRECISION;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "purchasedOn" TIMESTAMP(3);
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "cashInvested" DOUBLE PRECISION;

CREATE TABLE IF NOT EXISTS "PropertyValuation" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "source" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertyValuation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PropertyValuation_propertyId_idx" ON "PropertyValuation"("propertyId");

DO $$ BEGIN
    ALTER TABLE "PropertyValuation" ADD CONSTRAINT "PropertyValuation_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "PropertyValuation" ADD CONSTRAINT "PropertyValuation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
