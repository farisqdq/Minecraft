// Adopts a database that was created with `prisma db push` (no migration
// history) so `prisma migrate deploy` can take over without trying to recreate
// tables that already exist. Runs on every deploy; no-ops once history exists.
//
// It only ever marks the FIRST migration as applied — every later migration
// still runs normally on top, which is what brings an older pushed database
// up to date without touching its rows.
const { execSync } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");

const FIRST_MIGRATION = "0_init";
const TABLES_IN_FIRST_MIGRATION = [
  "User",
  "Company",
  "CompanyMember",
  "Invite",
  "Property",
  "Transaction",
];

async function inspect() {
  const prisma = new PrismaClient();
  try {
    const checks = TABLES_IN_FIRST_MIGRATION.map(
      (t) => `to_regclass('public."${t}"') IS NOT NULL`
    ).join(" AND ");
    const [row] = await prisma.$queryRawUnsafe(
      `SELECT to_regclass('public."_prisma_migrations"') IS NOT NULL AS has_history,
              (${checks}) AS has_tables`
    );
    return { hasHistory: row.has_history, hasTables: row.has_tables };
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  if (!process.env.DATABASE_URL) return;

  const { hasHistory, hasTables } = await inspect();

  // Already on migrations, or an empty database migrate deploy can build itself.
  if (hasHistory || !hasTables) return;

  console.log(`Adopting existing database: marking ${FIRST_MIGRATION} as applied...`);
  execSync(`npx prisma migrate resolve --applied ${FIRST_MIGRATION}`, { stdio: "inherit" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
