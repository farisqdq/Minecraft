import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ROOMS,
  changeFrom,
  compareItems,
  conditionRank,
  defaultItems,
  groupByRoom,
  itemKey,
  itemsFrom,
  normalizeCondition,
  normalizeKind,
  parseAcknowledgement,
  parseBackupInspections,
  parseHeaderInput,
  parseItemInput,
  progress,
  statusOf,
} from "../lib/inspections.ts";

test("conditions rank best to worst; anything else is unchecked", () => {
  assert.deepEqual(["good", "fair", "poor", "damaged"].map((c) => conditionRank(normalizeCondition(c))), [0, 1, 2, 3]);
  assert.equal(normalizeCondition("Excellent"), "");
  assert.equal(normalizeCondition(undefined), "");
  assert.equal(conditionRank("na"), null);
  assert.equal(conditionRank(""), null);
  assert.equal(normalizeKind("move_out"), "move_out");
  assert.equal(normalizeKind("routine"), null);
});

test("the default checklist covers every default room, unchecked", () => {
  const items = defaultItems();
  assert.equal(items.length, DEFAULT_ROOMS.reduce((n, r) => n + r.items.length, 0));
  assert.ok(items.every((i) => i.condition === "" && i.note === ""));
  assert.deepEqual(
    groupByRoom(items).map((g) => g.room),
    DEFAULT_ROOMS.map((r) => r.room)
  );
});

test("a move-out checklist repeats the move-in one, unchecked and without duplicates", () => {
  const moveIn = [
    { room: "Kitchen", name: "Floors", condition: "good" },
    { room: "Kitchen", name: "Stove & oven", condition: "fair" },
    { room: "kitchen ", name: "floors", condition: "good" },
    { room: "Bedroom 2", name: "Closet", condition: "good" },
  ];
  assert.deepEqual(itemsFrom(moveIn), [
    { room: "Kitchen", name: "Floors", condition: "", note: "" },
    { room: "Kitchen", name: "Stove & oven", condition: "", note: "" },
    { room: "Bedroom 2", name: "Closet", condition: "", note: "" },
  ]);
});

test("items match across inspections ignoring case and spacing", () => {
  assert.equal(itemKey(" Kitchen ", "Sink  & faucet"), itemKey("kitchen", "sink & Faucet"));
  assert.notEqual(itemKey("Bathroom", "Floors"), itemKey("Bathroom 2", "Floors"));
});

test("worse, same, better, new and unchecked", () => {
  assert.equal(changeFrom("damaged", "good"), "worse");
  assert.equal(changeFrom("fair", "fair"), "same");
  assert.equal(changeFrom("good", "poor"), "better");
  assert.equal(changeFrom("good", undefined), "new");
  assert.equal(changeFrom("", "good"), "unchecked");
  // N/A on either side has nothing to compare: not flagged as worse.
  assert.equal(changeFrom("na", "good"), "same");
  assert.equal(changeFrom("damaged", "na"), "same");
});

test("compareItems puts each move-out item beside its move-in self", () => {
  const before = [
    { id: "a", room: "Kitchen", name: "Floors", condition: "good" as const, note: "New vinyl" },
    { id: "b", room: "Bathroom", name: "Toilet", condition: "fair" as const, note: "" },
  ];
  const now = [
    { id: "x", room: "kitchen", name: "floors", condition: "damaged" as const },
    { id: "y", room: "Bathroom", name: "Toilet", condition: "fair" as const },
    { id: "z", room: "Garage", name: "Door", condition: "poor" as const },
  ];
  const out = compareItems(now, before);
  assert.deepEqual(
    out.map((o) => [o.id, o.change, o.before?.id ?? null]),
    [
      ["x", "worse", "a"],
      ["y", "same", "b"],
      ["z", "new", null],
    ]
  );
  assert.equal(out[0].before?.note, "New vinyl");
});

test("rooms keep the order they first appear in, case-insensitively", () => {
  const g = groupByRoom([
    { room: "Kitchen", n: 1 },
    { room: "Bath", n: 2 },
    { room: "kitchen", n: 3 },
  ]);
  assert.deepEqual(
    g.map((r) => [r.room, r.items.map((i) => i.n)]),
    [
      ["Kitchen", [1, 3]],
      ["Bath", [2]],
    ]
  );
});

test("progress counts checked items and the poor or damaged ones", () => {
  assert.deepEqual(progress([{ condition: "" }, { condition: "good" }, { condition: "na" }, { condition: "poor" }, { condition: "damaged" }]), {
    total: 5,
    checked: 4,
    flagged: 2,
  });
});

test("status: draft, then shared, then acknowledged", () => {
  assert.equal(statusOf({ sharedAt: null, acknowledgedAt: null }), "draft");
  assert.equal(statusOf({ sharedAt: "2026-01-01", acknowledgedAt: null }), "shared");
  assert.equal(statusOf({ sharedAt: "2026-01-01", acknowledgedAt: "2026-01-02" }), "acknowledged");
});

test("item input needs a room and a name, and trims the rest", () => {
  assert.deepEqual(parseItemInput({ room: "  Kitchen ", name: " Stove  &  oven ", condition: "poor", note: " Burner 2 out " }), {
    ok: true,
    value: { room: "Kitchen", name: "Stove & oven", condition: "poor", note: "Burner 2 out" },
  });
  assert.equal(parseItemInput({ room: "", name: "Floors" }).ok, false);
  assert.equal(parseItemInput({ room: "Kitchen", name: "  " }).ok, false);
  const odd = parseItemInput({ room: "Kitchen", name: "Floors", condition: "terrible" });
  assert.ok(odd.ok && odd.value.condition === "");
});

test("the walk-through day is a real day, not in the future", () => {
  assert.deepEqual(parseHeaderInput({ inspectedOn: "2026-03-03", note: " All keys " }, "2026-10-11"), {
    ok: true,
    value: { inspectedOn: "2026-03-03", note: "All keys" },
  });
  assert.equal(parseHeaderInput({ inspectedOn: "2026-02-30" }, "2026-10-11").ok, false);
  assert.equal(parseHeaderInput({ inspectedOn: "2026-10-12" }, "2026-10-11").ok, false);
});

test("acknowledging takes a typed name that looks like one", () => {
  assert.deepEqual(parseAcknowledgement({ name: " Jane  Doe ", comment: "Bathroom tile was already cracked." }), {
    ok: true,
    value: { name: "Jane Doe", comment: "Bathroom tile was already cracked." },
  });
  assert.equal(parseAcknowledgement({ name: "" }).ok, false);
  assert.equal(parseAcknowledgement({ name: "x" }).ok, false);
  assert.equal(parseAcknowledgement({ name: "123 !!" }).ok, false);
  assert.equal(parseAcknowledgement({ name: "Ng" }).ok, true, "short real names are names");
  assert.equal(parseAcknowledgement({ name: "José Núñez" }).ok, true);
});

/* ---- backups ---- */

const SIGNED = {
  kind: "move_in",
  inspectedOn: "2026-03-03",
  note: "Two keys, one fob",
  sharedAt: "2026-03-03T18:00:00.000Z",
  acknowledgedAt: "2026-03-04T09:30:00.000Z",
  acknowledgedName: "Jane Doe",
  tenantComment: "Closet door sticks.",
  items: [
    {
      room: "Kitchen",
      name: "Floors",
      condition: "good",
      note: "",
      photos: [{ url: "https://x.private.blob.vercel-storage.com/a.jpg", key: "ok", filename: "a.jpg", contentType: "image/jpeg", size: 1234 }],
    },
    { room: "Kitchen", name: "Stove & oven", condition: "poor", note: "Burner 2", photos: [] },
  ],
};

test("a backup's inspections survive the round trip, photos and signature included", () => {
  const back = parseBackupInspections(JSON.parse(JSON.stringify([SIGNED])), (_u, key) => key === "ok");
  const { key: _key, ...photo } = SIGNED.items[0].photos[0];
  assert.deepEqual(back, [
    {
      ...SIGNED,
      kind: "move_in",
      items: [
        { ...SIGNED.items[0], condition: "good", photos: [photo] },
        { ...SIGNED.items[1], condition: "poor" },
      ],
    },
  ]);
});

test("a backup photo whose link isn't vouched for is dropped, and the rest kept", () => {
  const back = parseBackupInspections([SIGNED], () => false);
  assert.equal(back[0].items.length, 2);
  assert.equal(back[0].items[0].photos.length, 0);
});

test("a signature with no signer isn't a signature; acknowledged implies shared", () => {
  const [unsigned] = parseBackupInspections([{ ...SIGNED, acknowledgedName: "" }], () => true);
  assert.equal(unsigned.acknowledgedAt, "");
  assert.equal(unsigned.tenantComment, "");
  const [signed] = parseBackupInspections([{ ...SIGNED, sharedAt: "" }], () => true);
  assert.equal(signed.sharedAt, SIGNED.acknowledgedAt);
});

test("inspections without a kind or a real day are skipped; a bad line is dropped, not the inspection", () => {
  const back = parseBackupInspections(
    [
      { ...SIGNED, kind: "routine" },
      { ...SIGNED, inspectedOn: "2026-02-31" },
      { ...SIGNED, items: [{ room: "", name: "Floors" }, ...SIGNED.items] },
    ],
    () => true
  );
  assert.equal(back.length, 1);
  assert.equal(back[0].items.length, 2);
  assert.deepEqual(parseBackupInspections(undefined, () => true), []);
});
