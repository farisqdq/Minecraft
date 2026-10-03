import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CODE_LENGTH,
  CODE_PATTERN,
  approvalDefaults,
  bathsLabel,
  bedsLabel,
  incomeMultiple,
  newListingCode,
  parseApplication,
  parseListing,
} from "../lib/listings.ts";

test("listing codes are unguessable-length and use only unambiguous characters", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const c = newListingCode();
    assert.equal(c.length, CODE_LENGTH);
    assert.match(c, CODE_PATTERN);
    assert.doesNotMatch(c, /[01ilo]/);
    seen.add(c);
  }
  assert.equal(seen.size, 200);
});

test("a listing needs a headline and a rent; the rest is optional and bounded", () => {
  const ok = parseListing({ headline: "  Sunny 2-bed near UK  ", rent: "1450", deposit: "", beds: "2", baths: "1.5", sqft: "950", photoIds: ["a", "a", "b"] });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.deepEqual(ok.value, {
      headline: "Sunny 2-bed near UK",
      description: "",
      rent: 1450,
      deposit: 0,
      availableOn: null,
      beds: 2,
      baths: 1.5,
      sqft: 950,
      pets: "",
      photoIds: ["a", "b"],
    });
  }
  assert.equal(parseListing({ rent: 1450 }).ok, false);
  assert.equal(parseListing({ headline: "x", rent: 0 }).ok, false);
  assert.equal(parseListing({ headline: "x", rent: 1000, beds: 40 }).ok, false);
  assert.equal(parseListing({ headline: "x", rent: 1000, availableOn: "2026-02-30" }).ok, false);
});

const good = {
  name: "Dana Reyes",
  email: "Dana@Example.com ",
  phone: "(859) 555-0142",
  moveIn: "2026-11-01",
  occupants: "2",
  income: "$4,800",
  consent: true,
};

test("an application keeps what was asked, cleaned", () => {
  const r = parseApplication(good, "2026-10-03");
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.email, "dana@example.com");
    assert.equal(r.value.income, 4800);
    assert.equal(r.value.occupants, 2);
    assert.equal(r.value.moveIn, "2026-11-01");
  }
});

test("an application is refused without a way to reach them, or without consent", () => {
  const why = (over: object) => {
    const r = parseApplication({ ...good, ...over }, "2026-10-03");
    return r.ok ? "" : "error" in r ? r.error : "spam";
  };
  assert.match(why({ name: "" }), /name/);
  assert.match(why({ email: "dana@" }), /email/);
  assert.match(why({ phone: "555-0142" }), /area code/);
  assert.match(why({ consent: false }), /confirm/);
  assert.match(why({ moveIn: "2026-09-01" }), /passed/);
  assert.match(why({ occupants: "0" }), /How many/);
  assert.match(why({ income: "lots" }), /monthly income/);
});

test("the hidden field marks a bot, and nothing else is checked", () => {
  const r = parseApplication({ website: "http://spam.example" }, "2026-10-03");
  assert.deepEqual(r, { ok: false, spam: true });
});

test("income reads as a multiple of the rent", () => {
  assert.equal(incomeMultiple(4800, 1450), 3.3);
  assert.equal(incomeMultiple(null, 1450), null);
  assert.equal(incomeMultiple(4800, 0), null);
});

test("beds and baths read the way listings say them", () => {
  assert.equal(bedsLabel(0), "Studio");
  assert.equal(bedsLabel(1), "1 bed");
  assert.equal(bedsLabel(2.5), "2.5 beds");
  assert.equal(bedsLabel(null), "");
  assert.equal(bathsLabel(1), "1 bath");
  assert.equal(bathsLabel(1.5), "1.5 baths");
});

test("an approved lease starts at the latest of today, when it's free, and when they asked; and runs a year", () => {
  assert.deepEqual(approvalDefaults({ moveIn: "2026-11-01", availableOn: "2026-10-15", today: "2026-10-03" }), { leaseStart: "2026-11-01", leaseEnd: "2027-10-31" });
  assert.deepEqual(approvalDefaults({ moveIn: null, availableOn: null, today: "2026-10-03" }), { leaseStart: "2026-10-03", leaseEnd: "2027-10-02" });
  assert.deepEqual(approvalDefaults({ moveIn: "2027-03-01", availableOn: null, today: "2026-10-03" }), { leaseStart: "2027-03-01", leaseEnd: "2028-02-29" });
});
