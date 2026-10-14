-- The activity log (a34). Additive only: one new table, no foreign keys (a
-- person's history outlives their account; see the schema). Safe to run
-- twice, per prisma/migrations/README.md.

CREATE TABLE IF NOT EXISTS "ActivityLog" (
    "id" TEXT NOT NULL,
    "actorKind" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorEmail" TEXT NOT NULL,
    "actorName" TEXT,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "query" TEXT,
    "ip" TEXT,
    "device" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ActivityLog_actorKind_actorId_createdAt_idx" ON "ActivityLog"("actorKind", "actorId", "createdAt");
CREATE INDEX IF NOT EXISTS "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");
