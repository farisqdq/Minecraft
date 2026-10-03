-- Bank statement import (a24). Additive only: two nullable columns on
-- Transaction and an index. Existing rows are untouched and read as
-- "not imported".
--
-- bankRef:  a stable id for the statement line an entry came from, so
--           uploading the same file (or an overlapping export) twice never
--           books the same money twice.
-- bankText: the bank's own words for that line ("LG&E WEB PYMT 093026"),
--           which is what the next import learns from: a payee filed once
--           is filed the same way next month.

ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "bankRef" TEXT;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "bankText" TEXT;

CREATE INDEX IF NOT EXISTS "Transaction_bankRef_idx" ON "Transaction"("bankRef");
