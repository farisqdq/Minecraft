-- Late-fee policy: a one-time fee plus a daily amount up to a cap, set once
-- per company and overridable per tenant. Additive: defaulted columns on
-- three tables, one new table, and one index replaced by a wider one. Safe
-- to run twice, per prisma/migrations/README.md.

-- A late rule can now add a daily amount and stop at a ceiling. The
-- fromPolicy flag marks the one rule per tenant that lib/statements.ts keeps
-- in step with the company policy.
ALTER TABLE "TenantChargeRule" ADD COLUMN IF NOT EXISTS "dailyAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "TenantChargeRule" ADD COLUMN IF NOT EXISTS "capPercent" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "TenantChargeRule" ADD COLUMN IF NOT EXISTS "fromPolicy" BOOLEAN NOT NULL DEFAULT false;

-- A daily fee needs one run per day, so the idempotency key grows a day
-- column: '' for the one-time fee (every existing run), YYYY-MM-DD for a
-- day. Dropping and recreating the unique index loses no rows; existing
-- (ruleId, month, '') pairs stay unique under the new index.
ALTER TABLE "TenantRuleRun" ADD COLUMN IF NOT EXISTS "day" TEXT NOT NULL DEFAULT '';
DROP INDEX IF EXISTS "TenantRuleRun_ruleId_month_key";
CREATE UNIQUE INDEX IF NOT EXISTS "TenantRuleRun_ruleId_month_day_key" ON "TenantRuleRun"("ruleId", "month", "day");

-- Per-tenant override: "default" (company policy) | "custom" (own rules) | "off".
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "lateFeeMode" TEXT NOT NULL DEFAULT 'default';

-- Tenants who already had a late rule of their own keep it. Without this a
-- rule set up last month would silently stop the moment the column arrived,
-- because "default" means "the company policy, not this tenant's rules".
UPDATE "Tenant" SET "lateFeeMode" = 'custom'
WHERE "lateFeeMode" = 'default'
  AND "id" IN (
    SELECT "tenantId" FROM "TenantChargeRule"
    WHERE "kind" = 'late' AND "active" = true AND "fromPolicy" = false
  );

CREATE TABLE IF NOT EXISTS "LateFeePolicy" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "graceDays" INTEGER NOT NULL DEFAULT 5,
    "percent" DOUBLE PRECISION NOT NULL DEFAULT 7,
    "dailyAmount" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "capPercent" DOUBLE PRECISION NOT NULL DEFAULT 12,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LateFeePolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LateFeePolicy_companyId_key" ON "LateFeePolicy"("companyId");

DO $$ BEGIN
    ALTER TABLE "LateFeePolicy" ADD CONSTRAINT "LateFeePolicy_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
