/**
 * Ranking for the Command Center's ⌘K search — the same order as the Classic
 * top-bar search (app/components/PropertySearch.tsx), so both layouts find
 * the same property first for the same words. Pure, for node's test runner.
 */

export type SearchHit = {
  id: string;
  name: string;
  address: string;
  company: string;
  units: string[];
  tenants: string[];
};

/** Name starts with it, a word in the name does, the name contains it, then tenant, address, unit, LLC. */
export function rankHits(items: readonly SearchHit[], query: string, max = 7): SearchHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const scored: { hit: SearchHit; score: number }[] = [];
  for (const hit of items) {
    const name = hit.name.toLowerCase();
    let score = -1;
    if (name.startsWith(needle)) score = 0;
    else if (name.split(/\s+/).some((w) => w.startsWith(needle))) score = 1;
    else if (name.includes(needle)) score = 2;
    else if (hit.tenants.some((t) => t.toLowerCase().includes(needle))) score = 3;
    else if (hit.address.toLowerCase().includes(needle)) score = 4;
    else if (hit.units.some((u) => u.toLowerCase().includes(needle))) score = 5;
    else if (hit.company.toLowerCase().includes(needle)) score = 6;
    if (score >= 0) scored.push({ hit, score });
  }
  scored.sort((a, b) => a.score - b.score || a.hit.name.localeCompare(b.hit.name));
  return scored.slice(0, max).map((s) => s.hit);
}

/** The line under a hit saying why it matched, in the ranking's order. */
export function hitReason(hit: SearchHit, query: string): string {
  const q = query.trim().toLowerCase();
  if (!hit.name.toLowerCase().includes(q)) {
    const tenant = hit.tenants.find((t) => t.toLowerCase().includes(q));
    if (tenant) return tenant;
    if (hit.address.toLowerCase().includes(q)) return hit.address;
    const unit = hit.units.find((u) => u.toLowerCase().includes(q));
    if (unit) return `${unit} · ${hit.company}`;
    if (hit.company.toLowerCase().includes(q)) return hit.company;
  }
  return hit.address || hit.company;
}

/** "Jordan Lee" -> "JL", "sam@x.com" -> "S": the account block's avatar. */
export function initialsOf(label: string): string {
  const clean = label.replace(/@.*$/, "").trim();
  if (!clean) return "?";
  const words = clean.split(/[\s._-]+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0][0];
  return letters.toUpperCase();
}
