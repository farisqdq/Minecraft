-- 1099-NEC prep (a26). Additive only: one nullable column on Vendor.
-- What a vendor's W-9 says they are — "individual", "partnership" or
-- "corporation" — which decides whether they get a 1099-NEC. Null is "not
-- known yet", which is what every existing vendor is. No tax ID is stored:
-- that stays on the W-9 in the filing cabinet. Safe to run twice.

ALTER TABLE "Vendor" ADD COLUMN IF NOT EXISTS "taxClass" TEXT;
