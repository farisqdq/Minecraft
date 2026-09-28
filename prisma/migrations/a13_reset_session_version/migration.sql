-- A reset link dies when the account's sessions do. Additive: one defaulted
-- column. Safe to run twice, per prisma/migrations/README.md.

ALTER TABLE "PasswordReset" ADD COLUMN IF NOT EXISTS "sessionVersion" INTEGER NOT NULL DEFAULT 0;
