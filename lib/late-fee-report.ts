/**
 * One line per tenant after a late-fee run: what was charged, or exactly why
 * nothing was. Pure, so every reason is tested; lib/late-fees-db.ts gathers
 * the facts.
 *
 * "Why nothing" has to say which thing to fix, because the fixes are in
 * different places: a tenant on the wrong rent target is fixed on their
 * card, a policy saved on the wrong LLC on the Team page, a statement that
 * starts too late on the statement. "Marked vacant" for all three sent an
 * owner looking at the vacancy checkbox of a place nobody had marked vacant.
 */
import { money } from "./money.ts";
import { monthName } from "./notices.ts";
import { feeDueAt } from "./charge-rules.ts";
import type { LateFeeMode } from "./late-fee-policy.ts";

export type LateFeeFacts = {
  tenantName: string;
  mode: LateFeeMode;
  policyOn: boolean;
  /** Tenant on their own rules: whether any active late rule exists. */
  ownLateRule: boolean;
  /** Late fees written by this run. */
  added: number;
  /** The same, by month, when more than one month was charged. */
  addedByMonth?: Record<string, number>;
  /** Late fees on the books for the month being chased, after the run. */
  feesThisMonth: number;
  /** The month being chased: the oldest unpaid month, or the current one. */
  month: string;
  balance: number;
  rentThisMonth: number;
  dueDay: number;
  graceDays: number;
  /** YYYY-MM-DD */
  today: string;
  /** Set when the statement can't tell whose rent is whose. */
  problem: string;
  /** Late fees for the month would exceed nothing more: the cap is reached. */
  capped: boolean;

  /** Marked moved out (or otherwise not current). Absent means current. */
  active?: boolean;
  /** The LLC the tenant's property is under. */
  companyName?: string;
  /** Other LLCs of the same team whose policy is on, when this one's isn't. */
  policyOnFor?: string[];
  /** Tenant on their own rules: the active late rules, with their bounds. */
  ownRules?: { label: string; startMonth: string | null; endMonth: string | null }[];
  /** YYYY-MM the statement starts at, and whether the landlord pinned it. */
  startMonth?: string;
  startPinned?: boolean;
  /** The place the statement is for (lib/statements.ts, `place`). */
  place?: { label: string; wholeProperty: boolean; vacant: boolean; vacantSince: string | null; rentSet: number };
  /** Tenant on the whole property of a multi-unit one: the units that carry rent. */
  unitsWithRent?: string[];
  /** Other active tenants on the same place. */
  sharedWith?: string[];
  /** Rent dated in the month being chased. */
  paidThisMonth?: number;
  /** Late fees the rules in force charged for the month and someone since deleted. */
  deletedThisMonth?: number;
};

export type LateFeeLine = { tenantName: string; tone: "charged" | "none" | "check"; text: string };

export function lateFeeLine(f: LateFeeFacts): LateFeeLine {
  const who = f.tenantName;
  const line = (tone: LateFeeLine["tone"], text: string): LateFeeLine => ({ tenantName: who, tone, text });
  const month = monthName(f.month);
  const ownRulesNote = f.mode === "custom" && f.policyOn ? " — under their own late-fee rules, not the LLC's policy" : "";

  if (f.added > 0.005) {
    const months = Object.entries(f.addedByMonth ?? {}).filter(([, v]) => v > 0.005).sort(([a], [b]) => a.localeCompare(b));
    const detail =
      months.length > 1
        ? months.map(([m, v]) => `${money(v)} for ${monthName(m)}`).join(", ")
        : `${money(f.feesThisMonth)} for ${month} so far`;
    return line("charged", `${money(f.added)} in late fees added now (${detail})${ownRulesNote}.`);
  }
  if (f.active === false) {
    return line("none", "Marked moved out, so their books are closed and no late fees are added. If they still rent here, mark them current on their card.");
  }
  if (f.mode === "off") return line("none", "Set to no late fees on their account.");
  if (f.mode === "custom" && !f.ownLateRule) {
    return line("check", "Set to their own late-fee rules, but none is active — so nothing is charged. Switch them to the LLC's policy on their statement.");
  }
  if (f.mode === "custom" && f.ownRules && f.ownRules.length > 0 && !f.ownRules.some((r) => covers(r, f.month))) {
    const r = f.ownRules[0];
    const why = r.endMonth && r.endMonth < f.month ? `ended ${monthName(r.endMonth)}` : `starts ${monthName(r.startMonth ?? "")}`;
    return line(
      "check",
      `Set to their own late-fee rules, and none covers ${month} ("${r.label}" ${why}) — so nothing is charged. Switch them to the LLC's policy on their statement, or change the rule's months.`
    );
  }
  if (f.mode === "default" && !f.policyOn) {
    const llc = f.companyName ? `${f.companyName}, the LLC this property is under` : "the LLC this property is under";
    const elsewhere = f.policyOnFor?.length
      ? ` The policy is on for ${list(f.policyOnFor)}, not this one — turn it on for ${f.companyName ?? "this LLC"} on the Team page.`
      : "";
    return line(elsewhere ? "check" : "none", `Late fees are switched off for ${llc}.${elsewhere}`);
  }
  if (f.startMonth && f.startMonth > f.month) {
    return line(
      "check",
      `Their statement starts in ${monthName(f.startMonth)}${f.startPinned ? " (set on their statement)" : ""}, so ${month}'s rent isn't on it and can't be late. Change where their books start on their statement.`
    );
  }
  if (f.sharedWith?.length) {
    const place = f.place ? placeName(f.place) : "the same place";
    return line(
      "check",
      `No late fee while ${list([who, ...f.sharedWith])} are ${f.sharedWith.length === 1 ? "both" : "all"} on ${place}: there's no telling whose rent is late, and each would be billed for the same rent. Give each one their own unit, or mark whoever left as moved out.`
    );
  }
  if (f.problem) return line("check", f.problem);
  if (!(f.rentThisMonth > 0)) return line(f.place?.vacant ? "none" : "check", noRentText(f, month));
  if (f.balance <= 0.005) {
    const paid = f.paidThisMonth ?? f.rentThisMonth;
    return paid < f.rentThisMonth - 0.005
      ? line(
          "none",
          `Nothing owed: ${month}'s ${money(f.rentThisMonth)} is covered by earlier payments or a credit on their statement, though ${
            paid > 0.005 ? `only ${money(paid)} is` : "no rent is"
          } dated in ${month}.`
        )
      : line("none", "Paid up — nothing owed.");
  }
  const firstLate = feeDueAt(f.month, f.dueDay, f.graceDays);
  if (firstLate && firstLate.toISOString().slice(0, 10) > f.today) {
    const on = firstLate.toISOString().slice(0, 10);
    return line(
      "none",
      `${money(f.balance)} owed, still inside the grace period (rent due on the ${ordinal(f.dueDay)}, ${f.graceDays} ${f.graceDays === 1 ? "day" : "days"}' grace) — the fee applies on ${formatShort(on)} if it's still unpaid.`
    );
  }
  if (f.capped || f.feesThisMonth > 0.005) {
    return line(
      "none",
      f.capped
        ? `${money(f.feesThisMonth)} in late fees for ${month} already — the most the month can carry${ownRulesNote}.`
        : `${money(f.feesThisMonth)} in late fees for ${month} so far; nothing more is due today${ownRulesNote}.`
    );
  }
  if ((f.deletedThisMonth ?? 0) > 0.005) {
    return line(
      "check",
      `${money(f.deletedThisMonth ?? 0)} in late fees for ${month} was charged and then deleted from their statement, and a deleted fee isn't charged again. If that was a mistake, add it back as a charge on their statement.`
    );
  }
  return line("check", `${money(f.balance)} owed, but no late fee applies to it — the debt predates the rent on the books (an opening balance), which late fees don't cover.`);
}

/**
 * Why a month expects no rent, in the three ways that happens: the place is
 * marked vacant, the tenant is on the whole property while the rent is set
 * on a unit, or no rent is set where they are.
 */
function noRentText(f: LateFeeFacts, month: string): string {
  const place = f.place;
  if (place?.vacant) {
    const since = place.vacantSince ? ` (since ${formatShort(place.vacantSince)})` : "";
    return `No rent is expected for ${month}: ${placeName(place)} is marked vacant${since}, so no late fee. If they still rent it, clear Vacant on the card.`;
  }
  if (place?.wholeProperty && f.unitsWithRent?.length) {
    const units = f.unitsWithRent.map(unitName);
    return units.length === 1
      ? `Their statement expects $0 rent for ${month}: they're on the whole property, but the rent is set on ${units[0]}. Assign them to ${f.unitsWithRent[0]} on their card.`
      : `Their statement expects $0 rent for ${month}: they're on the whole property, but the rent is set on ${list(units)}. Assign them to their unit on their card.`;
  }
  if (place) {
    return place.rentSet > 0
      ? `Their statement expects $0 rent for ${month} (the rent history for ${placeName(place)} says $0 then), so no late fee. Check the rent history on the card.`
      : `No rent is set for ${placeName(place)}, so there's no rent to be late with. Set the monthly rent on the card.`;
  }
  return `No rent is expected for ${month}, so no late fee.`;
}

const covers = (r: { startMonth: string | null; endMonth: string | null }, month: string) =>
  !(r.startMonth && month < r.startMonth) && !(r.endMonth && month > r.endMonth);

const unitName = (name: string) => (/^unit\b/i.test(name) ? name : `unit ${name}`);
const placeName = (p: { label: string; wholeProperty: boolean }) => (p.wholeProperty ? "the property" : unitName(p.label));

function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

function formatShort(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
