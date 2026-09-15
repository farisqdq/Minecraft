// Schedule E style buckets, so a year's expenses export in categories an
// accountant recognizes. Rent income isn't categorized — there's only one
// "rents received" line on that form.
export const EXPENSE_CATEGORIES = [
  "Repairs & Maintenance",
  "Insurance",
  "Property Tax",
  "Mortgage Interest",
  "HOA / Condo Fees",
  "Utilities",
  "Management Fees",
  "Supplies",
  "Legal & Professional",
  "Other",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export function normalizeCategory(value: unknown): string | null {
  return typeof value === "string" && (EXPENSE_CATEGORIES as readonly string[]).includes(value)
    ? value
    : null;
}
