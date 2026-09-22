-- CreateTable
CREATE TABLE "TenantNotice" (
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

-- CreateIndex
CREATE INDEX "TenantNotice_tenantId_idx" ON "TenantNotice"("tenantId");

-- AddForeignKey
ALTER TABLE "TenantNotice" ADD CONSTRAINT "TenantNotice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantNotice" ADD CONSTRAINT "TenantNotice_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

