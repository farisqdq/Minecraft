-- One-time password reset links for property owners. Additive: one new
-- table. Safe to run twice, per prisma/migrations/README.md.

CREATE TABLE IF NOT EXISTS "OwnerPasswordReset" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "issuedBy" TEXT NOT NULL DEFAULT 'self',
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnerPasswordReset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OwnerPasswordReset_tokenHash_key" ON "OwnerPasswordReset"("tokenHash");

CREATE INDEX IF NOT EXISTS "OwnerPasswordReset_ownerId_idx" ON "OwnerPasswordReset"("ownerId");

DO $$ BEGIN
    ALTER TABLE "OwnerPasswordReset" ADD CONSTRAINT "OwnerPasswordReset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "PropertyOwner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
