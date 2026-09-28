import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assignableIds,
  combineStatements,
  monthSeries,
  monthsEnding,
  newOwnerInviteToken,
  occupancy,
  occupantForOwner,
  ownerAcceptLink,
  ownerInviteEmail,
  ownerInviteIsLive,
  ownerMayViewDocument,
  ownerStatementEmail,
  ownerStatementKey,
  parsePropertyIds,
  requestForOwner,
  rentRollFor,
  scopedPropertyIds,
  serializePropertyIds,
  shiftMonth,
  statementFor,
  statementMonthDue,
  totalsFor,
  type OwnerTxn,
} from "../lib/owners.ts";
import { hashToken } from "../lib/password-reset.ts";

/* ---------- Invites ---------- */

test("an invite token is random, stored only as its hash, and lives 14 days", () => {
  const a = newOwnerInviteToken(new Date("2026-09-28T12:00:00Z"));
  const b = newOwnerInviteToken();
  assert.notEqual(a.token, b.token);
  assert.equal(a.tokenHash, hashToken(a.token));
  assert.notEqual(a.tokenHash, a.token);
  assert.equal(a.expiresAt.toISOString(), "2026-10-12T12:00:00.000Z");
  assert.equal(ownerAcceptLink("https://eqal.rentals/", a.token), `https://eqal.rentals/owners/accept?token=${a.token}`);
});

test("an invite is live until it's accepted or expires", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  const row = { acceptedAt: null, expiresAt: new Date("2026-10-12T12:00:00Z") };
  assert.equal(ownerInviteIsLive(row, now), true);
  assert.equal(ownerInviteIsLive({ ...row, acceptedAt: now }, now), false);
  assert.equal(ownerInviteIsLive(row, new Date("2026-10-12T12:00:01Z")), false);
});

test("property ids round-trip through the invite's JSON column and nonsense reads as none", () => {
  assert.deepEqual(parsePropertyIds(serializePropertyIds(["a", "b", "a"])), ["a", "b"]);
  assert.deepEqual(parsePropertyIds("not json"), []);
  assert.deepEqual(parsePropertyIds('{"a":1}'), []);
  assert.deepEqual(parsePropertyIds(null), []);
  assert.deepEqual(parsePropertyIds('["x", 3, "", "y"]'), ["x", "y"]);
});

test("only the company's own properties can be assigned, in the company's order", () => {
  assert.deepEqual(assignableIds(["p3", "other-llc", "p1", "p1"], ["p1", "p2", "p3"]), ["p1", "p3"]);
  assert.deepEqual(assignableIds("p1", ["p1"]), []);
  assert.deepEqual(assignableIds([1, null], ["p1"]), []);
});

test("the invite email names the properties and carries the link", () => {
  const m = ownerInviteEmail({
    link: "https://x/owners/accept?token=t",
    companyName: "Elm Street LLC",
    propertyNames: ["12 Elm St", "14 Elm St"],
  });
  assert.match(m.subject, /Elm Street LLC has shared properties/);
  assert.match(m.text, /- 12 Elm St\n {2}- 14 Elm St/);
  assert.match(m.text, /https:\/\/x\/owners\/accept\?token=t/);
  assert.match(m.text, /read-only/);
});

/* ---------- Scoping ---------- */

test("an owner's scope is exactly their access rows", () => {
  assert.deepEqual(scopedPropertyIds([{ propertyId: "a" }, { propertyId: "b" }, { propertyId: "a" }]), ["a", "b"]);
});

test("an owner may read a document only if it is on their property AND shared with owners", () => {
  const mine = ["p1", "p2"];
  assert.equal(ownerMayViewDocument({ propertyId: "p1", sharedWithOwners: true }, mine), true);
  assert.equal(ownerMayViewDocument({ propertyId: "p1", sharedWithOwners: false }, mine), false, "not shared");
  assert.equal(ownerMayViewDocument({ propertyId: "p9", sharedWithOwners: true }, mine), false, "someone else's");
  assert.equal(ownerMayViewDocument({ propertyId: null, sharedWithOwners: true }, mine), false, "an LLC document");
});

/* ---------- Tenant privacy ---------- */

test("an owner learns a tenant's first name and lease end month, and nothing else", () => {
  const tenant = {
    name: "Maria Gonzalez-Ruiz",
    email: "maria@example.com",
    phone: "555-0100",
    deposit: 1500,
    note: "Behind on rent",
    dueDay: 5,
    leaseStart: new Date("2025-02-01T00:00:00Z"),
    leaseEnd: new Date("2027-01-31T00:00:00Z"),
  };
  const seen = occupantForOwner(tenant);
  assert.deepEqual(seen, { label: "Maria", leaseEndMonth: "2027-01" });
  // The shape itself is the rule: nothing personal can come through it.
  assert.deepEqual(Object.keys(seen).sort(), ["label", "leaseEndMonth"]);
  assert.equal(JSON.stringify(seen).includes("example.com"), false);
  assert.equal(JSON.stringify(seen).includes("Gonzalez"), false);
});

test("a tenant with no usable name reads as Occupied, and an open-ended lease has no end month", () => {
  assert.deepEqual(occupantForOwner({ name: "   ", leaseEnd: null }), { label: "Occupied", leaseEndMonth: "" });
  assert.deepEqual(occupantForOwner({ name: "Sam", leaseEnd: "2026-12-31" }), { label: "Sam", leaseEndMonth: "2026-12" });
});

/* ---------- Rent roll ---------- */

const house = { id: "p1", name: "12 Elm St", monthlyRent: 1500, vacant: false, vacantSince: null };

test("a property without units is one row; with units, one per unit", () => {
  const solo = rentRollFor(house, [], [{ propertyId: "p1", unitId: null, name: "Sam Lee", leaseEnd: null, active: true }]);
  assert.equal(solo.length, 1);
  assert.equal(solo[0].label, "12 Elm St");
  assert.equal(solo[0].vacant, false);
  assert.equal(solo[0].occupant?.label, "Sam");

  const units = [
    { id: "u1", name: "Apt 1", monthlyRent: 900, vacant: false, vacantSince: null },
    { id: "u2", name: "Apt 2", monthlyRent: 950, vacant: true, vacantSince: new Date("2026-08-15T00:00:00Z") },
  ];
  const rows = rentRollFor(house, units, [
    { propertyId: "p1", unitId: "u1", name: "Ana Diaz", leaseEnd: "2027-03-31", active: true },
    { propertyId: "p1", unitId: "u2", name: "Old Tenant", leaseEnd: null, active: false },
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].occupant, { label: "Ana", leaseEndMonth: "2027-03" });
  assert.equal(rows[1].vacant, true);
  assert.equal(rows[1].vacantSince, "2026-08-15");
  assert.equal(rows[1].occupant, null, "a moved-out tenant is not an occupant");
  assert.deepEqual(occupancy(rows), { total: 2, occupied: 1, vacant: 1, scheduledRent: 900 });
});

test("a place with nobody active in it is vacant even if the flag hasn't been set", () => {
  const rows = rentRollFor(house, [], []);
  assert.equal(rows[0].vacant, true);
  assert.equal(rows[0].occupant, null);
});

/* ---------- Money ---------- */

const ledger: OwnerTxn[] = [
  { propertyId: "p1", type: "rent", date: "2026-09-01", amount: 1500, category: "" },
  { propertyId: "p1", type: "rent", date: "2026-09-03", amount: 200, category: "", otherIncome: true },
  { propertyId: "p1", type: "expense", date: "2026-09-10", amount: 120.5, category: "Repairs & Maintenance" },
  { propertyId: "p1", type: "expense", date: "2026-09-12", amount: 80, category: "Repairs & Maintenance" },
  { propertyId: "p1", type: "expense", date: "2026-09-20", amount: 300, category: "Insurance" },
  { propertyId: "p1", type: "expense", date: "2026-09-21", amount: 10, category: "" },
  { propertyId: "p1", type: "rent", date: "2026-08-01", amount: 1500, category: "" },
  { propertyId: "p1", type: "rent", date: "2025-12-01", amount: 1400, category: "" },
];

test("a month's statement splits rent, other income and expenses by category, largest first", () => {
  const s = statementFor(ledger, "2026-09");
  assert.equal(s.rentCollected, 1500);
  assert.equal(s.otherIncome, 200);
  assert.equal(s.totalIncome, 1700);
  assert.deepEqual(s.expenses, [
    { category: "Insurance", amount: 300 },
    { category: "Repairs & Maintenance", amount: 200.5 },
    { category: "Other", amount: 10 },
  ]);
  assert.equal(s.totalExpenses, 510.5);
  assert.equal(s.net, 1189.5);
  assert.equal(s.entries, 6);
});

test("an empty month says so rather than pretending", () => {
  const s = statementFor(ledger, "2026-07");
  assert.equal(s.entries, 0);
  assert.equal(s.net, 0);
  assert.deepEqual(s.expenses, []);
});

test("statements combine across properties, merging categories", () => {
  const a = statementFor(ledger, "2026-09");
  const b = statementFor(
    [
      { propertyId: "p2", type: "rent", date: "2026-09-02", amount: 1000, category: "" },
      { propertyId: "p2", type: "expense", date: "2026-09-02", amount: 50, category: "Insurance" },
    ],
    "2026-09"
  );
  const c = combineStatements([a, b], "2026-09");
  assert.equal(c.rentCollected, 2500);
  assert.equal(c.otherIncome, 200);
  assert.equal(c.expenses[0].category, "Insurance");
  assert.equal(c.expenses[0].amount, 350);
  assert.equal(c.totalExpenses, 560.5);
  assert.equal(c.net, 2139.5);
  assert.equal(c.entries, 8);
});

test("twelve months ending at a month, oldest first, with the year rolling over", () => {
  const months = monthsEnding("2026-02", 12);
  assert.equal(months.length, 12);
  assert.equal(months[0], "2025-03");
  assert.equal(months[11], "2026-02");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
});

test("a month series has a bucket for every month, empty ones included", () => {
  const series = monthSeries(ledger, monthsEnding("2026-09", 3));
  assert.deepEqual(series.map((m) => m.month), ["2026-07", "2026-08", "2026-09"]);
  assert.deepEqual(series[0], { month: "2026-07", rent: 0, other: 0, expense: 0, net: 0 });
  assert.equal(series[1].rent, 1500);
  assert.equal(series[2].net, 1189.5);
});

test("year-to-date totals take everything dated inside the year", () => {
  const ytd = totalsFor(ledger, "2026");
  assert.equal(ytd.rent, 3000);
  assert.equal(ytd.other, 200);
  assert.equal(ytd.expense, 510.5);
  assert.equal(ytd.net, 2689.5);
  assert.equal(totalsFor(ledger, "2025").rent, 1400);
});

/* ---------- The monthly email ---------- */

test("the monthly statement is for the previous month, and only from the 2nd", () => {
  assert.equal(statementMonthDue(new Date("2026-10-01T12:00:00Z")), null);
  assert.equal(statementMonthDue(new Date("2026-10-02T00:00:00Z")), "2026-09");
  assert.equal(statementMonthDue(new Date("2026-01-15T00:00:00Z")), "2025-12");
  assert.equal(ownerStatementKey("own_1", "2026-09"), "owner-statement:own_1:2026-09");
});

test("the statement email summarises each property and links to the month", () => {
  const s = statementFor(ledger, "2026-09");
  const m = ownerStatementEmail({
    name: "Pat Investor",
    month: "2026-09",
    link: "https://x/owners/statement?month=2026-09",
    properties: [{ name: "12 Elm St", statement: s }],
    combined: s,
  });
  assert.equal(m.subject, "Your September 2026 owner statement is ready");
  assert.match(m.text, /Hi Pat,/);
  assert.match(m.text, /12 Elm St: rent \$1,500, other income \$200, expenses \$510\.50, net \$1,189\.50/);
  assert.doesNotMatch(m.text, /All together/, "one property needs no combined line");
  assert.match(m.text, /owners\/statement\?month=2026-09/);
});

/* ---------- Repairs ---------- */

test("a repair reaches an owner without the tenant, the thread, or the vendor", () => {
  const row = {
    id: "r1",
    propertyId: "p1",
    title: "Leaking tap",
    detail: "Call me on 555-0100 any time",
    category: "Plumbing",
    status: "seen",
    urgency: "normal",
    createdAt: new Date("2026-09-20T10:00:00Z"),
    property: { name: "12 Elm St" },
    unit: { name: "Apt 1" },
    tenant: { name: "Maria Gonzalez", phone: "555-0100" },
    vendor: { name: "Joe's Plumbing", phone: "555-0200" },
    updates: [{ body: "Quoted $400" }],
  };
  const seen = requestForOwner(row);
  assert.deepEqual(seen, {
    id: "r1",
    propertyId: "p1",
    propertyName: "12 Elm St",
    unitName: "Apt 1",
    title: "Leaking tap",
    category: "Plumbing",
    status: "seen",
    urgency: "normal",
    createdAt: "2026-09-20T10:00:00.000Z",
  });
  const text = JSON.stringify(seen);
  assert.equal(text.includes("555-0100"), false);
  assert.equal(text.includes("Joe"), false);
  assert.equal(text.includes("$400"), false);
});
