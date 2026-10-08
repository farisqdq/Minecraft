-- An entry can be spread across several months (a yearly tax bill, rent paid
-- up front). Null means not spread, so every existing row is unchanged.
-- Additive, safe to run twice.
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "spreadMonths" INTEGER;
