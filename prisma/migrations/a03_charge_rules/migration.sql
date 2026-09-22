-- Standing rules: what a tenant owes beyond rent, every month or when rent
-- is late. Additive only — nothing existing is altered or dropped.

-- CreateTable
CREATE TABLE "TenantChargeRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'monthly',
    "label" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "percent" BOOLEAN NOT NULL DEFAULT false,
    "graceDays" INTEGER NOT NULL DEFAULT 5,
    "startMonth" TEXT,
    "endMonth" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantChargeRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenantChargeRule_tenantId_idx" ON "TenantChargeRule"("tenantId");

-- AddForeignKey
ALTER TABLE "TenantChargeRule" ADD CONSTRAINT "TenantChargeRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantChargeRule" ADD CONSTRAINT "TenantChargeRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: one row per month a rule has been applied for.
--
-- Deliberately separate from the charge. Deleting a charge means deleting it
-- — the money is reversed, the row is gone — and if the rule's memory lived
-- on the charge, the next page load would write it straight back and the
-- delete would look broken. The rule remembers here instead.
CREATE TABLE "TenantRuleRun" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantRuleRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: applied at most once per month, enforced by the database
-- rather than by remembering to check. Two requests landing together is the
-- ordinary case on a dashboard and must not bill a tenant twice.
CREATE UNIQUE INDEX "TenantRuleRun_ruleId_month_key" ON "TenantRuleRun"("ruleId", "month");

-- AddForeignKey
ALTER TABLE "TenantRuleRun" ADD CONSTRAINT "TenantRuleRun_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "TenantChargeRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: a charge can name the rule that made it. Nullable, so every
-- existing row stays valid. It is only a label on where the charge came from
-- — deleting the charge deletes it, and TenantRuleRun is what stops the rule
-- writing it again.
ALTER TABLE "TenantCharge" ADD COLUMN     "ruleId" TEXT;

-- AddForeignKey
ALTER TABLE "TenantCharge" ADD CONSTRAINT "TenantCharge_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "TenantChargeRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
