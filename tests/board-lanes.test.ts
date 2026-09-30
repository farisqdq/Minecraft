import test from "node:test";
import assert from "node:assert/strict";
import { boardTargets, buildBoard, monthsThrough, shiftMonth, type BoardTenant } from "../lib/layouts/board-lanes.ts";

const house = (id: string, rent: number, extra: Partial<{ vacant: boolean; vacantSince: string | null }> = {}) => ({
  id,
  companyId: "c1",
  name: id,
  address: `${id} St`,
  monthlyRent: rent,
  vacant: false,
  vacantSince: null,
  ...extra,
});

const tenant = (id: string, propertyId: string, unitId: string | null, extra: Partial<BoardTenant> = {}): BoardTenant => ({
  id,
  propertyId,
  unitId,
  name: id,
  phone: "",
  dueDay: 1,
  active: true,
  leaseStart: "2025-01-01",
  leaseEnd: "2027-12-31",
  ...extra,
});

const rent = (propertyId: string, unitId: string | null, date: string, amount: number) => ({
  propertyId,
  unitId,
  type: "rent" as const,
  date,
  amount,
});

test("month keys step across years and list every month since the first entry", () => {
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2025-12", 1), "2026-01");
  assert.deepEqual(monthsThrough([{ date: "2025-11-20" }, { date: "2026-01-02" }], "2026-02"), [
    "2025-11",
    "2025-12",
    "2026-01",
    "2026-02",
  ]);
  assert.deepEqual(monthsThrough([], "2026-02"), ["2026-02"]);
});

test("targets match Classic's: a house, or each unit plus the whole building", () => {
  const keys = boardTargets([house("h", 1000), house("apt", 0)], [
    { id: "u1", propertyId: "apt", name: "1", monthlyRent: 800, vacant: false, vacantSince: null },
  ]).map((t) => t.key);
  assert.deepEqual(keys, ["h", "apt:u1", "apt:whole"]);
});

test("each target lands in one lane, and the totals are Classic's", () => {
  const properties = [
    house("paid", 1000),
    house("partial", 1200),
    house("nothing", 900),
    house("empty", 1500, { vacant: true, vacantSince: "2026-08-31" }),
    house("expired", 1100),
    house("overpaid", 500),
  ];
  const tenants = [
    tenant("tPaid", "paid", null),
    tenant("tPartial", "partial", null),
    tenant("tNothing", "nothing", null, { dueDay: 25 }),
    tenant("tExpired", "expired", null, { leaseEnd: "2026-06-30" }),
    tenant("tOver", "overpaid", null),
  ];
  const transactions = [
    rent("paid", null, "2026-09-02", 1000),
    rent("partial", null, "2026-09-03", 600),
    rent("expired", null, "2026-09-01", 1100),
    rent("overpaid", null, "2026-09-01", 1000),
    rent("paid", null, "2026-08-02", 1000), // another month: ignored
  ];
  const board = buildBoard({
    month: "2026-09",
    today: "2026-09-10",
    properties,
    units: [],
    tenants,
    transactions,
    rentChanges: [],
    lateFees: { "tPartial|2026-09": 50 },
  });
  const ids = (lane: keyof typeof board.lanes) => board.lanes[lane].map((c) => c.target.key);
  assert.deepEqual(ids("late"), ["partial"]);
  assert.deepEqual(ids("due"), ["nothing"], "due on the 25th: owed, not late yet");
  assert.deepEqual(ids("vacant"), ["empty"]);
  assert.deepEqual(ids("ended"), ["expired"]);
  assert.deepEqual(ids("paid"), ["paid", "overpaid"]);

  const partial = board.lanes.late[0];
  assert.equal(partial.owed, 650, "rent + fees - paid");
  assert.equal(partial.partial, true);
  assert.equal(partial.lateDays, 9);
  assert.equal(partial.progress, Math.round((600 / 1250) * 100));
  assert.equal(board.lanes.vacant[0].vacantDays, 10);

  // Capped per unit: the $500 over on "overpaid" doesn't count.
  assert.deepEqual(board.collection, { expected: 4700, collected: 3200, paidCount: 3, dueCount: 5 });
  assert.equal(board.rentIn, 3700, "uncapped: every rent entry in the month");
  assert.equal(board.owedCount, 2);
});

test("a fee still open keeps a month out of Paid even when the rent is in", () => {
  const board = buildBoard({
    month: "2026-09",
    today: "2026-09-20",
    properties: [house("h", 1000)],
    units: [],
    tenants: [tenant("t", "h", null)],
    transactions: [rent("h", null, "2026-09-15", 1000)],
    rentChanges: [],
    lateFees: { "t|2026-09": 75 },
  });
  assert.equal(board.lanes.late.length, 1);
  assert.equal(board.lanes.late[0].owed, 75);
  // Classic's rent roll counts rent only, so it calls this unit paid.
  assert.equal(board.collection.paidCount, 1);
});

test("a one-unit property: rent on the whole property is the unit's, and the building line stays hidden", () => {
  const board = buildBoard({
    month: "2026-09",
    today: "2026-09-05",
    properties: [house("p", 0)],
    units: [{ id: "u", propertyId: "p", name: "A", monthlyRent: 1000, vacant: false, vacantSince: null }],
    tenants: [tenant("t", "p", null)],
    transactions: [rent("p", null, "2026-09-01", 1000)],
    rentChanges: [],
    lateFees: {},
  });
  assert.deepEqual(board.lanes.paid.map((c) => c.target.key), ["p:u"]);
  assert.equal(board.lanes.paid[0].tenant?.id, "t");
  assert.equal(board.lanes.paid[0].unitName, "A");
  assert.equal(board.collection.dueCount, 1);
});

test("rent is judged at what it was that month", () => {
  const board = buildBoard({
    month: "2026-03",
    today: "2026-09-05",
    properties: [house("h", 1200)],
    units: [],
    tenants: [tenant("t", "h", null)],
    transactions: [rent("h", null, "2026-03-01", 1000)],
    rentChanges: [
      { id: "a", propertyId: "h", unitId: null, effectiveFrom: "2025-01", amount: 1000 },
      { id: "b", propertyId: "h", unitId: null, effectiveFrom: "2026-06", amount: 1200 },
    ],
    lateFees: {},
  });
  assert.equal(board.lanes.paid.length, 1, "the raise came later, so March at $1,000 is paid");
});
