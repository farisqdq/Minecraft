-- Site admins and their audit log.
-- Additive: one column on User with a default, one new table, and one UPDATE
-- that marks the site's owner as admin (so the panel is reachable without a
-- deploy-time setting). Nothing existing is altered otherwise. Safe to run
-- twice, per prisma/migrations/README.md.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isAdmin" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "AdminLog" (
    "id" TEXT NOT NULL,
    "adminId" TEXT,
    "adminEmail" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AdminLog_createdAt_idx" ON "AdminLog"("createdAt");

DO $$ BEGIN
    ALTER TABLE "AdminLog" ADD CONSTRAINT "AdminLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The site's owner. lib/admin.ts treats this address as admin regardless,
-- so this is belt and braces for the flag the panel itself reads.
UPDATE "User" SET "isAdmin" = true WHERE lower("email") = 'fariseqal3@gmail.com';
