-- A rent payment can count toward a month other than the one it arrived in.
-- Null keeps today's behaviour (the month of the payment date), so every
-- existing row means exactly what it did. Additive, safe to run twice.
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "appliesTo" TEXT;
