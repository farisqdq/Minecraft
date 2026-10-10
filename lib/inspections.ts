/**
 * Move-in and move-out inspections: what condition a place was in, room by
 * room, on the day a tenant got the keys and the day they gave them back.
 *
 * A deposit deduction is only as good as the evidence for it. "The carpet
 * was ruined" is an argument; "the carpet was Good, photographed, and the
 * tenant signed for it on March 3rd — here it is now" is not. Most deposit
 * disputes come down to which of those a landlord has, and most small
 * landlords have the first.
 *
 * So an inspection is a checklist of rooms and items, each with a condition,
 * a note and photos. The landlord shares it with the tenant in the portal;
 * the tenant reads it and acknowledges it by typing their name, with room
 * for anything they see differently. Once acknowledged it can't be changed —
 * that is the whole point of it. A move-out inspection starts from the
 * move-in one, item for item, and says what got worse.
 *
 * Pure: no database and no clock.
 */

export const KINDS = ["move_in", "move_out"] as const;
export type InspectionKind = (typeof KINDS)[number];

export const KIND_LABEL: Record<InspectionKind, string> = {
  move_in: "Move-in inspection",
  move_out: "Move-out inspection",
};

/** Best first. "" is not yet looked at; "na" is not in this place. */
export const CONDITIONS = ["good", "fair", "poor", "damaged"] as const;
export type Condition = (typeof CONDITIONS)[number] | "na" | "";

export const CONDITION_LABEL: Record<Condition, string> = {
  good: "Good",
  fair: "Fair",
  poor: "Poor",
  damaged: "Damaged",
  na: "N/A",
  "": "Not checked",
};

export const MAX_ROOMS = 40;
export const MAX_ITEMS = 300;
export const MAX_PHOTOS_PER_ITEM = 8;

export function normalizeKind(v: unknown): InspectionKind | null {
  return v === "move_in" || v === "move_out" ? v : null;
}

export function normalizeCondition(v: unknown): Condition {
  return v === "good" || v === "fair" || v === "poor" || v === "damaged" || v === "na" ? v : "";
}

/** 0 for good … 3 for damaged; null when there's nothing to compare. */
export function conditionRank(c: Condition): number | null {
  const i = (CONDITIONS as readonly string[]).indexOf(c);
  return i < 0 ? null : i;
}

/**
 * The checklist a fresh move-in inspection starts with: the rooms and items
 * that come up in deposit disputes, in walking order. Every one can be
 * renamed, removed, or added to; this only saves typing "Walls" twelve times.
 */
export const DEFAULT_ROOMS: { room: string; items: string[] }[] = [
  { room: "Entry & living room", items: ["Walls & ceiling", "Floors", "Windows & screens", "Doors & locks", "Lights & outlets"] },
  {
    room: "Kitchen",
    items: ["Walls & ceiling", "Floors", "Cabinets & counters", "Sink & faucet", "Stove & oven", "Refrigerator", "Dishwasher"],
  },
  { room: "Bathroom", items: ["Walls & ceiling", "Floors", "Toilet", "Sink & faucet", "Tub / shower", "Mirror & cabinet"] },
  { room: "Bedroom", items: ["Walls & ceiling", "Floors", "Windows & screens", "Closet", "Doors"] },
  {
    room: "Whole place",
    items: ["Smoke detectors", "Carbon monoxide detectors", "Heating & cooling", "Water heater", "Keys handed over"],
  },
];

export type ItemDraft = { room: string; name: string; condition: Condition; note: string };

export function defaultItems(): ItemDraft[] {
  return DEFAULT_ROOMS.flatMap(({ room, items }) => items.map((name) => ({ room, name, condition: "" as Condition, note: "" })));
}

/** How two items are recognised as the same thing across inspections. */
export function itemKey(room: string, name: string): string {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  return `${norm(room)}|${norm(name)}`;
}

/**
 * A move-out checklist built from the move-in one: the same rooms and items
 * in the same order, unchecked, so the walk-through repeats the first one
 * and every line has something to be compared with.
 */
export function itemsFrom(previous: { room: string; name: string }[]): ItemDraft[] {
  const seen = new Set<string>();
  const out: ItemDraft[] = [];
  for (const p of previous) {
    const key = itemKey(p.room, p.name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ room: p.room, name: p.name, condition: "", note: "" });
  }
  return out;
}

export type Change = "worse" | "same" | "better" | "new" | "unchecked";

/** How one item compares with the same item at move-in. */
export function changeFrom(now: Condition, before: Condition | undefined): Change {
  if (before === undefined) return "new";
  const a = conditionRank(now);
  const b = conditionRank(before);
  if (a === null || b === null) return now === "" ? "unchecked" : "same";
  return a > b ? "worse" : a < b ? "better" : "same";
}

export type Compared<T> = T & { change: Change; before: { condition: Condition; note: string; id: string } | null };

/**
 * Each move-out item beside its move-in self. Matching is by room and item
 * name, ignoring case and spacing; an item that only exists at move-out is
 * "new" (worth a look — nobody wrote down its condition at the start).
 */
export function compareItems<T extends { room: string; name: string; condition: Condition }>(
  now: T[],
  before: { id: string; room: string; name: string; condition: Condition; note: string }[]
): Compared<T>[] {
  const byKey = new Map(before.map((b) => [itemKey(b.room, b.name), b]));
  return now.map((item) => {
    const b = byKey.get(itemKey(item.room, item.name));
    return {
      ...item,
      change: changeFrom(item.condition, b?.condition),
      before: b ? { condition: b.condition, note: b.note, id: b.id } : null,
    };
  });
}

/** Rooms in the order their first item appears, each with its items in order. */
export function groupByRoom<T extends { room: string }>(items: T[]): { room: string; items: T[] }[] {
  const rooms: { room: string; items: T[] }[] = [];
  const index = new Map<string, number>();
  for (const item of items) {
    const key = item.room.trim().toLowerCase();
    let i = index.get(key);
    if (i === undefined) {
      i = rooms.length;
      index.set(key, i);
      rooms.push({ room: item.room, items: [] });
    }
    rooms[i].items.push(item);
  }
  return rooms;
}

export type Progress = { total: number; checked: number; flagged: number };

/** How far through the walk-through: checked items, and those poor or damaged. */
export function progress(items: { condition: Condition }[]): Progress {
  let checked = 0;
  let flagged = 0;
  for (const i of items) {
    if (i.condition !== "") checked += 1;
    if (i.condition === "poor" || i.condition === "damaged") flagged += 1;
  }
  return { total: items.length, checked, flagged };
}

export type Status = "draft" | "shared" | "acknowledged";

export function statusOf(i: { sharedAt: string | null; acknowledgedAt: string | null }): Status {
  return i.acknowledgedAt ? "acknowledged" : i.sharedAt ? "shared" : "draft";
}

/**
 * What a move-out inspection gives the move-out form: one suggested
 * deduction per line that got worse since move-in, or that is poor or
 * damaged with no move-in line to say it was already so. Worded for the
 * itemized letter the tenant receives, and short enough for its 120
 * characters: "Kitchen, floors: damaged (good at move-in)".
 */
export function deductionSuggestions(
  now: { id: string; room: string; name: string; condition: Condition; note: string }[],
  before: { id: string; room: string; name: string; condition: Condition; note: string }[]
): { itemId: string; label: string }[] {
  const lower = (c: Condition) => CONDITION_LABEL[c].toLowerCase();
  return compareItems(now, before)
    .filter((c) => c.change === "worse" || (c.change === "new" && (c.condition === "poor" || c.condition === "damaged")))
    .map((c) => {
      const what = `${c.room.trim()}, ${c.name.trim().charAt(0).toLowerCase()}${c.name.trim().slice(1)}`;
      const was = c.before ? ` (${lower(c.before.condition)} at move-in)` : "";
      const label = `${what}: ${lower(c.condition)}${was}`;
      return { itemId: c.id, label: label.length > 120 ? `${label.slice(0, 119)}…` : label };
    });
}

/* ---- input ---- */

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const longText = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
function isDay(v: unknown): v is string {
  if (typeof v !== "string" || !DAY_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** One checklist line as typed. Room and item names are what matching runs on, so both are required. */
export function parseItemInput(body: unknown): Parsed<ItemDraft> {
  const b = (body ?? {}) as Record<string, unknown>;
  const room = text(b.room, 60);
  const name = text(b.name, 80);
  if (!room) return { ok: false, error: "Say which room." };
  if (!name) return { ok: false, error: "Say what's being checked, e.g. “Floors”." };
  return { ok: true, value: { room, name, condition: normalizeCondition(b.condition), note: longText(b.note, 1000) } };
}

/** The day it was done and an overall note. Not in the future (with `latest` as today, allowing for time zones). */
export function parseHeaderInput(body: unknown, latest: string): Parsed<{ inspectedOn: string; note: string }> {
  const b = (body ?? {}) as Record<string, unknown>;
  const inspectedOn = typeof b.inspectedOn === "string" ? b.inspectedOn.trim() : "";
  if (!isDay(inspectedOn)) return { ok: false, error: "Pick the day of the walk-through." };
  if (inspectedOn > latest) return { ok: false, error: "The walk-through can't be in the future." };
  return { ok: true, value: { inspectedOn, note: longText(b.note, 2000) } };
}

/**
 * The tenant's acknowledgement. Their typed name is the signature — it has
 * to be there, and it has to look like a name, not a stray keystroke.
 */
export function parseAcknowledgement(body: unknown): Parsed<{ name: string; comment: string }> {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = text(b.name, 120);
  if (name.replace(/[^\p{L}]/gu, "").length < 2) return { ok: false, error: "Type your full name to sign." };
  return { ok: true, value: { name, comment: longText(b.comment, 2000) } };
}

/* ---- backups ---- */

export type BackupPhoto = { url: string; filename: string; contentType: string; size: number };

export type BackupInspection = {
  kind: InspectionKind;
  /** YYYY-MM-DD */
  inspectedOn: string;
  note: string;
  /** ISO instants, or "" when not. */
  sharedAt: string;
  acknowledgedAt: string;
  acknowledgedName: string;
  tenantComment: string;
  items: { room: string; name: string; condition: Condition; note: string; photos: BackupPhoto[] }[];
};

const instant = (v: unknown): string => {
  if (typeof v !== "string" || !v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
};

/**
 * Inspections from a backup file, checked as the forms check them. A photo
 * comes back only if `acceptPhoto` vouches for its link (see
 * lib/backup-files), so a hand-edited file can't point a restored
 * inspection at someone else's stored file. An acknowledgement is kept only
 * with the name that signed it — a signature with no signer is no record.
 */
export function parseBackupInspections(
  raw: unknown,
  acceptPhoto: (url: string, key: string) => boolean,
  limit = 50
): BackupInspection[] {
  const out: BackupInspection[] = [];
  for (const r of (Array.isArray(raw) ? raw : []).slice(0, limit)) {
    const b = (r ?? {}) as Record<string, unknown>;
    const kind = normalizeKind(b.kind);
    const inspectedOn = typeof b.inspectedOn === "string" && isDay(b.inspectedOn) ? b.inspectedOn : "";
    if (!kind || !inspectedOn) continue;
    const items: BackupInspection["items"] = [];
    for (const rawItem of (Array.isArray(b.items) ? b.items : []).slice(0, MAX_ITEMS)) {
      const parsed = parseItemInput(rawItem);
      if (!parsed.ok) continue;
      const photos: BackupPhoto[] = [];
      for (const rawPhoto of (Array.isArray((rawItem as Record<string, unknown>)?.photos) ? (rawItem as { photos: unknown[] }).photos : []).slice(0, MAX_PHOTOS_PER_ITEM)) {
        const p = (rawPhoto ?? {}) as Record<string, unknown>;
        const url = typeof p.url === "string" ? p.url.slice(0, 1000) : "";
        const key = typeof p.key === "string" ? p.key.slice(0, 100) : "";
        if (!url || !acceptPhoto(url, key)) continue;
        photos.push({
          url,
          filename: text(p.filename, 200) || "photo",
          contentType: text(p.contentType, 100) || "image/jpeg",
          size: Math.max(0, Math.round(Number(p.size) || 0)),
        });
      }
      items.push({ ...parsed.value, photos });
    }
    const acknowledgedName = text(b.acknowledgedName, 120);
    const acknowledgedAt = acknowledgedName ? instant(b.acknowledgedAt) : "";
    out.push({
      kind,
      inspectedOn,
      note: longText(b.note, 2000),
      // Acknowledged means it was shared, whatever the file says.
      sharedAt: instant(b.sharedAt) || acknowledgedAt,
      acknowledgedAt,
      acknowledgedName: acknowledgedAt ? acknowledgedName : "",
      tenantComment: acknowledgedAt ? longText(b.tenantComment, 2000) : "",
      items,
    });
  }
  return out;
}
