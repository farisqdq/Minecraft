import { test } from "node:test";
import assert from "node:assert/strict";
import { datasourceUrl } from "../lib/prisma-url.ts";

test("a bare URL gets a small pool and a patient timeout", () => {
  assert.equal(
    datasourceUrl("postgresql://u:p@host:5432/db"),
    "postgresql://u:p@host:5432/db?connection_limit=3&pool_timeout=20"
  );
});

test("existing query parameters are kept and appended to", () => {
  assert.equal(
    datasourceUrl("postgresql://u:p@host/db?sslmode=require"),
    "postgresql://u:p@host/db?sslmode=require&connection_limit=3&pool_timeout=20"
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
