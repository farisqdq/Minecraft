-- When a place went vacant, so the app can say how long and what it's cost.
-- Additive only: three nullable or defaulted columns. Existing vacant places
-- keep vacantSince null ("vacant, since unknown") rather than being given an
-- invented date. Safe to run twice, per prisma/migrations/README.md.

ALTER TABLE "MoveOut" ADD COLUMN IF NOT EXISTS "madeVacant" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "vacantSince" TIMESTAMP(3);

ALTER TABLE "Unit" ADD COLUMN IF NOT EXISTS "vacantSince" TIMESTAMP(3);
