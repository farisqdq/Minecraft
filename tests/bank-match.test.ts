import { test } from "node:test";
import assert from "node:assert/strict";
import { categoryFromWords, genericPayee, payeeKey, payeeLabel, samePayee, suggestAll, type MatchContext, type ImportRow } from "../lib/bank-match.ts";

// A small portfolio: a house, and a duplex with two units.
function ctx(over: Partial<MatchContext> = {}): MatchContext {
  return {
    properties: [
      { id: "oak", name: "12 Oak St" },
      { id: "dup", name: "Elm Duplex" },
    ],
    places: [
      { propertyId: "oak", unitId: null, label: "12 Oak St", rent: 1450, vacant: false },
      { propertyId: "dup", unitId: "a", label: "Elm Duplex — A", rent: 900, vacant: false },
      { propertyId: "dup", unitId: "b", label: "Elm Duplex — B", rent: 950, vacant: false },
    ],
    rentChanges: [],
    tenants: [
      { id: "t1", name: "Alan D Ward", propertyId: "oak", unitId: null, deposit: 1450, leaseStart: "2025-01-01" },
      { id: "t2", name: "Maria Lopez", propertyId: "dup", unitId: "a", deposit: 1200, leaseStart: "2026-08-20" },
      { id: "t3", name: "Joe Kim", propertyId: "dup", unitId: "b", deposit: 0, leaseStart: "" },
    ],
    ledger: [],
    learned: [],
    vendors: [],
    recurring: [],
    loans: [],
    ...over,
  };
}

let n = 0;
const row = (date: string, amount: number, text: string): ImportRow => ({ ref: `r${++n}`, date, amount, text });

test("payee key drops the parts that change every month", () => {
  assert.equal(payeeKey("LG&E WEB PYMT 093026 XXXXX1234"), payeeKey("LG&E WEB PYMT 102826 XXXXX1234"));
  assert.equal(payeeKey("LG&E WEB PYMT 093026"), "LG&E PYMT");
  assert.equal(payeeKey("ZELLE FROM ALAN WARD ON 09/02 REF # PP0KX"), "ZELLE FROM ALAN WARD");
  assert.equal(payeeKey("PURCHASE AUTHORIZED ON 09/03 HOME DEPOT #2318 LEXINGTON KY S386247"), "HOME DEPOT LEXINGTON KY");
  assert.equal(payeeKey("ZELLE PAYMENT FROM ALAN WARD CONF# 8KD8F"), "ZELLE PAYMENT FROM ALAN WARD");
});

test("the ledger description is the payee, without how it was paid", () => {
  assert.equal(payeeLabel("LG&E WEB PYMT 093026 XXXXX1234"), "LG&E");
  assert.equal(payeeLabel("HOME DEPOT #2318 LEXINGTON KY"), "Home Depot Lexington KY");
  assert.equal(payeeLabel("ONLINE PAYMENT"), "Online Payment");
  assert.equal(payeeLabel("12345"), "12345");
});

test("a tenant's full name on a deposit is their rent, for certain", () => {
  const [s] = suggestAll([row("2026-09-02", 1450, "ZELLE PAYMENT FROM ALAN WARD 8KD8F2")], ctx());
  assert.equal(s.action, "rent");
  assert.equal(s.confidence, "sure");
  assert.equal(s.propertyId, "oak");
  assert.equal(s.unitId, null);
  assert.equal(s.detail, "Alan D Ward");
  assert.equal(s.note, "September 2026 rent");
  assert.match(s.why, /Alan D Ward's name/);
});

test("a surname alone is sure only when the rent matches too", () => {
  const [sure] = suggestAll([row("2026-09-02", 900, "MOBILE DEPOSIT LOPEZ")], ctx());
  assert.equal(sure.confidence, "sure");
  assert.equal(sure.unitId, "a");
  const [guess] = suggestAll([row("2026-09-02", 450, "MOBILE DEPOSIT LOPEZ")], ctx());
  assert.equal(guess.action, "rent");
  assert.equal(guess.confidence, "guess");
  assert.match(guess.why, /check the amount/);
});

test("an amount that is exactly one place's rent is a guess; one shared by two places is left to you", () => {
  const [one] = suggestAll([row("2026-09-03", 950, "MOBILE DEPOSIT 4471")], ctx());
  assert.deepEqual([one.action, one.confidence, one.unitId], ["rent", "guess", "b"]);
  const shared = ctx({
    places: [
      { propertyId: "oak", unitId: null, label: "12 Oak St", rent: 900, vacant: false },
      { propertyId: "dup", unitId: "a", label: "Elm Duplex — A", rent: 900, vacant: false },
    ],
  });
  const [two] = suggestAll([row("2026-09-03", 900, "MOBILE DEPOSIT 4471")], shared);
  assert.equal(two.action, "skip");
  assert.match(two.why, /rent at 2 places/);
});

test("the rent is judged by what the place rented for that month, not today", () => {
  const c = ctx({
    rentChanges: [
      { id: "c1", propertyId: "dup", unitId: "b", effectiveFrom: "2025-01", amount: 875 },
      { id: "c2", propertyId: "dup", unitId: "b", effectiveFrom: "2026-09", amount: 950 },
    ],
  });
  const [s] = suggestAll([row("2026-08-01", 875, "MOBILE DEPOSIT")], c);
  assert.equal(s.unitId, "b");
});

test("a payee filed the same way twice running is certain", () => {
  const filed = (date: string, amount: number) => ({ bankText: `LG&E WEB PYMT ${date.replace(/-/g, "")}`, type: "expense" as const, date, amount, propertyId: "oak", unitId: null, category: "Utilities", detail: "LG&E", vendorId: null });
  const c = ctx({ learned: [filed("2026-07-28", 190), filed("2026-08-28", 205)] });
  const [s] = suggestAll([row("2026-09-28", -212.4, "LG&E WEB PYMT 092826")], c);
  assert.deepEqual([s.confidence, s.propertyId, s.category], ["sure", "oak", "Utilities"]);
  assert.match(s.why, /You filed "LG&E" under Utilities for 12 Oak St on Aug 28/);
});

test("a past choice beats everything else, and the newest one wins", () => {
  const c = ctx({
    learned: [
      { bankText: "LG&E WEB PYMT 072826", type: "expense", date: "2026-07-28", amount: 190, propertyId: "oak", unitId: null, category: "Utilities", detail: "LG&E", vendorId: null },
      { bankText: "LG&E WEB PYMT 082826", type: "expense", date: "2026-08-28", amount: 205, propertyId: "dup", unitId: "a", category: "Utilities", detail: "LG&E electric", vendorId: null },
    ],
  });
  const [s] = suggestAll([row("2026-09-28", -212.4, "LG&E WEB PYMT 092826")], c);
  // The last two filings disagree, so it's worth a look until they settle.
  assert.deepEqual([s.action, s.confidence, s.propertyId, s.unitId, s.category, s.detail], ["expense", "guess", "dup", "a", "Utilities", "LG&E electric"]);
  assert.match(s.why, /You filed "LG&E electric"/);
});

test("learned rent goes to the same place even with no name and a different amount", () => {
  const c = ctx({
    learned: [{ bankText: "DEPOSIT FROM ACME PAYROLL", type: "rent", date: "2026-08-01", amount: 950, propertyId: "dup", unitId: "b", category: "", detail: "Joe Kim", vendorId: null }],
  });
  const [s] = suggestAll([row("2026-09-01", 500, "DEPOSIT FROM ACME PAYROLL")], c);
  assert.deepEqual([s.action, s.confidence, s.unitId, s.detail], ["rent", "sure", "b", "Joe Kim"]);
});

test("a recurring bill's exact amount files it with its property and links it, once per month", () => {
  const c = ctx({
    recurring: [{ id: "ins", propertyId: "oak", unitId: null, category: "Insurance", detail: "State Farm", amount: 118.5, frequency: "monthly", month: null, active: true }],
  });
  const [a, b] = suggestAll([row("2026-09-10", -118.5, "SFPP PAYMENT 1234"), row("2026-09-24", -118.5, "SFPP PAYMENT 5678")], c);
  assert.deepEqual([a.action, a.category, a.propertyId, a.recurringExpenseId], ["expense", "Insurance", "oak", "ins"]);
  // The month's bill is already accounted for by the first line.
  assert.equal(b.recurringExpenseId, null);
});

test("a recurring bill already logged this month isn't matched again", () => {
  const c = ctx({
    recurring: [{ id: "ins", propertyId: "oak", unitId: null, category: "Insurance", detail: "", amount: 118.5, frequency: "monthly", month: null, active: true }],
    ledger: [{ id: "x", type: "expense", date: "2026-09-01", amount: 118.5, propertyId: "oak", unitId: null, detail: "", category: "Insurance", vendorId: null, recurringExpenseId: "ins", bankRef: null }],
  });
  const [s] = suggestAll([row("2026-09-20", -118.5, "SFPP PAYMENT")], c);
  assert.equal(s.recurringExpenseId, null);
});

test("a mortgage payment is never filed as one expense", () => {
  const c = ctx({ loans: [{ id: "l1", propertyId: "oak", lender: "Rocket", payment: 1102.34, escrow: 310, active: true }] });
  const [whole, pi] = suggestAll([row("2026-09-01", -1412.34, "ROCKET MORTGAGE"), row("2026-09-01", -1102.34, "ROCKET MTG")], c);
  for (const s of [whole, pi]) {
    assert.equal(s.action, "skip");
    assert.equal(s.status, "mortgage");
    assert.match(s.why, /Record it from the loan/);
  }
});

test("even a learned payee can't turn a mortgage payment into one expense", () => {
  const c = ctx({
    loans: [{ id: "l1", propertyId: "oak", lender: "Rocket", payment: 1102.34, escrow: 310, active: true }],
    learned: [{ bankText: "ROCKET MORTGAGE", type: "expense", date: "2026-08-01", amount: 1412.34, propertyId: "oak", unitId: null, category: "Mortgage Interest", detail: "", vendorId: null }],
  });
  assert.equal(suggestAll([row("2026-09-01", -1412.34, "ROCKET MORTGAGE")], c)[0].status, "mortgage");
});

test("a security deposit is not income, but a deposit equal to the rent is read as rent", () => {
  const [dep] = suggestAll([row("2026-08-18", 1200, "MOBILE DEPOSIT")], ctx());
  assert.deepEqual([dep.action, dep.status], ["skip", "deposit"]);
  assert.match(dep.why, /Maria Lopez's \$1,200 security deposit/);
  // Alan's deposit is the same as his rent: that's rent.
  const [rent] = suggestAll([row("2025-01-02", 1450, "ZELLE FROM ALAN WARD")], ctx());
  assert.equal(rent.action, "rent");
});

test("a line already typed into the ledger is a duplicate, and each entry answers for one line", () => {
  const c = ctx({
    ledger: [{ id: "m1", type: "rent", date: "2026-09-01", amount: 1450, propertyId: "oak", unitId: null, detail: "Alan D Ward", category: "", vendorId: null, recurringExpenseId: null, bankRef: null }],
  });
  const [a, b] = suggestAll([row("2026-09-03", 1450, "ZELLE FROM ALAN WARD"), row("2026-09-04", 1450, "ZELLE FROM ALAN WARD")], c);
  assert.deepEqual([a.action, a.status], ["skip", "duplicate"]);
  assert.match(a.why, /Already in the ledger: Sep 1/);
  assert.equal(a.duplicateOf?.id, "m1");
  // A second identical payment is a second payment.
  assert.deepEqual([b.action, b.status], ["rent", "new"]);
});

test("a duplicate is only a duplicate within a few days and in the same direction", () => {
  const entry = { id: "m1", type: "expense" as const, date: "2026-09-01", amount: 50, propertyId: "oak", unitId: null, detail: "", category: "Supplies", vendorId: null, recurringExpenseId: null, bankRef: null };
  const [far, rentOfSameSize] = suggestAll([row("2026-09-08", -50, "HOME DEPOT"), row("2026-09-01", 50, "REFUND")], ctx({ ledger: [entry] }));
  assert.notEqual(far.status, "duplicate");
  assert.notEqual(rentOfSameSize.status, "duplicate");
});

test("a line imported before is recognised by its ref and claims its entry first", () => {
  const r = row("2026-09-03", 1450, "ZELLE FROM ALAN WARD");
  const c = ctx({
    ledger: [
      { id: "imp", type: "rent", date: "2026-09-03", amount: 1450, propertyId: "oak", unitId: null, detail: "Alan D Ward", category: "", vendorId: null, recurringExpenseId: null, bankRef: r.ref },
    ],
  });
  const [s] = suggestAll([r], c);
  assert.deepEqual([s.action, s.status, s.duplicateOf?.id], ["skip", "imported", "imp"]);
});

test("transfers between your own accounts are left out", () => {
  const [out, inn] = suggestAll([row("2026-09-09", -500, "ONLINE TRANSFER TO SAV XXXX1234"), row("2026-09-09", 500, "ONLINE TRANSFER FROM CHK")], ctx());
  assert.deepEqual([out.action, out.status], ["skip", "transfer"]);
  assert.deepEqual([inn.action, inn.status], ["skip", "transfer"]);
});

test("a vendor in the book is found by name and goes where they last worked", () => {
  const c = ctx({
    vendors: [{ id: "v1", name: "Bluegrass Plumbing LLC" }],
    ledger: [{ id: "e1", type: "expense", date: "2026-08-15", amount: 240, propertyId: "dup", unitId: "b", detail: "", category: "Repairs & Maintenance", vendorId: "v1", recurringExpenseId: null, bankRef: null }],
  });
  const [s] = suggestAll([row("2026-09-12", -180, "BLUEGRASS PLUMBING 8823")], c);
  assert.deepEqual([s.action, s.confidence, s.propertyId, s.unitId, s.vendorId, s.detail], ["expense", "guess", "dup", "b", "v1", "Bluegrass Plumbing LLC"]);
});

test("words alone suggest a category; the property is asked for unless there's only one", () => {
  const [two] = suggestAll([row("2026-09-05", -84.17, "HOME DEPOT #2318 LEXINGTON KY")], ctx());
  assert.deepEqual([two.action, two.confidence, two.category, two.propertyId], ["expense", "none", "Supplies", ""]);
  assert.match(two.why, /which property/);
  const single = ctx({ properties: [{ id: "oak", name: "12 Oak St" }] });
  const [one] = suggestAll([row("2026-09-05", -84.17, "HOME DEPOT #2318 LEXINGTON KY")], single);
  assert.deepEqual([one.confidence, one.propertyId, one.detail], ["guess", "oak", "Home Depot Lexington KY"]);
});

test("keyword categories cover the usual bills", () => {
  assert.equal(categoryFromWords("LG&E WEB PYMT"), "Utilities");
  assert.equal(categoryFromWords("STATE FARM RO 27 SFPP"), "Insurance");
  assert.equal(categoryFromWords("FAYETTE COUNTY SHERIFF PROPERTY TAX"), "Property Tax");
  assert.equal(categoryFromWords("LOWE'S #1234"), "Supplies");
  assert.equal(categoryFromWords("SMITH LAW OFFICE"), "Legal & Professional");
  assert.equal(categoryFromWords("MONTHLY SERVICE FEE"), "Other");
  assert.equal(categoryFromWords("STARBUCKS"), null);
});

test("nothing to go on means skip, with nothing made up", () => {
  const [s] = suggestAll([row("2026-09-05", -6.5, "STARBUCKS 1123")], ctx());
  assert.deepEqual([s.action, s.confidence, s.propertyId, s.category], ["skip", "none", "", ""]);
});

test("samePayee offers a decision to the other lines from the same payee, same direction", () => {
  const rows = [row("2026-08-05", -84, "HOME DEPOT #2318 KY"), row("2026-09-05", -12, "HOME DEPOT #9 KY"), row("2026-09-06", 20, "HOME DEPOT #9 KY"), row("2026-09-07", -5, "LOWES")];
  assert.deepEqual(samePayee(rows, rows[0].ref), [rows[1].ref]);
});

test("a payee that names nobody isn't learned from, unless the amount matches too", () => {
  assert.equal(genericPayee(payeeKey("MOBILE DEPOSIT REF 4471")), true);
  assert.equal(genericPayee(payeeKey("CHECK 1043")), true);
  assert.equal(genericPayee(payeeKey("ZELLE FROM ALAN WARD")), false);
  // Joe's cheque came in as a mobile deposit once…
  const c = ctx({
    learned: [{ bankText: "MOBILE DEPOSIT REF 4471", type: "rent", date: "2026-09-03", amount: 950, propertyId: "dup", unitId: "b", category: "", detail: "Joe Kim", vendorId: null }],
  });
  // …which says nothing about Alan's cheque next month.
  const [alan] = suggestAll([row("2026-10-03", 1450, "MOBILE DEPOSIT REF 4502")], c);
  assert.equal(alan.unitId, null);
  assert.equal(alan.propertyId, "oak");
  assert.doesNotMatch(alan.why, /Joe|Elm/);
  // The same amount again is probably Joe again — but only probably.
  const [joe] = suggestAll([row("2026-10-03", 950, "MOBILE DEPOSIT REF 4503")], c);
  assert.deepEqual([joe.action, joe.confidence, joe.unitId], ["rent", "guess", "b"]);
  assert.match(joe.why, /check it's theirs/);
});

test("paper checks written to different people are never filed by the word CHECK", () => {
  const c = ctx({
    learned: [{ bankText: "CHECK 1043", type: "expense", date: "2026-09-03", amount: 400, propertyId: "oak", unitId: null, category: "Repairs & Maintenance", detail: "Roofer", vendorId: null }],
  });
  const [s] = suggestAll([row("2026-10-03", -75, "CHECK 1051")], c);
  assert.equal(s.action, "skip");
});

test("a tenant's name on the line outranks a history that points elsewhere", () => {
  const c = ctx({
    learned: [{ bankText: "ZELLE FROM MARIA LOPEZ", type: "rent", date: "2026-08-03", amount: 900, propertyId: "oak", unitId: null, category: "", detail: "", vendorId: null }],
  });
  const [s] = suggestAll([row("2026-09-03", 900, "ZELLE FROM MARIA LOPEZ")], c);
  assert.deepEqual([s.confidence, s.unitId], ["sure", "a"]);
});

test("generic lines aren't offered each other's decisions", () => {
  const rows = [row("2026-09-03", 950, "MOBILE DEPOSIT REF 1"), row("2026-09-04", 1450, "MOBILE DEPOSIT REF 2")];
  assert.deepEqual(samePayee(rows, rows[0].ref), []);
});

test("a learned payee still links the recurring bill it pays, so the month isn't asked for again", () => {
  const c = ctx({
    recurring: [{ id: "ins", propertyId: "oak", unitId: null, category: "Insurance", detail: "State Farm", amount: 118.5, frequency: "monthly", month: null, active: true }],
    learned: [{ bankText: "SFPP STATE FARM RO 27", type: "expense", date: "2026-09-10", amount: 118.5, propertyId: "oak", unitId: null, category: "Insurance", detail: "State Farm", vendorId: null }],
  });
  const [s] = suggestAll([row("2026-10-10", -118.5, "SFPP STATE FARM RO 27")], c);
  assert.deepEqual([s.confidence, s.recurringExpenseId], ["sure", "ins"]);
});
