import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStatement,
  monthsBetween,
  nextMonth,
  resolveStartMonth,
  balanceSummary,
} from "../lib/balance.ts";

const flat = (n: number) => () => n;

test("month arithmetic rolls the year over", () => {
  assert.equal(nextMonth("2026-09"), "2026-10");
  assert.equal(nextMonth("2026-12"), "2027-01");
  assert.deepEqual(monthsBetween("2026-11", "2027-02"), ["2026-11", "2026-12", "2027-01", "2027-02"]);
  assert.deepEqual(monthsBetween("2026-09", "2026-09"), ["2026-09"]);
  assert.deepEqual(monthsBetween("2026-10", "2026-09"), [], "backwards is empty, not a hang");
  assert.deepEqual(monthsBetween("rubbish", "2026-09"), []);
});

test("paid in full every month owes nothing", () => {
  const s = buildStatement({
    startMonth: "2026-07",
    currentMonth: "2026-09",
    rentFor: flat(1550),
    payments: [
      { month: "2026-07", amount: 1550 },
      { month: "2026-08", amount: 1550 },
      { month: "2026-09", amount: 1550 },
    ],
  });
  assert.equal(s.balance, 0);
  assert.equal(s.behindSince, "");
  assert.equal(s.monthsBehind, 0);
  assert.equal(s.charged, 4650);
  assert.equal(s.received, 4650);
});

test("two short months are one hole, not two unrelated ones", () => {
  // The whole point of the feature: $300 short in July, $1,450 short in
  // August used to read as two separate unpaid months.
  const s = buildStatement({
    startMonth: "2026-07",
    currentMonth: "2026-09",
    rentFor: flat(1550),
    payments: [
      { month: "2026-07", amount: 1250 },
      { month: "2026-08", amount: 100 },
      { month: "2026-09", amount: 1550 },
    ],
  });
  assert.equal(s.balance, 1750);
  assert.equal(s.behindSince, "2026-07");
  assert.equal(s.monthsBehind, 3);
});

test("a debt that clears and returns dates from when it returned", () => {
  const s = buildStatement({
    startMonth: "2026-06",
    currentMonth: "2026-09",
    rentFor: flat(1000),
    payments: [
      { month: "2026-06", amount: 500 },   // 500 behind
      { month: "2026-07", amount: 1500 },  // square again
      { month: "2026-08", amount: 1000 },  // still square
      { month: "2026-09", amount: 0 },     // 1000 behind
    ],
  });
  assert.equal(s.balance, 1000);
  assert.equal(s.behindSince, "2026-09", "not June — that debt was settled");
  assert.equal(s.monthsBehind, 1);
});

test("overpaying leaves them in credit, not owing a negative", () => {
  const s = buildStatement({
    startMonth: "2026-09",
    currentMonth: "2026-09",
    rentFor: flat(1000),
    payments: [{ month: "2026-09", amount: 1200 }],
  });
  assert.equal(s.balance, -200);
  assert.equal(s.behindSince, "");
  assert.equal(balanceSummary(s, (m) => m), "in credit");
});

test("fees add and credits take off", () => {
  const s = buildStatement({
    startMonth: "2026-09",
    currentMonth: "2026-09",
    rentFor: flat(1000),
    charges: [
      { month: "2026-09", kind: "fee", amount: 75, label: "Late fee" },
      { month: "2026-09", kind: "fee", amount: 200, label: "Lot fee" },
      { month: "2026-09", kind: "credit", amount: 50, label: "Goodwill" },
    ],
    payments: [{ month: "2026-09", amount: 1000 }],
  });
  assert.equal(s.balance, 225);
  assert.equal(s.rows[0].fees, 275);
  assert.equal(s.rows[0].credits, 50);
});

test("a charge in a month outside the window is not counted twice or at all", () => {
  const s = buildStatement({
    startMonth: "2026-09",
    currentMonth: "2026-09",
    rentFor: flat(0),
    charges: [{ month: "2026-08", kind: "fee", amount: 500, label: "Old fee" }],
  });
  assert.equal(s.balance, 0, "a fee before the window must not appear");
});

test("a rent rise mid-lease is charged at the right figure each month", () => {
  const rents: Record<string, number> = { "2026-07": 1450, "2026-08": 1450, "2026-09": 1550 };
  const s = buildStatement({
    startMonth: "2026-07",
    currentMonth: "2026-09",
    rentFor: (m) => rents[m] ?? 0,
    payments: [
      { month: "2026-07", amount: 1450 },
      { month: "2026-08", amount: 1450 },
      { month: "2026-09", amount: 1450 },
    ],
  });
  assert.equal(s.balance, 100, "only the rise is short");
  assert.equal(s.rows[2].rent, 1550);
});

test("a move-out stops the meter", () => {
  const s = buildStatement({
    startMonth: "2026-07",
    currentMonth: "2026-10",
    rentFor: flat(1000),
    lastRentMonth: "2026-08",
    payments: [
      { month: "2026-07", amount: 1000 },
      { month: "2026-08", amount: 1000 },
    ],
  });
  assert.equal(s.balance, 0, "September and October must not be charged");
  assert.deepEqual(
    s.rows.map((r) => r.month),
    ["2026-07", "2026-08"],
    "the statement ends when the tenancy did"
  );
});

test("a past tenant is not credited with the next tenant's rent", () => {
  // The bug this caught in live data: rent is recorded against a unit, not a
  // person, so a tenant who left in 2023 was collecting credit for every
  // payment the tenant after them made — $13,300 of someone else's money.
  const s = buildStatement({
    startMonth: "2022-11",
    currentMonth: "2026-09",
    rentFor: flat(950),
    lastRentMonth: "2023-01",
    payments: [
      { month: "2022-11", amount: 950 },
      { month: "2022-12", amount: 950 },
      { month: "2023-01", amount: 950 },
      // Everything below is the tenant who took the unit after them.
      ...monthsBetween("2023-02", "2026-09").map((month) => ({ month, amount: 950 })),
    ],
  });
  assert.equal(s.balance, 0, "square on the way out, and nothing after");
  assert.equal(s.received, 2850, "only their own three payments");
});

test("the books never start before the tenant moved in", () => {
  // Same bug from the other side: the first payment on a unit may belong to
  // whoever was there before.
  assert.equal(
    resolveStartMonth({
      explicit: null,
      firstPaymentMonth: "2021-03",
      leaseStartMonth: "2023-02",
      currentMonth: "2026-09",
    }),
    "2023-02"
  );
  // A lease that began before the ledger did still doesn't pull the start
  // back — that is the invented-arrears trap.
  assert.equal(
    resolveStartMonth({
      explicit: null,
      firstPaymentMonth: "2025-10",
      leaseStartMonth: "2019-01",
      currentMonth: "2026-09",
    }),
    "2025-10"
  );
  // A lease starting in the future can't leave a tenant with no statement.
  assert.equal(
    resolveStartMonth({
      explicit: null,
      firstPaymentMonth: null,
      leaseStartMonth: "2027-05",
      currentMonth: "2026-09",
    }),
    "2026-09"
  );
  // And an explicit setting still beats all of it.
  assert.equal(
    resolveStartMonth({
      explicit: "2026-01",
      firstPaymentMonth: "2021-03",
      leaseStartMonth: "2023-02",
      currentMonth: "2026-09",
    }),
    "2026-01"
  );
});

test("an opening balance is where the running total starts", () => {
  const s = buildStatement({
    startMonth: "2026-09",
    currentMonth: "2026-09",
    openingBalance: 1750,
    rentFor: flat(1000),
    payments: [{ month: "2026-09", amount: 1000 }],
  });
  assert.equal(s.balance, 1750);
  assert.equal(s.charged, 2750);
});

test("cents survive a year of arithmetic", () => {
  // 0.1 + 0.2 territory: twelve months of an awkward figure must not drift.
  const s = buildStatement({
    startMonth: "2026-01",
    currentMonth: "2026-12",
    rentFor: flat(3379.41),
    payments: monthsBetween("2026-01", "2026-12").map((month) => ({ month, amount: 3379.41 })),
  });
  assert.equal(s.balance, 0, "a year of exact payments must land on exactly zero");
  assert.equal(s.charged, 40552.92);
});

test("a part payment of an awkward figure is exact", () => {
  const s = buildStatement({
    startMonth: "2026-09",
    currentMonth: "2026-09",
    rentFor: flat(3379.41),
    payments: [{ month: "2026-09", amount: 3279.41 }],
  });
  assert.equal(s.balance, 100);
});

/* ---- the safety property: never invent arrears ---- */

test("no instruction and no payments starts today, not at the lease", () => {
  // A 2023 lease with a ledger that begins in 2025 must not produce two years
  // of invented debt. This is the assertion that matters most in this file.
  const start = resolveStartMonth({
    explicit: null,
    firstPaymentMonth: null,
    currentMonth: "2026-09",
  });
  assert.equal(start, "2026-09");
  const s = buildStatement({ startMonth: start, currentMonth: "2026-09", rentFor: flat(1550) });
  assert.equal(s.rows.length, 1);
  assert.equal(s.balance, 1550, "this month only — not 44 months");
});

test("with payments on file, the books start at the first one", () => {
  assert.equal(
    resolveStartMonth({ explicit: null, firstPaymentMonth: "2025-10", currentMonth: "2026-09" }),
    "2025-10"
  );
});

test("the landlord's own setting beats both", () => {
  assert.equal(
    resolveStartMonth({ explicit: "2026-01", firstPaymentMonth: "2025-10", currentMonth: "2026-09" }),
    "2026-01"
  );
  // Garbage in the column falls through rather than being trusted.
  assert.equal(
    resolveStartMonth({ explicit: "not-a-month", firstPaymentMonth: "2025-10", currentMonth: "2026-09" }),
    "2025-10"
  );
});

test("a start month in the future yields no rows and no invented debt", () => {
  const s = buildStatement({ startMonth: "2027-01", currentMonth: "2026-09", rentFor: flat(1550) });
  assert.deepEqual(s.rows, []);
  assert.equal(s.balance, 0);
});

test("negative or nonsense amounts cannot reduce what is owed", () => {
  const s = buildStatement({
    startMonth: "2026-09",
    currentMonth: "2026-09",
    rentFor: flat(1000),
    charges: [{ month: "2026-09", kind: "fee", amount: -500, label: "Hostile" }],
    payments: [{ month: "2026-09", amount: -9999 }],
  });
  assert.equal(s.balance, 1000, "a negative payment must not be a charge, or vice versa");
});

test("the summary line says the right thing in each state", () => {
  const owing = buildStatement({
    startMonth: "2026-08",
    currentMonth: "2026-09",
    rentFor: flat(1000),
    payments: [{ month: "2026-08", amount: 1000 }],
  });
  assert.equal(balanceSummary(owing, () => "September"), "behind since September");
  const square = buildStatement({ startMonth: "2026-09", currentMonth: "2026-09", rentFor: flat(0) });
  assert.equal(balanceSummary(square, (m) => m), "paid up");
});
