import { test } from "node:test";
import assert from "node:assert/strict";
import { packLedger, unpackLedger, type LedgerEntry } from "../lib/ledger-pack.ts";

const link = (id: string) => `/api/files/attachment/${encodeURIComponent(id)}`;

const base: LedgerEntry = {
  id: "t1",
  propertyId: "p1",
  unitId: null,
  type: "rent",
  date: "2026-10-01",
  amount: 1450,
  detail: "",
  note: "",
  category: "",
  appliesTo: null,
  spreadMonths: null,
  recurringExpenseId: null,
  loanPaymentId: null,
  attachments: [],
};

test("every field survives, in every combination of empty and filled", () => {
  const entries: LedgerEntry[] = [
    base,
    { ...base, id: "t2", unitId: "u1", type: "expense", amount: 412.6, category: "Repairs & Maintenance", detail: "Plumber" },
    { ...base, id: "t3", note: "Paid late", appliesTo: "2026-09" },
    { ...base, id: "t4", propertyId: "p2", unitId: "u2", spreadMonths: 12, type: "expense", category: "Property Tax" },
    { ...base, id: "t5", recurringExpenseId: "r1", type: "expense", category: "Insurance" },
    { ...base, id: "t6", loanPaymentId: "lp1", type: "expense", category: "Mortgage Interest", amount: 0.01 },
    {
      ...base,
      id: "t7",
      unitId: "u1",
      attachments: [
        { id: "a1", transactionId: "t7", url: link("a1"), filename: "receipt.pdf", contentType: "application/pdf" },
        { id: "a/2", transactionId: "t7", url: link("a/2"), filename: "photo.heic", contentType: "image/heic" },
      ],
    },
    // A middle field set with everything after it empty, and the reverse.
    { ...base, id: "t8", detail: "Only the detail" },
    { ...base, id: "t9", loanPaymentId: "lp2" },
    { ...base, id: "t10", amount: -5 },
  ];
  const packed = JSON.parse(JSON.stringify(packLedger(entries)));
  assert.deepEqual(unpackLedger(packed, link), entries);
});

test("ids are listed once, and empty trailing fields are left off", () => {
  const packed = packLedger([base, { ...base, id: "t2" }, { ...base, id: "t3", detail: "x" }]);
  assert.deepEqual(packed.properties, ["p1"]);
  assert.deepEqual(packed.units, []);
  assert.equal(packed.rows[0].length, 6);
  assert.equal(packed.rows[2].length, 7);
});

test("a large ledger packs to a fraction of its size and back to the same thing", () => {
  const props = Array.from({ length: 15 }, (_, i) => `cmv2sr9${String(i).padStart(2, "0")}ge8dtpudr14eft`);
  const entries: LedgerEntry[] = [];
  for (let i = 0; i < 8640; i++) {
    const expense = i % 6 >= 4;
    entries.push({
      ...base,
      id: `cmv2sr94l${String(i).padStart(5, "0")}8dtp1vol055g`,
      propertyId: props[i % 15],
      unitId: expense ? null : `cmv2sr9unit${i % 60}xxxxxxxxxxx`,
      type: expense ? "expense" : "rent",
      date: `20${18 + Math.floor(i / 1080)}-0${1 + (i % 9)}-15`,
      amount: expense ? 60 + (i % 90) : 1025,
      detail: expense ? "Water" : "Rent",
      category: expense ? "Utilities" : "",
    });
  }
  const objects = JSON.stringify(entries).length;
  const packed = JSON.stringify(packLedger(entries));
  assert.ok(packed.length < objects * 0.4, `${packed.length} vs ${objects}`);
  assert.deepEqual(unpackLedger(JSON.parse(packed), link), entries);
});
