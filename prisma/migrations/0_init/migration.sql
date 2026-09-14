-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyMember" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "token" TEXT NOT NULL,
    "invitedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdById" TEXT,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "monthlyRent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "createdById" TEXT,
    "type" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "detail" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "CompanyMember_userId_idx" ON "CompanyMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyMember_companyId_userId_key" ON "CompanyMember"("companyId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Invite_token_key" ON "Invite"("token");

-- CreateIndex
CREATE INDEX "Invite_companyId_idx" ON "Invite"("companyId");

-- CreateIndex
CREATE INDEX "Invite_email_idx" ON "Invite"("email");

-- CreateIndex
CREATE INDEX "Property_companyId_idx" ON "Property"("companyId");

-- CreateIndex
CREATE INDEX "Transaction_propertyId_idx" ON "Transaction"("propertyId");

-- AddForeignKey
ALTER TABLE "CompanyMember" ADD CONSTRAINT "CompanyMember_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyMember" ADD CONSTRAINT "CompanyMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

