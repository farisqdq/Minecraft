/**
 * The vendor book: who you call to fix things.
 *
 * Pure helpers only — no database — so the matching can be tested on its own.
 */

export const TRADES = [
  "Plumbing",
  "HVAC",
  "Electrical",
  "Appliance repair",
  "Roofing",
  "Locksmith",
  "Pest control",
  "Paving & lot",
  "Signs",
  "Cleaning",
  "Landscaping",
  "General",
] as const;

export type Trade = (typeof TRADES)[number];

export type VendorDTO = {
  id: string;
  companyId: string;
  name: string;
  trade: Trade;
  phone: string;
  email: string;
  note: string;
  /** Repairs they've been put on, ever. */
  jobs: number;
  /** Expenses booked to them, all time. */
  spent: number;
  /** The same, this calendar year — what an accountant asks for. */
  spentThisYear: number;
  lastUsed: string;
};

export function normalizeTrade(value: unknown): Trade {
  if (typeof value !== "string") return "General";
  const hit = TRADES.find((t) => t.toLowerCase() === value.trim().toLowerCase());
  return hit ?? "General";
}

/**
 * Which trade a repair category calls for. A category with no obvious trade
 * ("Other", "Common area") maps to General, which is the handyman.
 */
const TRADE_FOR_CATEGORY: Record<string, Trade> = {
  "Plumbing": "Plumbing",
  "Heating / AC": "HVAC",
  "Electrical": "Electrical",
  "Appliance": "Appliance repair",
  "Roof / leak": "Roofing",
  "Doors, windows & locks": "Locksmith",
  "Pests": "Pest control",
  "Parking lot / exterior": "Paving & lot",
  "Signage": "Signs",
};

export function tradeFor(category: string): Trade {
  return TRADE_FOR_CATEGORY[category] ?? "General";
}

/**
 * The vendor list for a repair, best first: the right trade, then the
 * handyman, then everyone else — each group led by whoever you used most
 * recently, because that is usually who you'd call again.
 *
 * Nobody is hidden. A plumber who also does electrical is still one tap
 * away; this only decides what's at the top.
 */
export function rankForRepair<T extends { trade: string; name: string; lastUsed: string }>(
  vendors: T[],
  category: string
): T[] {
  const want = tradeFor(category);
  const tier = (v: T) => (v.trade === want ? 0 : v.trade === "General" ? 1 : 2);
  return [...vendors].sort(
    (a, b) =>
      tier(a) - tier(b) ||
      (b.lastUsed || "").localeCompare(a.lastUsed || "") ||
      a.name.localeCompare(b.name)
  );
}

/** Rough check that a phone number is something you could actually dial. */
export function phoneProblem(phone: string): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return "That phone number doesn't look complete.";
  return "";
}
