/**
 * Runs `prisma migrate deploy` with the direct database URL, falling back
 * to DATABASE_URL when no direct one is set — so a database with no pooler
 * needs one setting, not two, and a missing setting never fails a deploy.
 *
 * The schema names DATABASE_POSTGRES_URL as directUrl; Prisma insists it
 * exists, so this fills it in first. Reads .env the way Prisma would when
 * the variables aren't in the environment (local runs).
 */
const { spawnSync } = require("child_process");
const { existsSync, readFileSync } = require("fs");

if (!process.env.DATABASE_URL && existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
}
if (!process.env.DATABASE_POSTGRES_URL && process.env.DATABASE_URL) {
  process.env.DATABASE_POSTGRES_URL = process.env.DATABASE_URL;
  console.log("migrate: DATABASE_POSTGRES_URL not set, using DATABASE_URL for migrations");
}

const run = spawnSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit", env: process.env });
process.exit(run.status ?? 1);
