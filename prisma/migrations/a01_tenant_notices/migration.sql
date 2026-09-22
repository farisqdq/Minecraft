-- Renamed from 10_tenant_notices. "10" sorts before "4_tenants", so a fresh
-- database tried to create this table before Tenant existed and the whole
-- deploy died on the second migration. See prisma/migrations/README.md.
--
-- Written to be safe to run twice: a database that already applied the old
-- name has these objects, and will run this file again under the new one.

CREATE TABLE IF NOT EXISTS "TenantNotice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'rent',
    "month" TEXT,
    "amount" DOUBLE PRECISION,
    "body" TEXT NOT NULL,
    "sentById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "TenantNotice_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TenantNotice_tenantId_idx" ON "TenantNotice"("tenantId");

DO $$ BEGIN
    ALTER TABLE "TenantNotice" ADD CONSTRAINT "TenantNotice_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "TenantNotice" ADD CONSTRAINT "TenantNotice_sentById_fkey"
        FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
