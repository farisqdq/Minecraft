/**
 * What each line of a bank statement probably is.
 *
 * The point of importing a statement is not to type less once; it's that
 * the second month should be nearly no typing at all. So the strongest
 * signal is what you did last time: a payee you filed before goes where you
 * filed it. After that, things the app already knows — a tenant's name on
 * a Zelle, a place's rent to the cent, a recurring bill's amount, a vendor
 * in the book — and only then a guess at the category from the words.
 *
 * Three things are deliberately *not* suggested for import, because each
 * would put a wrong number in the books:
 *
 *  - a line that's already in the ledger (typed in by hand last week, or
 *    imported from an earlier upload) — counting it twice doubles it;
 *  - a mortgage payment — it is principal, interest and escrow under one
 *    number, and the loan on the property page splits it properly;
 *  - a security deposit — money held isn't income.
 *
 * Every suggestion carries a sentence saying why, because a person checking
 * forty lines needs to see at a glance which ones to doubt.
 *
 * Pure: no database and no clock.
 */

import { rentForMonth, type RentChangeDTO } from "./rent.ts";
import { rentNote } from "./quick-record.ts";
import { money } from "./money.ts";

export type ImportRow = { ref: string; date: string; amount: number; text: string };

/** Somewhere rent is paid: a house, or a unit of a building. */
export type Place = {
  propertyId: string;
  unitId: string | null;
  label: string;
  /** Today's rent; the history in `rentChanges` says what it was in earlier months. */
  rent: number;
  vacant: boolean;
};

export type TenantLite = {
  id: string;
  name: string;
  propertyId: string;
  unitId: string | null;
  deposit: number;
  /** YYYY-MM-DD or "". */
  leaseStart: string;
};

export type LedgerLite = {
  id: string;
  type: "rent" | "expense";
  date: string;
  amount: number;
  propertyId: string;
  unitId: string | null;
  detail: string;
  category: string;
  vendorId: string | null;
  recurringExpenseId: string | null;
  /** Set on entries an earlier import wrote. */
  bankRef: string | null;
};

/** An entry an earlier import wrote, with the bank's words it came from. */
export type Learned = {
  bankText: string;
  type: "rent" | "expense";
  date: string;
  amount: number;
  propertyId: string;
  unitId: string | null;
  category: string;
  detail: string;
  vendorId: string | null;
};

export type VendorLite = { id: string; name: string };

export type RecurringLite = {
  id: string;
  propertyId: string;
  unitId: string | null;
  category: string;
  detail: string;
  amount: number;
  frequency: "monthly" | "yearly";
  /** For a yearly bill, 1-12. */
  month: number | null;
  active: boolean;
};

export type LoanLite = {
  id: string;
  propertyId: string;
  lender: string;
  /** Principal and interest. */
  payment: number;
  /** Escrow, monthly. */
  escrow: number;
  active: boolean;
};

export type MatchContext = {
  properties: { id: string; name: string }[];
  places: Place[];
  rentChanges: RentChangeDTO[];
  tenants: TenantLite[];
  /** Entries near the statement's dates — enough to find duplicates. */
  ledger: LedgerLite[];
  learned: Learned[];
  vendors: VendorLite[];
  recurring: RecurringLite[];
  loans: LoanLite[];
};

export type Status =
  /** Nothing stands in the way of importing it. */
  | "new"
  /** An earlier upload already wrote this exact line. */
  | "imported"
  /** The same amount is in the ledger within a few days. */
  | "duplicate"
  | "mortgage"
  | "deposit"
  | "transfer";

export type Suggestion = {
  ref: string;
  action: "rent" | "expense" | "skip";
  /** sure: from your own past choice or something exact. guess: worth a look. none: nothing to go on. */
  confidence: "sure" | "guess" | "none";
  status: Status;
  propertyId: string;
  unitId: string | null;
  category: string;
  detail: string;
  note: string;
  vendorId: string | null;
  recurringExpenseId: string | null;
  why: string;
  duplicateOf?: { id: string; date: string; amount: number; detail: string };
};

/** How far apart a bank date and a typed-in date can be and still be the same money. */
export const DUPLICATE_DAYS = 4;

const cents = (n: number) => Math.round(Math.abs(n) * 100);

/** Words in a bank line that say nothing about who was paid. */
const MARKERS = new Set(["REF", "CONF", "CONFIRMATION", "ID", "TRACE", "TRN", "TXN", "INDN", "CO", "SEC"]);
const NOISE = new Set(["#", "PPD", "CCD", "WEB", "TEL", "POS", "ON", "AT", "VIA", "THE"]);
const PREFIXES = [
  "PURCHASE AUTHORIZED",
  "RECURRING PAYMENT AUTHORIZED",
  "DEBIT CARD PURCHASE",
  "CHECKCARD",
  "CHECK CARD PURCHASE",
  "POS PURCHASE",
  "POS DEBIT",
  "ACH DEBIT",
  "ACH CREDIT",
  "ACH WITHDRAWAL",
  "ACH DEPOSIT",
  "ELECTRONIC WITHDRAWAL",
  "ELECTRONIC DEPOSIT",
  "EXTERNAL WITHDRAWAL",
  "EXTERNAL DEPOSIT",
  "PREAUTHORIZED DEBIT",
];

/**
 * The part of a bank line that names who the money went to or came from,
 * without the dates, reference numbers and card digits that change every
 * month: "LG&E WEB PYMT 093026 XXXXX1234" and next month's
 * "LG&E WEB PYMT 102826 XXXXX1234" are both "LG&E PYMT".
 */
export function payeeKey(text: string): string {
  const words = text
    .toUpperCase()
    .replace(/'/g, "")
    .replace(/[^A-Z0-9&#]+/g, " ")
    .replace(/#/g, " # ")
    .split(/\s+/)
    .filter(Boolean);
  const kept: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (MARKERS.has(w)) {
      // The marker and the code after it ("REF # PP0KX", "CONF 8KD8F").
      while (words[i + 1] === "#") i++;
      i++;
      continue;
    }
    if (NOISE.has(w) || /\d/.test(w) || /^X+$/.test(w) || (w.length === 1 && w !== "&")) continue;
    kept.push(w);
  }
  let joined = kept.join(" ");
  for (const p of PREFIXES) {
    if (joined.startsWith(p + " ")) {
      joined = joined.slice(p.length + 1);
      break;
    }
  }
  return joined.split(" ").slice(0, 6).join(" ");
}

/** The words of a bank line, padded so a whole-word test is an `includes`. */
function wordsOf(text: string): string {
  return ` ${text.toUpperCase().replace(/[^A-Z0-9&]+/g, " ").trim()} `;
}

const NAME_STOP = new Set(["LLC", "INC", "CO", "CORP", "THE", "AND", "OF", "LTD", "DBA", "MR", "MRS", "MS", "DR", "JR", "SR", "II", "III"]);

function nameTokens(name: string): string[] {
  return name
    .toUpperCase()
    .replace(/[^A-Z&]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !NAME_STOP.has(t));
}

/** Whether every meaningful word of a name is in the line. A one-word name must be long enough to mean something. */
function fullNameIn(name: string, words: string): boolean {
  const tokens = nameTokens(name);
  if (tokens.length === 0) return false;
  if (tokens.length === 1 && tokens[0].length < 5) return false;
  return tokens.every((t) => words.includes(` ${t} `));
}

/** Schedule E categories from the words alone. Specific names before general ones. */
const KEYWORDS: [RegExp, string][] = [
  [/\b(LG&E|KU ENERGY|KENTUCKY UTILITIES|KENTUCKY AMERICAN WATER|DUKE ENERGY|COLUMBIA GAS|ATMOS|AEP|GAS & ELECTRIC|ELECTRIC CO ?OP|WATER (CO|COMPANY|DEPT|SERVICE|WORKS|DISTRICT)|SEWER|SANITATION|SANITATION DISTRICT|WASTE|TRASH|RUMPKE|REPUBLIC SERVICES|SPECTRUM|COMCAST|XFINITY|WINDSTREAM|UTILIT(Y|IES))\b/, "Utilities"],
  [/\b(INSURANCE|INS PREM|STATE FARM|ALLSTATE|PROGRESSIVE|GEICO|NATIONWIDE|LIBERTY MUTUAL|FARMERS INS|FARM BUREAU|TRAVELERS|ERIE INS|AMERICAN FAMILY|HARTFORD|CINCINNATI INS|OBSIDIAN|STEADILY|NATIONAL GENERAL|LEMONADE)\b/, "Insurance"],
  [/\b(PROPERTY TAX|PROP TAX|REAL ESTATE TAX|COUNTY CLERK|SHERIFF|TAX COLLECTOR|TREASURER|PVA)\b/, "Property Tax"],
  [/\b(HOA|HOMEOWNERS ASSOC\w*|CONDO ASSOC\w*|ASSOCIATION DUES|OWNERS ASSOCIATION)\b/, "HOA / Condo Fees"],
  [/\b(PROPERTY MANAGEMENT|PROPERTY MGMT|MANAGEMENT FEE|MGMT FEE)\b/, "Management Fees"],
  [/\b(LAW (FIRM|OFFICE|GROUP)|ATTORNEY|LEGAL|CPA|ACCOUNTING|BOOKKEEPING)\b/, "Legal & Professional"],
  [/\b(HOME DEPOT|LOWES|LOWE S|MENARDS|ACE HARDWARE|TRUE VALUE|SHERWIN|HARBOR FREIGHT|GRAINGER|FERGUSON)\b/, "Supplies"],
  [/\b(PLUMB\w*|HVAC|HEATING|AIR CONDITIONING|ROOFING|PEST|TERMINIX|ORKIN|LOCKSMITH|LANDSCAP\w*|LAWN|HANDYMAN|CONSTRUCTION|PAINTING|CLEANING|CARPET|APPLIANCE|ELECTRICIAN|ELECTRICAL)\b/, "Repairs & Maintenance"],
  [/\b(SERVICE FEE|MONTHLY MAINTENANCE FEE|ACCOUNT FEE|WIRE FEE|OVERDRAFT)\b/, "Other"],
];

export function categoryFromWords(text: string): string | null {
  const words = wordsOf(text);
  for (const [re, category] of KEYWORDS) if (re.test(words)) return category;
  return null;
}

/** Money moving between the landlord's own accounts — neither income nor an expense. */
const TRANSFER = /\b(TRANSFER|XFER|TFR)\b|\bPAYMENT THANK YOU\b|\b(CREDIT CARD|CARD) (PAYMENT|PYMT)\b|\bCRCARDPMT\b|\bAUTOPAY PAYMENT\b/;

function dayNumber(iso: string): number {
  return Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000);
}

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** "HOME DEPOT LEXINGTON KY" → "Home Depot Lexington KY"; "LG&E" and two-letter words stay as written. */
function titleCase(s: string): string {
  return s
    .split(" ")
    .map((w) => (w.length <= 2 || w.includes("&") ? w : w[0] + w.slice(1).toLowerCase()))
    .join(" ");
}

/**
 * Words that on their own name no payee: "MOBILE DEPOSIT", "CHECK", "ATM
 * DEPOSIT". Every tenant's paper cheque arrives as the same "MOBILE DEPOSIT",
 * so a key made only of these can't say whose money it is.
 */
const GENERIC = new Set([
  "MOBILE", "DEPOSIT", "DEPOSITS", "DEP", "REMOTE", "ONLINE", "BRANCH", "ATM", "CHECK", "CHECKS", "CHK", "CK",
  "COUNTER", "CREDIT", "DEBIT", "TELLER", "EDEPOSIT", "IN", "BY", "PAYMENT", "PMT", "ACH", "WITHDRAWAL", "POS",
  "CASH", "ITEM", "SHARE", "DRAFT", "FROM", "TO", "CARD", "PURCHASE", "MISC", "OTHER", "PAID", "RECEIVED",
]);

/** Whether a payee key names nobody in particular. */
export function genericPayee(key: string): boolean {
  return key.split(" ").every((w) => !w || GENERIC.has(w));
}

/** Words that say how a bill was paid, not who was paid — left off a ledger description. */
const LABEL_NOISE = new Set(["PYMT", "PMT", "PAYMT", "PAYMENT", "PAYMENTS", "BILL", "BILLPAY", "ONLINE", "AUTOPAY", "AUTO", "DEBIT", "PURCHASE", "RECURRING"]);

/**
 * How a line is described in the ledger when nothing better is known: its
 * payee, readably — "LG&E WEB PYMT 093026" is "LG&E".
 */
export function payeeLabel(text: string): string {
  const key = payeeKey(text);
  const words = key.split(" ").filter((w) => w && !LABEL_NOISE.has(w));
  return titleCase(words.length > 0 ? words.join(" ") : key) || text.slice(0, 60);
}

const blank = (ref: string): Suggestion => ({
  ref,
  action: "skip",
  confidence: "none",
  status: "new",
  propertyId: "",
  unitId: null,
  category: "",
  detail: "",
  note: "",
  vendorId: null,
  recurringExpenseId: null,
  why: "",
});

/**
 * One suggestion per row, in the rows' order. Duplicates are decided
 * oldest line first, each ledger entry answering for one line at most — two
 * identical $1,450 payments a day apart are two payments unless the ledger
 * already has two.
 */
export function suggestAll(rows: ImportRow[], ctx: MatchContext): Suggestion[] {
  const placeLabel = new Map(ctx.places.map((p) => [`${p.propertyId}|${p.unitId ?? ""}`, p.label]));
  const propertyName = new Map(ctx.properties.map((p) => [p.id, p.name]));
  const labelOf = (propertyId: string, unitId: string | null) =>
    placeLabel.get(`${propertyId}|${unitId ?? ""}`) ?? propertyName.get(propertyId) ?? "";
  const tenantAt = (propertyId: string, unitId: string | null) => {
    const here = ctx.tenants.filter((t) => t.propertyId === propertyId && (t.unitId ?? null) === unitId);
    return here.length === 1 ? here[0] : null;
  };
  const rentAt = (p: { propertyId: string; unitId: string | null; rent: number }, month: string) =>
    rentForMonth(ctx.rentChanges, p.propertyId, p.unitId, month, p.rent);
  const onlyProperty = ctx.properties.length === 1 ? ctx.properties[0].id : "";

  // Every earlier filing per payee, oldest first.
  const history = new Map<string, Learned[]>();
  for (const l of [...ctx.learned].sort((a, b) => a.date.localeCompare(b.date))) {
    const key = `${l.type}|${payeeKey(l.bankText)}`;
    history.set(key, [...(history.get(key) ?? []), l]);
  }
  const filedAs = (l: Learned) => `${l.propertyId}|${l.unitId ?? ""}|${l.category}`;

  /**
   * What this payee was filed as before. The newest filing wins — if you
   * refiled something, that's the answer now — and it's certain once the
   * last two agree. A payee that names nobody ("MOBILE DEPOSIT", "CHECK")
   * is only followed for the same amount, and only as a guess.
   */
  function fromHistory(type: "rent" | "expense", row: ImportRow): { entry: Learned; confidence: "sure" | "guess" } | null {
    const key = payeeKey(row.text);
    if (!key) return null;
    const list = (history.get(`${type}|${key}`) ?? []).filter((l) => propertyName.has(l.propertyId));
    if (list.length === 0) return null;
    const sameAmount = list.filter((l) => cents(l.amount) === cents(row.amount));
    if (genericPayee(key)) {
      if (sameAmount.length === 0) return null;
      const places = new Set(sameAmount.map(filedAs));
      return places.size === 1 ? { entry: sameAmount[sameAmount.length - 1], confidence: "guess" } : null;
    }
    const last = list[list.length - 1];
    const before = list[list.length - 2];
    if (!before || filedAs(before) === filedAs(last)) return { entry: last, confidence: "sure" };
    return { entry: sameAmount.length > 0 ? sameAmount[sameAmount.length - 1] : last, confidence: "guess" };
  }
  const loggedRecurring = new Set(
    ctx.ledger.filter((t) => t.recurringExpenseId).map((t) => `${t.recurringExpenseId}|${t.date.slice(0, 7)}`)
  );
  const vendorLast = new Map<string, LedgerLite>();
  for (const t of [...ctx.ledger].sort((a, b) => a.date.localeCompare(b.date))) {
    if (t.vendorId && t.type === "expense") vendorLast.set(t.vendorId, t);
  }
  // Learned entries name a vendor too, and reach further back than the ledger window.
  const vendorFromLearned = new Map<string, Learned>();
  for (const l of [...ctx.learned].sort((a, b) => a.date.localeCompare(b.date))) {
    if (l.vendorId && l.type === "expense") vendorFromLearned.set(l.vendorId, l);
  }

  function rentSuggestion(row: ImportRow): Suggestion {
    const s = blank(row.ref);
    const month = row.date.slice(0, 7);
    const amount = cents(row.amount);
    const words = wordsOf(row.text);
    const fill = (propertyId: string, unitId: string | null, confidence: Suggestion["confidence"], why: string) => {
      const tenant = tenantAt(propertyId, unitId);
      return {
        ...s,
        action: "rent" as const,
        confidence,
        propertyId,
        unitId,
        detail: tenant?.name ?? "",
        note: rentNote(month),
        why,
      };
    };

    // A tenant's whole name on the line.
    const named = ctx.tenants.filter((t) => fullNameIn(t.name, words));
    const best = named.sort((a, b) => nameTokens(b.name).length - nameTokens(a.name).length);
    const byName =
      best.length === 1 || (best.length > 1 && nameTokens(best[0].name).length > nameTokens(best[1].name).length)
        ? best[0]
        : null;

    const past = fromHistory("rent", row);
    // A name on the line outranks a history that points somewhere else:
    // the tenant moved units, or a payee was filed wrong once.
    if (past && (!byName || (byName.propertyId === past.entry.propertyId && (byName.unitId ?? null) === past.entry.unitId))) {
      return fill(
        past.entry.propertyId,
        past.entry.unitId,
        past.confidence,
        genericPayee(payeeKey(row.text))
          ? `A ${money(row.amount)} "${payeeLabel(row.text)}" was rent from ${labelOf(past.entry.propertyId, past.entry.unitId)} on ${shortDate(past.entry.date)} — check it's theirs`
          : `You filed "${payeeLabel(row.text)}" as rent from ${labelOf(past.entry.propertyId, past.entry.unitId)} on ${shortDate(past.entry.date)}`
      );
    }
    if (byName) return fill(byName.propertyId, byName.unitId, "sure", `${byName.name}'s name is on it`);

    // A surname only, when no other tenant shares it.
    const bySurname = ctx.tenants.filter((t) => {
      const tokens = nameTokens(t.name);
      const last = tokens[tokens.length - 1];
      return last && last.length >= 3 && words.includes(` ${last} `);
    });
    if (bySurname.length === 1) {
      const t = bySurname[0];
      const place = ctx.places.find((p) => p.propertyId === t.propertyId && (p.unitId ?? null) === (t.unitId ?? null));
      const rentMatches = place && cents(rentAt(place, month)) === amount;
      return fill(
        t.propertyId,
        t.unitId,
        rentMatches ? "sure" : "guess",
        rentMatches
          ? `${t.name}'s surname and their ${money(rentAt(place!, month))} rent`
          : `${t.name}'s surname is on it — check the amount`
      );
    }

    // The amount is exactly one place's rent that month.
    const let_ = ctx.places.filter((p) => !p.vacant || tenantAt(p.propertyId, p.unitId));
    const byAmount = let_.filter((p) => rentAt(p, month) > 0 && cents(rentAt(p, month)) === amount);
    if (byAmount.length === 1) {
      const p = byAmount[0];
      return fill(p.propertyId, p.unitId, "guess", `${money(row.amount)} is the rent at ${p.label} and nowhere else`);
    }
    if (byAmount.length > 1) {
      return { ...s, why: `${money(row.amount)} is the rent at ${byAmount.length} places — choose which` };
    }
    return s;
  }

  function expenseSuggestion(row: ImportRow): Suggestion {
    const s = blank(row.ref);
    const month = row.date.slice(0, 7);
    const amount = cents(row.amount);
    const key = payeeKey(row.text);
    const words = wordsOf(row.text);
    const expense = (
      propertyId: string,
      unitId: string | null,
      category: string,
      confidence: Suggestion["confidence"],
      why: string,
      extra: Partial<Suggestion> = {}
    ): Suggestion => ({
      ...s,
      action: "expense",
      confidence,
      propertyId,
      unitId,
      category,
      detail: payeeLabel(row.text),
      why,
      ...extra,
    });

    // Recurring bills of exactly this amount, not yet logged this period.
    const due = ctx.recurring.filter(
      (r) =>
        r.active &&
        cents(r.amount) === amount &&
        (r.frequency === "monthly" || r.month === +month.slice(5, 7)) &&
        !loggedRecurring.has(`${r.id}|${month}`)
    );

    const found = fromHistory("expense", row);
    if (found) {
      const past = found.entry;
      // Still link the bill it pays, or the overview would go on asking to
      // "Log it" for a month that's already in the books.
      const pays = due.find((r) => r.propertyId === past.propertyId && r.category === past.category);
      if (pays) loggedRecurring.add(`${pays.id}|${month}`);
      return expense(
        past.propertyId,
        past.unitId,
        past.category,
        found.confidence,
        genericPayee(key)
          ? `A ${money(row.amount)} "${payeeLabel(row.text)}" went to ${past.category} for ${labelOf(past.propertyId, past.unitId)} on ${shortDate(past.date)} — check it's the same`
          : `You filed "${past.detail || payeeLabel(row.text)}" under ${past.category} for ${labelOf(past.propertyId, past.unitId)} on ${shortDate(past.date)}`,
        { detail: past.detail || payeeLabel(row.text), vendorId: past.vendorId, recurringExpenseId: pays?.id ?? null }
      );
    }

    const dueNamed = due.filter((r) => r.detail && fullNameIn(r.detail, words));
    const recurring = dueNamed.length === 1 ? dueNamed[0] : due.length === 1 ? due[0] : null;
    if (recurring) {
      loggedRecurring.add(`${recurring.id}|${month}`);
      return expense(
        recurring.propertyId,
        recurring.unitId,
        recurring.category,
        "sure",
        `Your ${recurring.frequency} ${recurring.detail || recurring.category} bill for ${labelOf(recurring.propertyId, recurring.unitId)} is ${money(recurring.amount)}`,
        { detail: recurring.detail || recurring.category, recurringExpenseId: recurring.id }
      );
    }

    // Someone in the vendor book.
    const vendor = ctx.vendors.find((v) => fullNameIn(v.name, words));
    if (vendor) {
      const last = vendorLast.get(vendor.id) ?? vendorFromLearned.get(vendor.id);
      const propertyId = last?.propertyId ?? onlyProperty;
      const category = last?.category || categoryFromWords(row.text) || "Repairs & Maintenance";
      return expense(
        propertyId,
        last ? last.unitId : null,
        category,
        propertyId ? "guess" : "none",
        propertyId
          ? `Paid to ${vendor.name}, from your vendor book${last ? ` — last for ${labelOf(last.propertyId, last.unitId)}` : ""}`
          : `Paid to ${vendor.name}, from your vendor book — which property?`,
        { detail: vendor.name, vendorId: vendor.id }
      );
    }

    if (TRANSFER.test(words)) {
      return { ...s, status: "transfer", why: "Looks like money moving between your own accounts — not an expense" };
    }

    const category = categoryFromWords(row.text);
    if (category) {
      return expense(
        onlyProperty,
        null,
        category,
        onlyProperty ? "guess" : "none",
        onlyProperty ? `Looks like ${category}` : `Looks like ${category} — which property?`
      );
    }
    return s;
  }

  const out: Suggestion[] = rows.map((row) => {
    const amount = cents(row.amount);
    if (row.amount < 0) {
      // A mortgage payment, whole or without escrow, comes before anything
      // learned: filing one as a single expense is the mistake loans exist to stop.
      const loan = ctx.loans.find(
        (l) => l.active && (cents(l.payment + l.escrow) === amount || cents(l.payment) === amount)
      );
      if (loan) {
        return {
          ...blank(row.ref),
          status: "mortgage" as const,
          propertyId: loan.propertyId,
          why: `Same as the ${loan.lender || "mortgage"} payment on ${propertyName.get(loan.propertyId) ?? "a property"}. Record it from the loan on the property page, so it's split into interest, escrow and principal.`,
        };
      }
      return expenseSuggestion(row);
    }

    const s = rentSuggestion(row);
    // A deposit is held, not earned. Only when it can't also be the rent.
    const month = row.date.slice(0, 7);
    const depositOf = ctx.tenants.find((t) => {
      if (t.deposit <= 0 || cents(t.deposit) !== amount) return false;
      const place = ctx.places.find((p) => p.propertyId === t.propertyId && (p.unitId ?? null) === (t.unitId ?? null));
      if (place && cents(rentAt(place, month)) === amount) return false;
      const named = fullNameIn(t.name, wordsOf(row.text));
      const nearStart = t.leaseStart && Math.abs(dayNumber(t.leaseStart) - dayNumber(row.date)) <= 45;
      return named || nearStart;
    });
    if (depositOf) {
      return {
        ...s,
        action: "skip" as const,
        confidence: "sure" as const,
        status: "deposit" as const,
        propertyId: depositOf.propertyId,
        unitId: depositOf.unitId,
        why: `Same as ${depositOf.name}'s ${money(depositOf.deposit)} security deposit — a deposit held isn't income`,
      };
    }
    if (s.action === "skip" && !s.why && TRANSFER.test(wordsOf(row.text))) {
      return { ...s, status: "transfer" as const, why: "Looks like money moving between your own accounts — not income" };
    }
    return s;
  });

  // Duplicates, oldest line first.
  const byRef = new Map(ctx.ledger.filter((t) => t.bankRef).map((t) => [t.bankRef!, t]));
  const claimed = new Set<string>();
  const order = rows.map((_, i) => i).sort((a, b) => rows[a].date.localeCompare(rows[b].date) || a - b);
  // Exact re-imports claim their entry before any near match can.
  for (const i of order) {
    const prior = byRef.get(rows[i].ref);
    if (!prior) continue;
    claimed.add(prior.id);
    out[i] = {
      ...out[i],
      action: "skip",
      confidence: "sure",
      status: "imported",
      why: `Imported on an earlier upload — ${prior.detail || labelOf(prior.propertyId, prior.unitId)}`,
      duplicateOf: { id: prior.id, date: prior.date, amount: prior.amount, detail: prior.detail },
    };
  }
  for (const i of order) {
    if (out[i].status === "imported") continue;
    const row = rows[i];
    const type = row.amount > 0 ? "rent" : "expense";
    const day = dayNumber(row.date);
    const candidates = ctx.ledger.filter(
      (t) =>
        !claimed.has(t.id) &&
        t.type === type &&
        cents(t.amount) === cents(row.amount) &&
        Math.abs(dayNumber(t.date) - day) <= DUPLICATE_DAYS
    );
    if (candidates.length === 0) continue;
    const want = out[i].propertyId;
    candidates.sort(
      (a, b) =>
        Number(b.propertyId === want) - Number(a.propertyId === want) ||
        Math.abs(dayNumber(a.date) - day) - Math.abs(dayNumber(b.date) - day)
    );
    const hit = candidates[0];
    claimed.add(hit.id);
    out[i] = {
      ...out[i],
      action: "skip",
      confidence: "sure",
      status: "duplicate",
      why: `Already in the ledger: ${shortDate(hit.date)}, ${money(hit.amount)}${hit.detail ? ` — ${hit.detail}` : ""}${labelOf(hit.propertyId, hit.unitId) ? ` · ${labelOf(hit.propertyId, hit.unitId)}` : ""}`,
      duplicateOf: { id: hit.id, date: hit.date, amount: hit.amount, detail: hit.detail },
    };
  }
  return out;
}

/**
 * Lines whose payee is the same as this one's — the ones a decision on this
 * line should be offered to. Same direction of money only.
 */
export function samePayee(rows: ImportRow[], ref: string): string[] {
  const row = rows.find((r) => r.ref === ref);
  if (!row) return [];
  const key = payeeKey(row.text);
  // Lines that name nobody ("MOBILE DEPOSIT") are each their own question.
  if (!key || genericPayee(key)) return [];
  return rows
    .filter((r) => r.ref !== ref && Math.sign(r.amount) === Math.sign(row.amount) && payeeKey(r.text) === key)
    .map((r) => r.ref);
}
