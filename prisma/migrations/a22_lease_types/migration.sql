-- Lease types: each LLC says whether its leases are residential or
-- commercial, on its late-fee policy. Every tenant of the LLC follows it;
-- there is no per-tenant lease type. Additive: one column on LateFeePolicy
-- and one default changed. Safe to run twice, per prisma/migrations/README.md.

-- Added without a default first, so a NULL marks a row this migration has
-- not looked at yet. That is what makes the update below happen once, even
-- if this file is run twice or meets a row a landlord has since saved.
ALTER TABLE "LateFeePolicy" ADD COLUMN IF NOT EXISTS "leaseType" TEXT;

-- Every existing saved policy becomes RESIDENTIAL, and keeps the numbers
-- the landlord saved — with one exception. A row that still holds exactly
-- the untouched old defaults (5 days' grace, 7%, $5/day, cap 12%; switched
-- on or off) was never chosen by anyone: those were the numbers the form
-- started with. Its cap takes the new residential default of 10%. Any
-- other saved row, including a cap of 12 saved alongside different
-- numbers, is left exactly as it was. (The same rule is migratedPolicy in
-- lib/late-fee-policy.ts, which is tested.) An LLC that should be
-- commercial is switched on its Late fees panel, which suggests a 12% cap.
--
-- Postgres reads every right-hand side from the row as it was, so the
-- CASE sees the old values. A company that never saved a policy has no row
-- and gets the new defaults from the code: residential, cap 10%.
--
-- Lowering a cap never deletes a fee already charged, and never adds one:
-- a month already above the new cap just gets no more (lib/charge-rules.ts),
-- and "Run late fees now" lists it (lib/late-fee-report.ts).
UPDATE "LateFeePolicy"
SET "leaseType" = 'residential',
    "capPercent" = CASE
      WHEN "graceDays" = 5 AND "percent" = 7 AND "dailyAmount" = 5 AND "capPercent" = 12 THEN 10
      ELSE "capPercent"
    END
WHERE "leaseType" IS NULL;

ALTER TABLE "LateFeePolicy" ALTER COLUMN "leaseType" SET DEFAULT 'residential';
ALTER TABLE "LateFeePolicy" ALTER COLUMN "leaseType" SET NOT NULL;

-- A row created from here on starts at the residential default of 10%.
ALTER TABLE "LateFeePolicy" ALTER COLUMN "capPercent" SET DEFAULT 10;
