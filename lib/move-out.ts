/**
 * Settling a security deposit when a tenant leaves.
 *
 * A deposit is the tenant's money until the day they leave. Then it splits:
 * some can pay rent they still owe, some can cover damage beyond wear and
 * tear, and the rest goes back — within a deadline most states set between
 * 14 and 45 days, with an itemized list of whatever was kept. Money kept is
 * rental income on the day it's kept; money returned was never income.
 *
 * The rules this enforces are the ones a landlord gets wrong under time
 * pressure:
 *   - you can't keep more than you hold (anything beyond that is still owed
 *     by the tenant, and stays on their balance);
 *   - you can't apply the deposit to rent they don't owe.
 *
 * Pure: no database and no clock. Works in whole cents.
 */

import { MAX_AMOUNT } from "./money.ts";

export type DeductionKind = "rent" | "charge";

export type Deduction = { kind: DeductionKind; label: string; amount: number };

export type MoveOutInput = {
  /** YYYY-MM-DD */
  movedOutOn: string;
  /** YYYY-MM: the last month rent is charged for. */
  lastRentMonth: string;
  deductions: Deduction[];
  /** YYYY-MM-DD, or null when nothing is owed back and nothing was kept. */
  returnBy: string | null;
  forwardingAddress: string | null;
};

const toCents = (n: number) => Math.round(n * 100);
const toDollars = (c: number) => c / 100;

const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Most states land between 14 and 45 days; 30 is the common middle. */
export const DEFAULT_RETURN_DAYS = 30;

export const MAX_DEDUCTIONS = 20;

function validDay(s: unknown): s is string {
  if (typeof s !== "string" || !DAY_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** YYYY-MM-DD plus a number of days. */
export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function parseMoveOutInput(body: unknown): { ok: true; value: MoveOutInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!validDay(b.movedOutOn)) return { ok: false, error: "Enter the day they moved out." };
  const movedOutOn = b.movedOutOn;
  const lastRentMonth = typeof b.lastRentMonth === "string" ? b.lastRentMonth : "";
  if (!MONTH_RE.test(lastRentMonth)) return { ok: false, error: "Pick the last month rent is owed for." };

  const raw = Array.isArray(b.deductions) ? b.deductions : [];
  if (raw.length > MAX_DEDUCTIONS) return { ok: false, error: `At most ${MAX_DEDUCTIONS} deductions.` };
  const deductions: Deduction[] = [];
  for (const r of raw) {
    const d = (r ?? {}) as Record<string, unknown>;
    const amount = typeof d.amount === "number" ? d.amount : Number(d.amount);
    // A blank line in the form is nothing, not an error.
    if ((d.amount === "" || d.amount == null) && !(typeof d.label === "string" && d.label.trim())) continue;
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
      return { ok: false, error: "Each deduction needs an amount above zero." };
    }
    const kind: DeductionKind = d.kind === "rent" ? "rent" : "charge";
    const label = typeof d.label === "string" ? d.label.trim().slice(0, 120) : "";
    if (kind === "charge" && !label) {
      return { ok: false, error: "Say what each deduction is for — the tenant is owed an itemized list." };
    }
    deductions.push({ kind, label: label || "Unpaid rent", amount: toDollars(toCents(amount)) });
  }

  let returnBy: string | null = null;
  if (b.returnBy != null && b.returnBy !== "") {
    if (!validDay(b.returnBy)) return { ok: false, error: "That return-by date isn't valid." };
    if (b.returnBy < movedOutOn) return { ok: false, error: "The deposit can't be due back before they left." };
    returnBy = b.returnBy;
  }

  const forwardingAddress =
    typeof b.forwardingAddress === "string" ? b.forwardingAddress.trim().slice(0, 300) || null : null;

  return { ok: true, value: { movedOutOn, lastRentMonth, deductions, returnBy, forwardingAddress } };
}

export type Settlement = {
  deposit: number;
  /** Deposit applied to rent they owed. */
  rentApplied: number;
  /** Deposit kept for damage, cleaning and the like. */
  charges: number;
  /** Everything kept: rental income on the day of the move-out. */
  kept: number;
  /** What goes back to them. */
  refund: number;
  /** Rent they still owe once the deposit has paid what it can. */
  stillOwed: number;
};

/**
 * Works out where the deposit goes, or says why it can't go there.
 *
 * `owed` is what they owe on their statement through the last rent month,
 * before any of the deposit is applied.
 */
export function settle(
  deposit: number,
  owed: number,
  deductions: Deduction[]
): { ok: true; value: Settlement } | { ok: false; error: string } {
  const held = Math.max(0, toCents(deposit));
  const owedC = Math.max(0, toCents(owed));
  let rent = 0;
  let charges = 0;
  for (const d of deductions) {
    if (d.kind === "rent") rent += toCents(d.amount);
    else charges += toCents(d.amount);
  }
  const kept = rent + charges;
  if (kept > held) {
    return {
      ok: false,
      error: `Those deductions come to $${toDollars(kept).toFixed(2)}, more than the $${toDollars(held).toFixed(
        2
      )} deposit. Keep the whole deposit and leave the rest on their balance — it can't be taken twice.`,
    };
  }
  if (rent > owedC) {
    return {
      ok: false,
      error:
        owedC === 0
          ? "They don't owe any rent through that month, so none of the deposit can go to rent."
          : `They owe $${toDollars(owedC).toFixed(2)} in rent through that month, so no more than that can come out of the deposit for rent.`,
    };
  }
  return {
    ok: true,
    value: {
      deposit: toDollars(held),
      rentApplied: toDollars(rent),
      charges: toDollars(charges),
      kept: toDollars(kept),
      refund: toDollars(held - kept),
      stillOwed: toDollars(owedC - rent),
    },
  };
}

/**
 * The first suggestion for the form: put the deposit toward whatever rent
 * is owed, up to what's held. Charges for damage are the landlord's to add.
 */
export function suggestRentDeduction(deposit: number, owed: number): number {
  return toDollars(Math.max(0, Math.min(toCents(deposit), toCents(owed))));
}

export type ReturnState =
  | { kind: "none" }
  | { kind: "returned"; on: string }
  | { kind: "due"; days: number }
  | { kind: "overdue"; days: number };

/**
 * Where the deposit return stands on `today`. Nothing to do when no deposit
 * was held; otherwise it stays open until marked returned — even when the
 * whole deposit was kept, because the itemized list still has to go out.
 */
export function returnState(
  m: { deposit: number; returnBy: string | null; returnedOn: string | null },
  today: string
): ReturnState {
  if (m.returnedOn) return { kind: "returned", on: m.returnedOn };
  if (toCents(m.deposit) <= 0) return { kind: "none" };
  if (!m.returnBy) return { kind: "due", days: Infinity };
  const days = Math.round(
    (new Date(`${m.returnBy}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000
  );
  return days < 0 ? { kind: "overdue", days: -days } : { kind: "due", days };
}

/** "due in 4 days", "due today", "3 days overdue". */
export function returnLabel(state: ReturnState): string {
  switch (state.kind) {
    case "none":
      return "";
    case "returned":
      return "returned";
    case "overdue":
      return `${state.days} ${state.days === 1 ? "day" : "days"} overdue`;
    case "due":
      if (!Number.isFinite(state.days)) return "not returned yet";
      if (state.days === 0) return "due today";
      return `due in ${state.days} ${state.days === 1 ? "day" : "days"}`;
  }
}
