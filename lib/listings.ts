/**
 * Listing an empty place and taking applications for it.
 *
 * A vacancy is the costliest thing on a rent roll, and until now the app
 * could only say what one was costing. A listing is a page to send people
 * to — the place, the rent, when it's free, the photos already in the
 * filing cabinet — with an application form behind it, so applicants land
 * in the app rather than in a pile of texts, and the one chosen becomes the
 * tenant without typing them in again.
 *
 * The form asks what a landlord needs to decide and nothing a fair-housing
 * rule forbids: no age, family status, religion, origin, disability — and
 * no Social Security number or date of birth, which have no business in a
 * web form. Screening, if any, is the landlord's own step.
 *
 * Pure: no database and no clock.
 */

import { MAX_AMOUNT } from "./money.ts";

/** Letters and digits that can't be misread for each other. */
const CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const CODE_LENGTH = 10;

/** The listing's public address: unguessable, so a closed or private listing can't be stumbled on. */
export function newListingCode(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const bytes = random(CODE_LENGTH * 2);
  let out = "";
  for (const b of bytes) {
    // Rejection sampling keeps every character equally likely.
    if (b >= Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length) continue;
    out += CODE_ALPHABET[b % CODE_ALPHABET.length];
    if (out.length === CODE_LENGTH) return out;
  }
  return out.length === CODE_LENGTH ? out : newListingCode(random);
}

export const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

export const MAX_PHOTOS = 12;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function day(v: unknown): string | null {
  if (typeof v !== "string" || !ISO_DAY.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function optionalNumber(v: unknown, min: number, max: number, step = 0.5): number | null | "bad" {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return "bad";
  return Math.round(n / step) * step;
}

export type ListingInput = {
  headline: string;
  description: string;
  rent: number;
  deposit: number;
  availableOn: string | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  pets: string;
  photoIds: string[];
};

export function parseListing(body: unknown): { ok: true; value: ListingInput } | { ok: false; error: string } {
  const o = (body ?? {}) as Record<string, unknown>;
  const headline = text(o.headline, 120);
  if (!headline) return { ok: false, error: "Give the listing a headline — what someone scrolling would want to know first." };
  const rent = Number(o.rent);
  if (!Number.isFinite(rent) || rent <= 0 || rent > MAX_AMOUNT) return { ok: false, error: "Enter the monthly rent." };
  const deposit = o.deposit === "" || o.deposit === undefined ? 0 : Number(o.deposit);
  if (!Number.isFinite(deposit) || deposit < 0 || deposit > MAX_AMOUNT) return { ok: false, error: "The deposit has to be zero or more." };
  const availableOn = o.availableOn ? day(o.availableOn) : null;
  if (o.availableOn && !availableOn) return { ok: false, error: "That available date isn't a date." };
  const beds = optionalNumber(o.beds, 0, 20);
  const baths = optionalNumber(o.baths, 0, 20);
  const sqft = optionalNumber(o.sqft, 0, 100_000, 1);
  if (beds === "bad" || baths === "bad" || sqft === "bad") return { ok: false, error: "Bedrooms, bathrooms and square feet have to be sensible numbers." };
  const photoIds = Array.isArray(o.photoIds)
    ? [...new Set(o.photoIds.filter((p): p is string => typeof p === "string" && p.length > 0 && p.length < 40))].slice(0, MAX_PHOTOS)
    : [];
  return {
    ok: true,
    value: {
      headline,
      description: text(o.description, 4000),
      rent: Math.round(rent * 100) / 100,
      deposit: Math.round(deposit * 100) / 100,
      availableOn,
      beds,
      baths,
      sqft,
      pets: text(o.pets, 120),
      photoIds,
    },
  };
}

export type ApplicationInput = {
  name: string;
  email: string;
  phone: string;
  moveIn: string | null;
  occupants: number;
  income: number | null;
  employer: string;
  currentAddress: string;
  landlordName: string;
  landlordPhone: string;
  pets: string;
  message: string;
};

/**
 * Checks an application from the public form. `spam: true` means the hidden
 * field a person never sees was filled in: the caller pretends it worked
 * and stores nothing, so a bot learns nothing from the answer.
 */
export function parseApplication(
  body: unknown,
  today: string
): { ok: true; value: ApplicationInput } | { ok: false; error: string } | { ok: false; spam: true } {
  const o = (body ?? {}) as Record<string, unknown>;
  if (text(o.website, 200)) return { ok: false, spam: true };
  const name = text(o.name, 120);
  if (!name) return { ok: false, error: "Your name, please." };
  const email = text(o.email, 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "That email doesn't look right." };
  const phone = text(o.phone, 40);
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return { ok: false, error: "A phone number we can reach you on, with the area code." };
  const moveIn = o.moveIn ? day(o.moveIn) : null;
  if (o.moveIn && !moveIn) return { ok: false, error: "That move-in date isn't a date." };
  if (moveIn && moveIn < today) return { ok: false, error: "The move-in date has already passed." };
  const occupants = o.occupants === undefined || o.occupants === "" ? 1 : Number(o.occupants);
  if (!Number.isInteger(occupants) || occupants < 1 || occupants > 20) return { ok: false, error: "How many people would live there?" };
  const income = o.income === undefined || o.income === "" ? null : Number(String(o.income).replace(/[$,\s]/g, ""));
  if (income !== null && (!Number.isFinite(income) || income < 0 || income > 1_000_000)) {
    return { ok: false, error: "Enter monthly income as a number, before tax." };
  }
  if (o.consent !== true) return { ok: false, error: "Please confirm what you've written is true and that references may be contacted." };
  return {
    ok: true,
    value: {
      name,
      email,
      phone,
      moveIn,
      occupants,
      income: income === null ? null : Math.round(income * 100) / 100,
      employer: text(o.employer, 120),
      currentAddress: text(o.currentAddress, 300),
      landlordName: text(o.landlordName, 120),
      landlordPhone: text(o.landlordPhone, 40),
      pets: text(o.pets, 200),
      message: text(o.message, 2000),
    },
  };
}

/** Monthly income as a multiple of the rent — "3.1×" — the first thing most landlords look at. */
export function incomeMultiple(income: number | null, rent: number): number | null {
  if (income === null || !(rent > 0)) return null;
  return Math.round((income / rent) * 10) / 10;
}

/** "Studio", "1 bed", "2.5 beds". */
export function bedsLabel(beds: number | null): string {
  if (beds === null) return "";
  if (beds === 0) return "Studio";
  return `${beds} ${beds === 1 ? "bed" : "beds"}`;
}

export function bathsLabel(baths: number | null): string {
  if (baths === null) return "";
  return `${baths} ${baths === 1 ? "bath" : "baths"}`;
}

/**
 * The approved applicant's lease, as the approval form starts it: from the
 * move-in date they asked for (or when the place is free, or today, whichever
 * is latest), for twelve months.
 */
export function approvalDefaults(o: { moveIn: string | null; availableOn: string | null; today: string }): { leaseStart: string; leaseEnd: string } {
  const candidates = [o.today, o.availableOn ?? "", o.moveIn ?? ""].filter(Boolean).sort();
  const start = candidates[candidates.length - 1];
  const [y, m, d] = start.split("-").map(Number);
  // A year on, less a day: Mar 15 → Mar 14 next year; Mar 1 → Feb 28/29.
  const end = new Date(Date.UTC(y + 1, m - 1, d) - 86_400_000);
  return { leaseStart: start, leaseEnd: end.toISOString().slice(0, 10) };
}

export const APPLICATION_STATUSES = ["new", "reviewing", "approved", "declined"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const STATUS_LABEL: Record<ApplicationStatus, string> = {
  new: "New",
  reviewing: "Reviewing",
  approved: "Approved",
  declined: "Declined",
};
