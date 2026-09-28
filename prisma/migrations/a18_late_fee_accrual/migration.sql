-- Late fees accrue from the day a rule started charging, not from the day
-- rent first went late. Additive: one defaulted column, plus a fix to the
-- company-policy rules already on file. Safe to run twice, per
-- prisma/migrations/README.md.

ALTER TABLE "TenantChargeRule" ADD COLUMN IF NOT EXISTS "accrueFrom" TEXT NOT NULL DEFAULT '';

-- Policy rules made before this ran were pinned to the month they were
-- created in, so rent already overdue from an earlier month never got a
-- fee. They now start on the day they were created instead: overdue rent
-- from before that day gets the one-time fee, and daily fees run only from
-- the day after. Rows already given a date are left alone.
UPDATE "TenantChargeRule"
SET "accrueFrom" = to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
    "startMonth" = NULL
WHERE "fromPolicy" = true AND "accrueFrom" = '';
