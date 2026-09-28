import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseDatasource, datasourceUrl, isPooled } from "../lib/prisma-url.ts";

test("a bare URL gets a small pool and a patient timeout", () => {
  assert.equal(
    datasourceUrl("postgresql://u:p@host:5432/db"),
    "postgresql://u:p@host:5432/db?connection_limit=1&pool_timeout=20"
  );
});

test("existing query parameters are kept and appended to", () => {
  assert.equal(
    datasourceUrl("postgresql://u:p@host/db?sslmode=require"),
    "postgresql://u:p@host/db?sslmode=require&connection_limit=1&pool_timeout=20"
  );
});

test("a pooled URL keeps its own concurrency; only the timeout is added", () => {
  assert.equal(
    datasourceUrl("postgresql://u:p@ep-x-pooler.neon.tech/db?sslmode=require"),
    "postgresql://u:p@ep-x-pooler.neon.tech/db?sslmode=require&pool_timeout=20"
  );
});

test("a URL that sets its own limits is left exactly alone", () => {
  const pooled = "postgresql://u:p@host-pooler/db?pgbouncer=true&connection_limit=1&pool_timeout=15";
  assert.equal(datasourceUrl(pooled), pooled);
  assert.equal(
    datasourceUrl("postgresql://u:p@host/db?connection_limit=5"),
    "postgresql://u:p@host/db?connection_limit=5&pool_timeout=20"
  );
});

test("an unset URL stays unset so Prisma reports that, not a bad URL", () => {
  assert.equal(datasourceUrl(""), "");
});

test("the pooled URL Vercel provides is used ahead of a direct DATABASE_URL", () => {
  assert.deepEqual(chooseDatasource({ DATABASE_URL: "postgresql://direct", POSTGRES_PRISMA_URL: "postgresql://pooled" }), {
    url: "postgresql://pooled",
    source: "POSTGRES_PRISMA_URL",
  });
  assert.equal(chooseDatasource({ DATABASE_URL: "postgresql://direct" }).source, "DATABASE_URL");
  assert.equal(chooseDatasource({}).source, "none");
});

test("a pooled URL is recognised by its shape", () => {
  assert.equal(isPooled("postgresql://u:p@ep-x-pooler.us-east-1.aws.neon.tech/db"), true);
  assert.equal(isPooled("postgresql://u:p@host/db?pgbouncer=true&connect_timeout=15"), true);
  assert.equal(isPooled("postgresql://u:p@aws-0-us-east-1.pooler.supabase.com:6543/postgres"), true);
  assert.equal(isPooled("postgresql://u:p@db.abc.supabase.co:5432/postgres"), false);
  assert.equal(isPooled("postgres://u:p@pooled.db.prisma.io:5432/postgres?sslmode=require"), true, "Prisma Postgres");
  assert.equal(isPooled("postgres://u:p@db.prisma.io:5432/postgres?sslmode=require"), false, "its direct host");
});
