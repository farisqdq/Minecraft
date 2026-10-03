-- Listings and rental applications (a27). Additive only: two new tables.
-- A listing is a page for an empty place (/rent/<code>) with an application
-- form behind it; an application is someone who used it. Applications are
-- deliberately not in backups — a stranger's personal details don't belong
-- in a file that gets emailed around. Safe to run twice, per
-- prisma/migrations/README.md.

CREATE TABLE IF NOT EXISTS "Listing" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "unitId" TEXT,
    "code" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "description" TEXT,
    "rent" DOUBLE PRECISION NOT NULL,
    "deposit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "availableOn" TIMESTAMP(3),
    "beds" DOUBLE PRECISION,
    "baths" DOUBLE PRECISION,
    "sqft" INTEGER,
    "pets" TEXT,
    "photoIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "open" BOOLEAN NOT NULL DEFAULT true,
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RentalApplication" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "moveIn" TIMESTAMP(3),
    "occupants" INTEGER NOT NULL DEFAULT 1,
    "income" DOUBLE PRECISION,
    "employer" TEXT,
    "currentAddress" TEXT,
    "landlordName" TEXT,
    "landlordPhone" TEXT,
    "pets" TEXT,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "tenantId" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RentalApplication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Listing_code_key" ON "Listing"("code");

CREATE INDEX IF NOT EXISTS "Listing_companyId_idx" ON "Listing"("companyId");

CREATE INDEX IF NOT EXISTS "Listing_propertyId_idx" ON "Listing"("propertyId");

CREATE INDEX IF NOT EXISTS "RentalApplication_listingId_idx" ON "RentalApplication"("listingId");

CREATE INDEX IF NOT EXISTS "RentalApplication_tenantId_idx" ON "RentalApplication"("tenantId");

DO $$ BEGIN
    ALTER TABLE "Listing" ADD CONSTRAINT "Listing_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "Listing" ADD CONSTRAINT "Listing_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "Listing" ADD CONSTRAINT "Listing_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "Listing" ADD CONSTRAINT "Listing_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "RentalApplication" ADD CONSTRAINT "RentalApplication_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "RentalApplication" ADD CONSTRAINT "RentalApplication_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "RentalApplication" ADD CONSTRAINT "RentalApplication_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
