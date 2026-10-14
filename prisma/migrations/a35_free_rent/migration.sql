-- Free months of rent (a35). Additive only: one flag on TenantCharge, false
-- for every existing row. Safe to run twice, per prisma/migrations/README.md.

ALTER TABLE "TenantCharge" ADD COLUMN IF NOT EXISTS "freeRent" BOOLEAN NOT NULL DEFAULT false;
