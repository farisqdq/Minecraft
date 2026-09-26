-- Move-outs and security deposit settlements.
-- Additive only: two new tables and a nullable column on Transaction and on
-- TenantCharge. Nothing existing is altered, rewritten or dropped. Safe to
-- run twice, per prisma/migrations/README.md.

-- AlterTable
ALTER TABLE "TenantCharge" ADD COLUMN IF NOT EXISTS "moveOutId" TEXT;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "moveOutId" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "MoveOut" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "movedOutOn" TIMESTAMP(3) NOT NULL,
    "lastRentMonth" TEXT NOT NULL,
    "deposit" DOUBLE PRECISION NOT NULL,
    "refund" DOUBLE PRECISION NOT NULL,
    "returnBy" TIMESTAMP(3),
    "returnedOn" TIMESTAMP(3),
    "returnNote" TEXT,
    "forwardingAddress" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoveOut_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MoveOutDeduction" (
    "id" TEXT NOT NULL,
    "moveOutId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "MoveOutDeduction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MoveOut_tenantId_key" ON "MoveOut"("tenantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MoveOutDeduction_moveOutId_idx" ON "MoveOutDeduction"("moveOutId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Transaction_moveOutId_idx" ON "Transaction"("moveOutId");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_moveOutId_fkey" FOREIGN KEY ("moveOutId") REFERENCES "MoveOut"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "MoveOut" ADD CONSTRAINT "MoveOut_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "MoveOut" ADD CONSTRAINT "MoveOut_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "MoveOutDeduction" ADD CONSTRAINT "MoveOutDeduction_moveOutId_fkey" FOREIGN KEY ("moveOutId") REFERENCES "MoveOut"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "TenantCharge" ADD CONSTRAINT "TenantCharge_moveOutId_fkey" FOREIGN KEY ("moveOutId") REFERENCES "MoveOut"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

