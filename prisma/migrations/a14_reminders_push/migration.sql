-- Automatic reminders (email and push) and the devices that receive them.
-- Additive: two defaulted columns on Tenant and three new tables. Safe to
-- run twice, per prisma/migrations/README.md.

ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "emailReminders" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "pushReminders" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS "ReminderSettings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "rentDueOn" BOOLEAN NOT NULL DEFAULT true,
    "rentDueDays" INTEGER NOT NULL DEFAULT 3,
    "rentDueEmail" BOOLEAN NOT NULL DEFAULT true,
    "rentDuePush" BOOLEAN NOT NULL DEFAULT true,
    "rentLateOn" BOOLEAN NOT NULL DEFAULT true,
    "rentLateGraceDays" INTEGER NOT NULL DEFAULT 5,
    "rentLateEmail" BOOLEAN NOT NULL DEFAULT true,
    "rentLatePush" BOOLEAN NOT NULL DEFAULT true,
    "leaseEndOn" BOOLEAN NOT NULL DEFAULT true,
    "leaseEndDays" TEXT NOT NULL DEFAULT '60,30',
    "leaseEndTenant" BOOLEAN NOT NULL DEFAULT false,
    "leaseEndEmail" BOOLEAN NOT NULL DEFAULT true,
    "leaseEndPush" BOOLEAN NOT NULL DEFAULT true,
    "docExpiryOn" BOOLEAN NOT NULL DEFAULT true,
    "docExpiryDays" TEXT NOT NULL DEFAULT '30,7',
    "docExpiryEmail" BOOLEAN NOT NULL DEFAULT true,
    "docExpiryPush" BOOLEAN NOT NULL DEFAULT true,
    "maintenanceOn" BOOLEAN NOT NULL DEFAULT true,
    "maintenanceEmail" BOOLEAN NOT NULL DEFAULT true,
    "maintenancePush" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReminderSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ReminderSettings_companyId_key" ON "ReminderSettings"("companyId");

DO $$ BEGIN
    ALTER TABLE "ReminderSettings" ADD CONSTRAINT "ReminderSettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ReminderSent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sending',
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderSent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ReminderSent_key_channel_to_key" ON "ReminderSent"("key", "channel", "to");

CREATE INDEX IF NOT EXISTS "ReminderSent_companyId_createdAt_idx" ON "ReminderSent"("companyId", "createdAt");

DO $$ BEGIN
    ALTER TABLE "ReminderSent" ADD CONSTRAINT "ReminderSent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "tenantAccountId" TEXT,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

CREATE INDEX IF NOT EXISTS "PushSubscription_userId_idx" ON "PushSubscription"("userId");

CREATE INDEX IF NOT EXISTS "PushSubscription_tenantAccountId_idx" ON "PushSubscription"("tenantAccountId");

DO $$ BEGIN
    ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_tenantAccountId_fkey" FOREIGN KEY ("tenantAccountId") REFERENCES "TenantAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
