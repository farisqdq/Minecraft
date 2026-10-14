import { test } from "node:test";
import assert from "node:assert/strict";
import { describe, deviceLabel, fillNames, safeQuery, shouldLog } from "../lib/activity.ts";

const req = (method: string, path: string, prefetch = false) => ({ method, path, prefetch });

test("pages and changes are logged; prefetches, plumbing and API reads are not", () => {
  assert.equal(shouldLog(req("GET", "/dashboard")), true);
  assert.equal(shouldLog(req("GET", "/portal")), true);
  assert.equal(shouldLog(req("GET", "/dashboard", true)), false, "the browser guessing ahead is not the person");
  assert.equal(shouldLog(req("POST", "/api/transactions")), true);
  assert.equal(shouldLog(req("DELETE", "/api/tenants/t1")), true);
  assert.equal(shouldLog(req("GET", "/api/transactions")), false, "a page's data fetch isn't a separate action");
  assert.equal(shouldLog(req("GET", "/api/files/document/d1")), true, "opening a file is");
  assert.equal(shouldLog(req("GET", "/api/export")), true);
  assert.equal(shouldLog(req("POST", "/api/auth/callback/credentials")), false, "sign-ins come from lib/auth.ts instead");
});

test("requests read as sentences, with the records they name", () => {
  assert.deepEqual(describe("POST", "/api/transactions"), { text: "Recorded a payment or expense", refs: [], change: true });
  const d = describe("PATCH", "/api/tenants/ck123");
  assert.equal(d.text, "Edited tenant {tenant:ck123}");
  assert.deepEqual(d.refs, [{ kind: "tenant", id: "ck123" }]);
  assert.equal(describe("GET", "/dashboard/properties/p9").text, "Opened property {property:p9}");
  assert.equal(describe("GET", "/dashboard/move-outs").text, "Opened the move-outs page");
  assert.equal(describe("GET", "/dashboard/properties/p9/files").text, "Opened files for {property:p9}");
  assert.equal(describe("POST", "/api/messages/t2/read").text, "Read messages from {tenant:t2}");
  assert.equal(describe("POST", "/api/messages/t2").text, "Sent a message to {tenant:t2}");
  assert.equal(describe("EVENT", "sign-in").text, "Signed in");
  assert.equal(describe("POST", "/api/portal/requests").text, "Submitted a repair request");
});

test("an action with no rule still shows up rather than vanishing", () => {
  assert.deepEqual(describe("POST", "/api/something/new"), { text: "Saved something (something/new)", refs: [], change: true });
  assert.equal(describe("GET", "/owners/x/y").text, "Opened /owners/x/y");
});

test("names fill in, and a deleted record says so", () => {
  const names = new Map([["tenant:t1", "Jane Doe"]]);
  assert.equal(fillNames("Edited tenant {tenant:t1}", names), "Edited tenant Jane Doe");
  assert.equal(fillNames("Edited tenant {tenant:gone}", names), "Edited tenant a deleted tenant");
});

test("query strings keep only harmless keys", () => {
  assert.equal(safeQuery("?tab=money&token=secret&code=123"), "tab=money");
  assert.equal(safeQuery(""), "");
});

test("devices are named broadly", () => {
  assert.equal(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Version/17.0 Mobile Safari/604.1"), "iPhone · Safari");
  assert.equal(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"), "Windows · Chrome");
  assert.equal(deviceLabel(""), "");
});
