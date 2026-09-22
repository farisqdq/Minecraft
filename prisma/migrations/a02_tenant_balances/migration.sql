-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "balanceFrom" TEXT,
ADD COLUMN     "openingBalance" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "TenantCharge" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'fee',
    "month" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "raisedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantCharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenantCharge_tenantId_idx" ON "TenantCharge"("tenantId");

-- AddForeignKey
ALTER TABLE "TenantCharge" ADD CONSTRAINT "TenantCharge_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantCharge" ADD CONSTRAINT "TenantCharge_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

