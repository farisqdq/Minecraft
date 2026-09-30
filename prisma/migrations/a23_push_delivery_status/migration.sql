-- Push delivery status per device, so the Admin page can say which phones
-- are actually receiving notifications and why one isn't. The existing
-- "lastUsedAt" already means "last successful send" (it is only ever set
-- when the push service accepts a message), so it stays as that; these two
-- record the most recent failure. Additive, nullable, safe to run twice,
-- per prisma/migrations/README.md. Push devices are not in backups, so
-- nothing there changes.

ALTER TABLE "PushSubscription" ADD COLUMN IF NOT EXISTS "lastError" TEXT;
ALTER TABLE "PushSubscription" ADD COLUMN IF NOT EXISTS "lastErrorAt" TIMESTAMP(3);
