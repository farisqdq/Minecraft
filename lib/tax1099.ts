/**
 * Who needs a 1099-NEC from an LLC for a year, from the vendor book.
 *
 * A rental business that pays a person or partnership for services over the
 * year's threshold files a 1099-NEC for them by January 31st. Most small
 * landlords find this out from a penalty notice. The vendor book already
 * knows who was paid what; this says who crosses the line, who is exempt,
 * and whose W-9 is missing — the form with the tax ID the 1099 needs.
 *
 * The rules kept here are the ones that decide most cases, and the page says
 * what it can't know: whether a payment went by card or PayPal (reported by
 * the processor on a 1099-K instead), and whether a bill was for goods only.
 * Not tax advice.
 *
 * Pure: no database and no clock.
 */

export const TAX_CLASSES = ["individual", "partnership", "corporation"] as const;
export type TaxClass = (typeof TAX_CLASSES)[number];

export const TAX_CLASS_LABEL: Record<TaxClass | "", string> = {
  "": "Not known yet",
  individual: "Individual, sole proprietor or single-member LLC",
  partnership: "Partnership or multi-member LLC",
  corporation: "Corporation (C or S, or an LLC taxed as one)",
};

export function normalizeTaxClass(value: unknown): TaxClass | null {
  return typeof value === "string" && (TAX_CLASSES as readonly string[]).includes(value) ? (value as TaxClass) : null;
}

/**
 * The reporting threshold for payments made in a year: $600 through 2025,
 * $2,000 from 2026 under the 2025 tax law (indexed for inflation after
 * 2026 — the IRS publishes the figure; until it does, $2,000 stands).
 */
export function threshold1099(year: number): number {
  return year <= 2025 ? 600 : 2000;
}

/** January 31st after the tax year — or the Monday after, when it falls on a weekend. */
export function due1099(year: number): string {
  const d = new Date(Date.UTC(year + 1, 0, 31));
  const dow = d.getUTCDay();
  if (dow === 6) d.setUTCDate(d.getUTCDate() + 2);
  if (dow === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export type Row1099 = {
  vendorId: string;
  name: string;
  taxClass: TaxClass | null;
  total: number;
  /** Of the total, what was filed under Legal & Professional — attorneys get a 1099 even as a corporation. */
  legal: number;
  w9: boolean;
  /** file: a 1099-NEC is due. exempt: over the line but a corporation. check: can't tell yet. below: under the line. */
  status: "file" | "exempt" | "check" | "below";
  why: string;
};

const cents = (n: number) => Math.round(n * 100);

export function rows1099(
  vendors: { id: string; name: string; taxClass: TaxClass | null }[],
  payments: { vendorId: string; amount: number; category: string }[],
  w9: Set<string>,
  year: number
): Row1099[] {
  const line = cents(threshold1099(year));
  const totals = new Map<string, { total: number; legal: number }>();
  for (const p of payments) {
    const t = totals.get(p.vendorId) ?? { total: 0, legal: 0 };
    t.total += cents(p.amount);
    if (p.category === "Legal & Professional") t.legal += cents(p.amount);
    totals.set(p.vendorId, t);
  }
  const order = { file: 0, check: 1, exempt: 2, below: 3 };
  return vendors
    .filter((v) => (totals.get(v.id)?.total ?? 0) > 0)
    .map((v): Row1099 => {
      const t = totals.get(v.id)!;
      const base = { vendorId: v.id, name: v.name, taxClass: v.taxClass, total: t.total / 100, legal: t.legal / 100, w9: w9.has(v.id) };
      if (t.total < line) return { ...base, status: "below", why: `Under the $${(line / 100).toLocaleString("en-US")} line.` };
      if (v.taxClass === "corporation") {
        if (t.legal >= line) {
          return { ...base, status: "file", why: "Paid for legal services — an attorney gets a 1099-NEC even as a corporation." };
        }
        return { ...base, status: "exempt", why: "A corporation doesn't get a 1099-NEC." };
      }
      if (!v.taxClass) {
        return {
          ...base,
          status: "check",
          why: base.w9 ? "Their W-9 is on file — set their tax class from it." : "Get their W-9: it says whether they need one, and gives the tax ID if they do.",
        };
      }
      return {
        ...base,
        status: "file",
        why: base.w9 ? "1099-NEC due." : "1099-NEC due — and their W-9 isn't on file, which has the tax ID you'll need.",
      };
    })
    .sort((a, b) => order[a.status] - order[b.status] || b.total - a.total || a.name.localeCompare(b.name));
}
