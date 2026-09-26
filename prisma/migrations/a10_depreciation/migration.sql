-- Depreciable assets: a property's building and its improvements.
-- Additive only: one new table. Safe to run twice, per
-- prisma/migrations/README.md.

-- CreateTable
CREATE TABLE IF NOT EXISTS "DepreciableAsset" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'building',
    "label" TEXT NOT NULL,
    "cls" TEXT NOT NULL DEFAULT 'residential',
    "basis" DOUBLE PRECISION NOT NULL,
    "inService" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DepreciableAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DepreciableAsset_propertyId_idx" ON "DepreciableAsset"("propertyId");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "DepreciableAsset" ADD CONSTRAINT "DepreciableAsset_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "DepreciableAsset" ADD CONSTRAINT "DepreciableAsset_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

