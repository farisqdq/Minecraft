-- Appearance per person: each landlord account picks a layout (classic,
-- command, ledger, board), a mode (system, light, dark) and an accent; tenant
-- and owner logins pick a mode only. The defaults reproduce today's app
-- exactly, so no one's view changes until they choose. Additive, with
-- defaults, safe to run twice, per prisma/migrations/README.md.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "uiLayout" TEXT NOT NULL DEFAULT 'classic';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "uiTheme" TEXT NOT NULL DEFAULT 'system';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "uiAccent" TEXT;
ALTER TABLE "TenantAccount" ADD COLUMN IF NOT EXISTS "uiTheme" TEXT NOT NULL DEFAULT 'system';
ALTER TABLE "PropertyOwner" ADD COLUMN IF NOT EXISTS "uiTheme" TEXT NOT NULL DEFAULT 'system';
