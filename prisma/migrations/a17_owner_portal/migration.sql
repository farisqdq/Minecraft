-- The owner portal: property owners and investors who are not on the
-- landlord's team get their own login, scoped to the properties they're
-- assigned. Additive: one defaulted column on Document and three new
-- tables. Safe to run twice, per prisma/migrations/README.md.

ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "sharedWithOwners" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "PropertyOwner" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "monthlyEmail" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "PropertyOwner_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PropertyOwner_email_key" ON "PropertyOwner"("email");

CREATE TABLE IF NOT EXISTS "PropertyOwnerAccess" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertyOwnerAccess_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PropertyOwnerAccess_ownerId_propertyId_key" ON "PropertyOwnerAccess"("ownerId", "propertyId");

CREATE INDEX IF NOT EXISTS "PropertyOwnerAccess_propertyId_idx" ON "PropertyOwnerAccess"("propertyId");

DO $$ BEGIN
    ALTER TABLE "PropertyOwnerAccess" ADD CONSTRAINT "PropertyOwnerAccess_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "PropertyOwner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "PropertyOwnerAccess" ADD CONSTRAINT "PropertyOwnerAccess_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "PropertyOwnerInvite" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "tokenHash" TEXT NOT NULL,
    "propertyIds" TEXT NOT NULL DEFAULT '[]',
    "invitedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "PropertyOwnerInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PropertyOwnerInvite_tokenHash_key" ON "PropertyOwnerInvite"("tokenHash");

CREATE INDEX IF NOT EXISTS "PropertyOwnerInvite_companyId_idx" ON "PropertyOwnerInvite"("companyId");

CREATE INDEX IF NOT EXISTS "PropertyOwnerInvite_email_idx" ON "PropertyOwnerInvite"("email");

DO $$ BEGIN
    ALTER TABLE "PropertyOwnerInvite" ADD CONSTRAINT "PropertyOwnerInvite_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "PropertyOwnerInvite" ADD CONSTRAINT "PropertyOwnerInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
