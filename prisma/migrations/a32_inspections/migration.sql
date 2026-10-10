-- Move-in and move-out inspections (a32). Additive only: three new tables,
-- nothing existing is touched. An inspection belongs to a tenant; its items
-- are the checklist lines; its photos hang off the items. See
-- lib/inspections.ts. Safe to run twice, per prisma/migrations/README.md.

CREATE TABLE IF NOT EXISTS "Inspection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "inspectedOn" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "sharedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedName" TEXT,
    "tenantComment" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Inspection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "InspectionItem" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "room" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "condition" TEXT NOT NULL DEFAULT '',
    "note" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InspectionItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "InspectionPhoto" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "pathname" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InspectionPhoto_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Inspection_tenantId_idx" ON "Inspection"("tenantId");
CREATE INDEX IF NOT EXISTS "InspectionItem_inspectionId_idx" ON "InspectionItem"("inspectionId");
CREATE INDEX IF NOT EXISTS "InspectionPhoto_itemId_idx" ON "InspectionPhoto"("itemId");

DO $$ BEGIN
    ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "InspectionItem" ADD CONSTRAINT "InspectionItem_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "Inspection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "InspectionPhoto" ADD CONSTRAINT "InspectionPhoto_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InspectionItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "InspectionPhoto" ADD CONSTRAINT "InspectionPhoto_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
