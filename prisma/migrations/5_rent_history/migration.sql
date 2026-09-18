-- CreateTable
CREATE TABLE "RentChange" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "unitId" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RentChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RentChange_propertyId_idx" ON "RentChange"("propertyId");

-- CreateIndex
CREATE INDEX "RentChange_unitId_idx" ON "RentChange"("unitId");

-- AddForeignKey
ALTER TABLE "RentChange" ADD CONSTRAINT "RentChange_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentChange" ADD CONSTRAINT "RentChange_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentChange" ADD CONSTRAINT "RentChange_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
