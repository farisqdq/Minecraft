"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { shrinkImage } from "@/lib/shrinkImage";
import { rentTargetOf, unitIdsCountingToward } from "@/lib/rent-target";
// Attach-proof hardening for iOS: visually-hidden (not display:none) inputs, HEIC in accept.
import { PROOF_ACCEPT } from "@/lib/attachments-ui";
import proofStyles from "../components/proof.module.css";
import { money, moneyRound } from "@/lib/money";
import { STATUS_LABEL, ago, type RequestDTO } from "@/lib/maintenance";
import { chasedRecently, remindedAgo } from "@/lib/notices";
import { rentForMonth, type RentChangeDTO } from "@/lib/rent";
import type { TenantDTO } from "@/lib/tenants";
import { DEFAULT_POLICY, policyCharges, type LateFeePolicyDTO } from "@/lib/late-fee-policy";
import {
  NO_TENANT_LINE,
  cardLateFeeLine,
  isPaidUp,
  mergedFees,
  needsStatusCheck,
  noFeeLine,
  parseStatuses,
  shortAmount,
  type LateFeeStatus,
} from "@/lib/late-fee-card";
import { dateFromISO, daysLate, formatDay, isoDay, leaseStatus, smsHref, telHref } from "@/lib/lease";
import { byUrgency, expiryLabel, expiryState, type DocumentDTO } from "@/lib/documents";
import { isDue as loanIsDue, missedMonths, suggestPayment } from "@/lib/loans";
import type { LoanDTO, LoanPaymentDTO } from "@/lib/loans-db";
import type { MoveOutDTO } from "@/lib/move-outs-db";
import { returnLabel, returnState } from "@/lib/move-out";
import { MarkReturnedDialog } from "../components/MoveOut";
import { vacancyCost, vacantDays, vacantFor } from "@/lib/vacancy";
import AppShell from "../components/AppShell";
import { useViewOnly } from "../components/ViewOnly";
import CashFlowChart from "../components/CashFlowChart";
import { forecast as forecastAhead, otherSpending } from "@/lib/forecast";
import type { ListingDTO } from "@/lib/listings-db";
import CategoryBars from "../components/CategoryBars";
import Sparkline from "../components/Sparkline";
import { comparable } from "@/lib/kpi-rules";
import Modal from "../components/Modal";
import { FileActions, FileLink, ThumbWithActions } from "../components/FileViewer";
import ConfirmDialog, { type ConfirmRequest } from "../components/ConfirmDialog";
import { Toasts, useToasts } from "../components/Toasts";
import styles from "./dashboard.module.css";
import { useNow } from "../components/useNow";
import { useLivePulse } from "../components/useLivePulse";
import { useRouter } from "next/navigation";
import RecordEntrySheet, { type EntryDraft, type SavedEntry } from "../components/RecordEntrySheet";
import LoanPaymentDialog from "../components/LoanPaymentDialog";
import type { ProofDTO } from "../components/ProofPicker";
import { bulkSummary, owedLine, recurringPrefill, rentPrefill } from "@/lib/quick-record";

type Company = { id: string; name: string; role: "owner" | "member" };

type Property = {
  id: string;
  companyId: string;
  name: string;
  address: string;
  monthlyRent: number;
  vacant: boolean;
  /** YYYY-MM-DD rent stopped coming in, when known. */
  vacantSince: string | null;
};

type Unit = {
  id: string;
  propertyId: string;
  name: string;
  monthlyRent: number;
  vacant: boolean;
  vacantSince: string | null;
};

type RecurringExpense = {
  id: string;
  propertyId: string;
  unitId: string | null;
  category: string;
  detail: string;
  note: string;
  amount: number;
  frequency: "monthly" | "yearly";
  day: number;
  month: number | null;
  active: boolean;
};

type Attachment = {
  id: string;
  transactionId: string;
  url: string;
  filename: string;
  contentType: string;
};

type Transaction = {
  id: string;
  propertyId: string;
  unitId: string | null;
  type: "rent" | "expense";
  date: string;
  amount: number;
  detail: string;
  note: string;
  category: string;
  recurringExpenseId: string | null;
  /** Set on the interest and escrow entries a mortgage payment wrote. */
  loanPaymentId: string | null;
  attachments: Attachment[];
};

// A place money can be logged against: a property with no units, or one
// specific unit inside a property that has them, or the property itself
// as a "whole building" option alongside its units.
type Target = {
  key: string;
  propertyId: string;
  unitId: string | null;
  label: string;
  monthlyRent: number;
  vacant: boolean;
  vacantSince: string | null;
};

// toLocaleDateString builds a new Intl formatter on every call, and that is
// nearly all of what formatting a date costs. With a few years of ledger the
// search box formats thousands of dates per keystroke — profiled at 300ms of
// a 700ms keystroke — so each formatter is built once and each date string is
// formatted once. Same options, same output.
const DAY_FORMAT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const dayLabels = new Map<string, string>();
const fmtDate = (iso: string) => {
  let label = dayLabels.get(iso);
  if (label === undefined) {
    label = DAY_FORMAT.format(new Date(iso + "T00:00:00"));
    dayLabels.set(iso, label);
  }
  return label;
};
type PeriodKind = "month" | "year" | "all";

/* ---------- Sorting the ledger ---------- */

type SortKey = "date" | "property" | "type" | "details" | "amount";
type SortDir = "asc" | "desc";

const SORT_LABEL: Record<SortKey, string> = {
  date: "Date",
  property: "Property",
  type: "Type",
  details: "Details",
  amount: "Amount",
};

// Which way a column reads best on the first click: newest and biggest first
// for the date and the money, A to Z for the word columns.
const FIRST_DIR: Record<SortKey, SortDir> = {
  date: "desc",
  property: "asc",
  type: "asc",
  details: "asc",
  amount: "desc",
};

// Every ordering the phone's picker offers, in the order it lists them. The
// headers are hidden at that width, so this is the only way to sort there.
const SORT_CHOICES: { key: SortKey; dir: SortDir; label: string }[] = [
  { key: "date", dir: "desc", label: "Newest first" },
  { key: "date", dir: "asc", label: "Oldest first" },
  { key: "amount", dir: "desc", label: "Biggest amount" },
  { key: "amount", dir: "asc", label: "Smallest amount" },
  { key: "property", dir: "asc", label: "Property A–Z" },
  { key: "property", dir: "desc", label: "Property Z–A" },
  { key: "type", dir: "desc", label: "Rent first" },
  { key: "type", dir: "asc", label: "Expenses first" },
  { key: "details", dir: "asc", label: "Details A–Z" },
  { key: "details", dir: "desc", label: "Details Z–A" },
];

// numeric so "Apt 2" lands before "Apt 10", and case-blind so a stray
// capital doesn't drop a property to the bottom of the list.
// One collator rather than localeCompare with options, which builds one per
// comparison — thousands of them to sort a searched ledger.
const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const compareText = (a: string, b: string) => COLLATOR.compare(a, b);

/** The words the Details column actually shows, which is what it sorts on. */
const detailsText = (t: Transaction) =>
  [t.category, t.detail, t.note].filter(Boolean).join(" ");

const MONTH_YEAR = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
const MONTH_ONLY = new Intl.DateTimeFormat("en-US", { month: "long" });
const MONTH_SHORT = new Intl.DateTimeFormat("en-US", { month: "short" });

function monthName(key: string, withYear = true) {
  const [y, m] = key.split("-").map(Number);
  return (withYear ? MONTH_YEAR : MONTH_ONLY).format(new Date(y, m - 1, 1));
}

function shortMonth(key: string) {
  const [y, m] = key.split("-").map(Number);
  return MONTH_SHORT.format(new Date(y, m - 1, 1));
}

/** Steps a YYYY-MM key by whole months, rolling the year over as needed. */
function shiftMonth(key: string, delta: number) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Today if we're looking at the current month, otherwise the 1st of the one on screen. */
function defaultDateFor(month: string, today: string) {
  return today.startsWith(month) ? today : `${month}-01`;
}

export default function DashboardClient({
  openRepairs,
  initialRepairs,
  expiringDocs,
  initialChases,
  lateFees = {},
  waivedLateFees = {}, // a21
  lateFeePolicies = {},
  userLabel,
  storageReady,
  serverToday,
  serverNow,
  initialCompanies,
  initialProperties,
  initialUnits,
  initialRecurring,
  initialRentChanges,
  initialTenants,
  initialTransactions,
  initialLoans,
  initialListings = [],
  initialDeposits,
}: {
  /** Repairs waiting on you, for the nav badge. */
  openRepairs?: number;
  /** Open repair reports, newest trouble first, for Needs attention. */
  initialRepairs: RequestDTO[];
  /** Documents that have run out or will within SOON_DAYS. */
  expiringDocs: DocumentDTO[];
  /** The last rent chase per tenant id, so a row can say when you last asked. */
  initialChases: Record<string, { at: string; month: string; read: boolean }>;
  /** Late fees on the books, keyed "tenantId|YYYY-MM". */
  lateFees?: Record<string, number>;
  /** Late fee waivers (a21): months whose late fee was waived, keyed "tenantId|YYYY-MM". */
  waivedLateFees?: Record<string, true>;
  /** Each company's late-fee policy, by company id. */
  lateFeePolicies?: Record<string, LateFeePolicyDTO>;
  userLabel: string;
  storageReady: boolean;
  serverToday: string;
  /** When the server rendered, so the first client render agrees. */
  serverNow: string;
  initialCompanies: Company[];
  initialProperties: Property[];
  initialUnits: Unit[];
  initialRecurring: RecurringExpense[];
  initialRentChanges: RentChangeDTO[];
  initialTenants: TenantDTO[];
  initialTransactions: Transaction[];
  /** Open mortgages, with their payments, so a due one can be logged split. */
  initialLoans: LoanDTO[];
  /** Open listings (a27): an empty place says it's listed, and who has applied. */
  initialListings?: ListingDTO[];
  /** Deposits still to go back to someone who moved out, with who and where. */
  initialDeposits: (MoveOutDTO & { tenantName: string; propertyId: string })[];
}) {
  // The server renders with its own clock; the browser may be on a different
  // calendar day. Starting from the server's value keeps the first client
  // render identical to the HTML, and the effect below swaps in the real
  // local date straight after — so "17 days late" is never rendered twice
  // with two different numbers.
  const [todayKey, setTodayKey] = useState(serverToday);
  useEffect(() => {
    const local = isoDay(new Date());
    if (local !== serverToday) setTodayKey(local);
  }, [serverToday]);

  const now = useMemo(() => dateFromISO(todayKey), [todayKey]);
  // Day precision is right for lease maths and useless for "3 days ago", so
  // the relative times get a real timestamp of their own.
  const clock = useNow(serverNow);
  const router = useRouter();
  const viewOnly = useViewOnly();

  // Both the repair rows and the nav count are props from the server, so
  // asking the server to render again is all this page needs. The ledger and
  // the forms are local state and are untouched by it.
  useLivePulse("/api/requests/pulse", () => router.refresh());

  const [chases, setChases] = useState(initialChases);
  const [chasing, setChasing] = useState("");

  /**
   * Chase a tenant for what's outstanding. Writes the notice to their portal
   * and hands back a text with the message already in it — the app sends
   * nothing itself, so it arrives from your own number rather than a service
   * they don't recognise.
   */
  async function remind(
    tenant: TenantDTO,
    month: string,
    expected: number,
    paid: number,
    label: string
  ) {
    setChasing(tenant.id);
    const res = await fetch(`/api/tenants/${tenant.id}/notices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "rent", month, expected, paid }),
    });
    const data = await res.json().catch(() => ({}));
    setChasing("");
    if (!res.ok) {
      push(data?.error || "Couldn't send that.", "bad");
      return;
    }
    setChases((prev) => ({
      ...prev,
      [tenant.id]: { at: data.notice.createdAt, month, read: false },
    }));
    if (data.smsHref) {
      // Opens the messaging app with the text already written. Same tab is
      // correct: an sms: link doesn't navigate the page anywhere.
      window.location.href = data.smsHref;
      push(`Noted on ${label}'s portal. Your messages app has the text ready.`);
    } else {
      push(`Noted on ${label}'s portal. No phone number on file to text.`);
    }
  }
  const thisMonth = todayKey.slice(0, 7);
  const thisYear = todayKey.slice(0, 4);

  const [companies, setCompanies] = useState<Company[]>(initialCompanies);
  const [properties, setProperties] = useState<Property[]>(initialProperties);
  const [units, setUnits] = useState<Unit[]>(initialUnits);
  const [recurring, setRecurring] = useState<RecurringExpense[]>(initialRecurring);
  const [loans, setLoans] = useState<LoanDTO[]>(initialLoans);
  const tenants = initialTenants;
  const [rentChanges, setRentChanges] = useState<RentChangeDTO[]>(initialRentChanges);
  const [transactions, setTransactions] = useState<Transaction[]>(initialTransactions);

  const [selectedCompany, setSelectedCompany] = useState<string>(
    initialCompanies.length === 1 ? initialCompanies[0].id : "all"
  );

  const [addingCompany, setAddingCompany] = useState(false);
  const [companyName, setCompanyName] = useState("");

  const [joining, setJoining] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joinBusy, setJoinBusy] = useState(false);

  const [addingProperty, setAddingProperty] = useState(false);
  const [propName, setPropName] = useState("");
  const [propAddress, setPropAddress] = useState("");
  const [propRent, setPropRent] = useState("");
  const [propCompany, setPropCompany] = useState("");

  const [editingPropertyId, setEditingPropertyId] = useState("");
  const [editName, setEditName] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editRent, setEditRent] = useState("");
  const [editVacant, setEditVacant] = useState(false);
  const [editSaving, setEditSaving] = useState(false);

  // The record sheet: what it opens with, and a counter that remounts it so
  // each opening starts from its own prefill rather than the last one's.
  const [recording, setRecording] = useState(false);
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const [draftSeq, setDraftSeq] = useState(0);
  // A mortgage's "Log it": the loan whose payment form is open.
  const [payingLoanId, setPayingLoanId] = useState("");
  const [bulkBusy, setBulkBusy] = useState<"" | "rent" | "bills">("");
  const [error, setError] = useState("");

  const [deposits, setDeposits] = useState(initialDeposits);
  const [returningId, setReturningId] = useState("");

  const [periodKind, setPeriodKind] = useState<PeriodKind>("month");
  const [selectedMonth, setSelectedMonth] = useState(serverToday.slice(0, 7));
  const [selectedYear, setSelectedYear] = useState(serverToday.slice(0, 4));
  const [filterProperty, setFilterProperty] = useState("");
  const [filterType, setFilterType] = useState("");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [uploadingFor, setUploadingFor] = useState("");
  // Upload problems belong next to the control that was used, not in the page
  // banner — the attach controls sit far below it.
  const [proofError, setProofError] = useState<{ scope: string; message: string } | null>(null);

  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null);
  const { toasts, push, dismiss } = useToasts();

  const visibleProperties = useMemo(
    () =>
      selectedCompany === "all"
        ? properties
        : properties.filter((p) => p.companyId === selectedCompany),
    [properties, selectedCompany]
  );

  const visibleIds = useMemo(() => new Set(visibleProperties.map((p) => p.id)), [visibleProperties]);

  const visibleTransactions = useMemo(
    () => transactions.filter((t) => visibleIds.has(t.propertyId)),
    [transactions, visibleIds]
  );

  // One pass over the ledger each time it changes, so that rendering asks a
  // map instead of rescanning every entry once per card, per unit, per
  // recurring bill. Sums run in ledger order, so the figures are the same to
  // the last floating-point bit as the scans they replace.
  const ledgerIndex = useMemo(() => {
    const rent = new Map<string, number>();
    const recurringLogged = new Set<string>();
    for (const t of transactions) {
      const month = t.date.slice(0, 7);
      if (t.type === "rent") {
        const key = `${t.propertyId}|${t.unitId ?? ""}|${month}`;
        rent.set(key, (rent.get(key) ?? 0) + t.amount);
      }
      if (t.recurringExpenseId) recurringLogged.add(`${t.recurringExpenseId}|${month}`);
    }
    return { rent, recurringLogged };
  }, [transactions]);

  function unitsForProperty(propertyId: string) {
    return units.filter((u) => u.propertyId === propertyId);
  }

  function propName_(id: string) {
    return properties.find((p) => p.id === id)?.name ?? "—";
  }

  function targetLabel(t: { propertyId: string; unitId: string | null }) {
    const property = propName_(t.propertyId);
    if (!t.unitId) return property;
    const unit = units.find((u) => u.id === t.unitId);
    return unit ? `${property} — ${unit.name}` : property;
  }

  // Everything the transaction form and "who hasn't paid" can point at.
  const visibleTargets = useMemo<Target[]>(() => {
    return visibleProperties.flatMap((p): Target[] => {
      const propUnits = unitsForProperty(p.id);
      if (propUnits.length === 0) {
        return [
          {
            key: p.id,
            propertyId: p.id,
            unitId: null,
            label: p.name,
            monthlyRent: p.monthlyRent,
            vacant: p.vacant,
            vacantSince: p.vacantSince,
          },
        ];
      }
      return [
        ...propUnits.map((u) => ({
          key: `${p.id}:${u.id}`,
          propertyId: p.id,
          unitId: u.id,
          label: `${p.name} — ${u.name}`,
          monthlyRent: u.monthlyRent,
          vacant: u.vacant,
          vacantSince: u.vacantSince,
        })),
        {
          key: `${p.id}:whole`,
          propertyId: p.id,
          unitId: null,
          label: `${p.name} — (whole building)`,
          monthlyRent: 0,
          vacant: false,
          vacantSince: null,
        },
      ];
    });
  }, [visibleProperties, units]);

  // Every month from the first recorded entry through the current one, so you
  // can page back through the year even where a month has nothing in it.
  const months = useMemo(() => {
    const earliest = transactions.reduce((min, t) => (t.date < min ? t.date : min), `${thisMonth}-01`);
    const [startY, startM] = earliest.slice(0, 7).split("-").map(Number);
    const [endY, endM] = thisMonth.split("-").map(Number);
    const list: string[] = [];
    let y = startY;
    let m = startM;
    while (y < endY || (y === endY && m <= endM)) {
      list.push(`${y}-${String(m).padStart(2, "0")}`);
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    return list;
  }, [transactions, thisMonth]);

  // Every year with something in it, newest first, so the year picker can't
  // wander into years that never existed.
  const years = useMemo(() => {
    const seen = new Set(months.map((m) => m.slice(0, 4)));
    seen.add(thisYear);
    return Array.from(seen).sort();
  }, [months, thisYear]);

  const monthIndex = months.indexOf(selectedMonth);
  const yearIndex = years.indexOf(selectedYear);
  const allTime = periodKind === "all";

  // One string scopes everything: "2026-09" for a month, "2026" for a year,
  // "" for all time — every filter is the same prefix test.
  const scopeKey = periodKind === "month" ? selectedMonth : periodKind === "year" ? selectedYear : "";
  const periodLabel =
    periodKind === "month" ? monthName(selectedMonth) : periodKind === "year" ? selectedYear : "All time";
  const periodShort =
    periodKind === "month" ? monthName(selectedMonth, false) : periodKind === "year" ? selectedYear : "all time";

  const inScope = (t: Transaction) => !scopeKey || t.date.startsWith(scopeKey);

  const scopedTransactions = useMemo(
    () => visibleTransactions.filter(inScope),
    [visibleTransactions, scopeKey]
  );

  function totalsFor(ids: Set<string> | null, txns: Transaction[]) {
    let rent = 0;
    let expense = 0;
    for (const t of txns) {
      if (ids && !ids.has(t.propertyId)) continue;
      if (t.type === "rent") rent += t.amount;
      else expense += t.amount;
    }
    return { rent, expense, net: rent - expense };
  }

  const inScopeTransactions = useMemo(() => transactions.filter(inScope), [transactions, scopeKey]);

  const overall = totalsFor(visibleIds, scopedTransactions);

  // Each property card's totals for the period, from one pass rather than one
  // pass per card.
  const totalsByProperty = useMemo(() => {
    const out = new Map<string, { rent: number; expense: number; net: number }>();
    for (const t of inScopeTransactions) {
      let totals = out.get(t.propertyId);
      if (!totals) {
        totals = { rent: 0, expense: 0, net: 0 };
        out.set(t.propertyId, totals);
      }
      if (t.type === "rent") totals.rent += t.amount;
      else totals.expense += t.amount;
    }
    for (const totals of out.values()) totals.net = totals.rent - totals.expense;
    return out;
  }, [inScopeTransactions]);

  const perCompany = useMemo(
    () =>
      companies.map((c) => {
        const ids = new Set(properties.filter((p) => p.companyId === c.id).map((p) => p.id));
        return { company: c, count: ids.size, ...totalsFor(ids, inScopeTransactions) };
      }),
    [companies, properties, inScopeTransactions]
  );

  // Rent collection and what needs chasing are always about one month. When
  // you're looking at a whole year, or at all time, that month is this one.
  const barMonth = periodKind === "month" ? selectedMonth : thisMonth;

  // Twelve months ending at the month on screen. Feeds both the cash-flow
  // chart and the sparkline on each stat card, so they can never disagree.
  const series = useMemo(() => {
    const keys =
      periodKind === "year"
        ? Array.from({ length: 12 }, (_, i) => `${selectedYear}-${String(i + 1).padStart(2, "0")}`)
        : Array.from({ length: 12 }, (_, i) => shiftMonth(barMonth, i - 11));
    const buckets = new Map(keys.map((k) => [k, { month: k, rent: 0, expense: 0 }]));
    for (const t of visibleTransactions) {
      const bucket = buckets.get(t.date.slice(0, 7));
      if (!bucket) continue;
      if (t.type === "rent") bucket.rent += t.amount;
      else bucket.expense += t.amount;
    }
    return keys.map((k) => buckets.get(k)!);
  }, [visibleTransactions, barMonth, periodKind, selectedYear]);

  // The year ahead (a forecast, not the books): the same chart, switched.
  const [cashView, setCashView] = useState<"past" | "next">("past");
  const ahead = useMemo(() => {
    if (cashView !== "next") return null;
    const other = otherSpending(visibleTransactions, thisMonth);
    const result = forecastAhead({
      from: shiftMonth(thisMonth, 1),
      months: 12,
      places: visibleTargets.map((t) => ({ propertyId: t.propertyId, unitId: t.unitId, rent: t.monthlyRent, vacant: t.vacant })),
      tenants: tenants.filter((t) => visibleIds.has(t.propertyId)),
      rentChanges,
      bills: recurring.filter((r) => visibleIds.has(r.propertyId)),
      loans: loans.filter((l) => visibleIds.has(l.propertyId)),
      otherPerMonth: other.perMonth,
    });
    const horizonEnd = `${shiftMonth(thisMonth, 12)}-31`;
    // Whose lease runs out before the year ahead does, soonest first.
    const ending = tenants
      .filter((t) => visibleIds.has(t.propertyId) && t.leaseEnd && t.leaseEnd <= horizonEnd)
      .sort((a, b) => a.leaseEnd.localeCompare(b.leaseEnd));
    return { ...result, other, ending };
  }, [cashView, visibleTransactions, thisMonth, visibleTargets, tenants, visibleIds, rentChanges, recurring, loans]);

  const byCategory = useMemo(() => {
    const totals = new Map<string, number>();
    for (const t of scopedTransactions) {
      if (t.type !== "expense") continue;
      const key = t.category || "Other";
      totals.set(key, (totals.get(key) ?? 0) + t.amount);
    }
    return Array.from(totals, ([label, value]) => ({ label, value }));
  }, [scopedTransactions]);

  // Month-over-month movement for the stat cards. Meaningless on All time,
  // where there is no previous period to compare against.
  const previous = useMemo(() => {
    if (periodKind === "all") return null;
    const key =
      periodKind === "month" ? shiftMonth(selectedMonth, -1) : String(Number(selectedYear) - 1);
    const label = periodKind === "month" ? shortMonth(key) : key;
    const prior = visibleTransactions.filter((t) => t.date.startsWith(key));
    return { key, label, ...totalsFor(null, prior) };
  }, [visibleTransactions, selectedMonth, selectedYear, periodKind]);

  /**
   * What this place was renting for in a given month, which is not always
   * what it rents for today. Judging a past month against the current figure
   * would make a year of correctly paid rent read as short after a raise.
   */
  function expectedRent(target: { propertyId: string; unitId: string | null; monthlyRent: number }, month: string) {
    return rentForMonth(rentChanges, target.propertyId, target.unitId, month, target.monthlyRent);
  }

  function rentInMonth(propertyId: string, unitId: string | null, month: string) {
    // On a property with one unit, rent logged against the whole property
    // is that unit's rent (lib/rent-target.ts) — the same rule the tenant's
    // statement and late fees use, so the card and the fee agree.
    return unitIdsCountingToward(unitId, unitsForProperty(propertyId)).reduce(
      (sum, u) => sum + (ledgerIndex.rent.get(`${propertyId}|${u ?? ""}|${month}`) ?? 0),
      0
    );
  }

  function rentInBarMonth(propertyId: string) {
    // Whole-property figure used on the card when it has no units.
    return rentInMonth(propertyId, null, barMonth);
  }

  // Rent targets with an amount due, not fully paid, and not vacant — the
  // reason to check this every month instead of clicking through each card.
  const unpaidThisMonth = useMemo(() => {
    return visibleTargets
      .filter((t) => !t.vacant && expectedRent(t, barMonth) > 0)
      .map((t) => {
        const tenant = tenantFor(t.propertyId, t.unitId);
        return {
          target: t,
          expected: expectedRent(t, barMonth),
          paid: rentInMonth(t.propertyId, t.unitId, barMonth),
          // Late fees for the month are part of what they owe for it, and a
          // rent payment goes against them the same way on their statement.
          fees: tenant ? lateFees[`${tenant.id}|${barMonth}`] ?? 0 : 0,
          tenant,
          // Only a month that has actually started can be late, so a future
          // month shows as owed rather than overdue.
          late: tenant ? Math.max(0, daysLate(barMonth, tenant.dueDay, now)) : 0,
        };
      })
      .filter(({ expected, paid, fees }) => paid < expected + fees - 0.005)
      // Longest overdue first, then by how much is outstanding.
      .sort((a, b) => b.late - a.late || b.expected + b.fees - b.paid - (a.expected + a.fees - a.paid));
  }, [visibleTargets, transactions, barMonth, tenants, now, rentChanges, lateFees]);

  // How far through the month's rent roll we are. Each unit's contribution is
  // capped at what it owes, so one tenant paying double can't hide another
  // who hasn't paid at all.
  const collection = useMemo(() => {
    let expected = 0;
    let collected = 0;
    let paidCount = 0;
    let dueCount = 0;
    for (const t of visibleTargets) {
      const due = expectedRent(t, barMonth);
      if (t.vacant || due <= 0) continue;
      const paid = rentInMonth(t.propertyId, t.unitId, barMonth);
      expected += due;
      collected += Math.min(paid, due);
      dueCount += 1;
      if (paid >= due) paidCount += 1;
    }
    return { expected, collected, paidCount, dueCount };
  }, [visibleTargets, transactions, barMonth, rentChanges]);

  // Recurring templates due this billing period that haven't been logged yet.
  const dueRecurring = useMemo(() => {
    const [, monthNum] = barMonth.split("-").map(Number);
    return recurring
      .filter((r) => r.active && visibleIds.has(r.propertyId))
      .filter((r) => r.frequency === "monthly" || r.month === monthNum)
      .filter(
        (r) =>
          !ledgerIndex.recurringLogged.has(`${r.id}|${barMonth}`)
      );
  }, [recurring, ledgerIndex, barMonth, visibleIds]);

  // Mortgage payments due this month and not recorded, each with the split
  // "Log it" would write — shown before it's written, not discovered after.
  const dueLoans = useMemo(
    () =>
      loans
        .filter((l) => visibleIds.has(l.propertyId) && loanIsDue(l, l.payments, barMonth, l.active))
        .map((l) => {
          const s = suggestPayment(l, l.payments, barMonth);
          const escrow = Math.round((s.escrowTax + s.escrowInsurance) * 100) / 100;
          return {
            loan: l,
            // Earlier months never recorded. Logging this one first would work
            // its interest out from a balance that is too high, so say so.
            missed: missedMonths(l, l.payments, barMonth, l.active).filter((m) => m < barMonth),
            interest: s.interest,
            principal: s.principal,
            escrow,
            total: Math.round((s.interest + s.principal + escrow) * 100) / 100,
          };
        }),
    [loans, barMonth, visibleIds]
  );

  /** The current tenant of a target, if one is on file. */
  function tenantFor(propertyId: string, unitId: string | null) {
    // A tenant on the whole property of a one-unit property rents that unit.
    const propUnits = unitsForProperty(propertyId);
    const target = rentTargetOf(unitId, propUnits);
    return (
      tenants.find(
        (t) => t.active && t.propertyId === propertyId && rentTargetOf(t.unitId ?? null, propUnits) === target
      ) ?? null
    );
  }

  // Why a short month past its grace period has no late fee, per tenant id,
  // as POST /api/late-fees/status explains it. Filled after mount only, so
  // the server-rendered HTML and the first client render agree.
  const [feeStatuses, setFeeStatuses] = useState<Record<string, LateFeeStatus>>({});
  const statusAsked = useRef(new Set<string>());

  function policyFor(propertyId: string): LateFeePolicyDTO | null {
    const companyId = properties.find((p) => p.id === propertyId)?.companyId;
    return (companyId && lateFeePolicies[companyId]) || null;
  }

  /**
   * Whether a tenant's month is one a fee could be expected on at all: on
   * the LLC policy while it charges, or on their own rules. "Off" is a
   * choice the landlord made, not something to explain on every card.
   */
  function feesExpected(tenant: TenantDTO, policy: LateFeePolicyDTO | null) {
    if (tenant.lateFeeMode === "off") return false;
    if (tenant.lateFeeMode === "custom") return true;
    return Boolean(policy && policyCharges(policy));
  }

  /** What a card says about one rent target's late fees in the bar month. */
  function cardFees(propertyId: string, unitId: string | null, rent: number, paid: number) {
    const tenant = tenantFor(propertyId, unitId);
    const policy = policyFor(propertyId);
    const known = tenant ? lateFees[`${tenant.id}|${barMonth}`] ?? 0 : 0;
    const status = tenant ? feeStatuses[tenant.id] : undefined;
    const fees = mergedFees(known, status, barMonth);
    const sums = { rent, paid, fees };
    let note = "";
    if (!tenant) {
      // Fees are charged to a tenant, so a short unit with nobody on it can
      // never get one, however late it is — worth saying rather than leaving
      // the landlord to wonder why the policy did nothing.
      if (
        policy &&
        policyCharges(policy) &&
        needsStatusCheck({ ...sums, dueDay: 1, graceDays: policy.graceDays, month: barMonth, today: todayKey })
      )
        note = NO_TENANT_LINE;
    } else if (fees <= 0) {
      note = noFeeLine(status, barMonth);
    }
    // Late fee waivers (a21): a waived month says so instead of the fee or no-fee line.
    const waived = Boolean(tenant && waivedLateFees[`${tenant.id}|${barMonth}`]);
    return {
      fees,
      short: shortAmount(sums),
      paidUp: isPaidUp(sums),
      line: waived ? "" : cardLateFeeLine({ fees, rent, policy, mode: tenant?.lateFeeMode ?? "default" }),
      note: waived ? "Late fee waived" : note,
    };
  }

  // Tenants on screen whose month is short, past grace and fee-less: the
  // cards that need the server to say why. Judged on the fees the page
  // loaded with, not on merged statuses, so an answer can't re-trigger a call.
  const statusIds: string[] = [];
  for (const p of visibleProperties) {
    const propUnits = unitsForProperty(p.id);
    const targets =
      propUnits.length === 0
        ? [{ unitId: null as string | null, monthlyRent: p.monthlyRent, vacant: p.vacant }]
        : propUnits.map((u) => ({ unitId: u.id as string | null, monthlyRent: u.monthlyRent, vacant: u.vacant }));
    const policy = policyFor(p.id);
    for (const t of targets) {
      if (t.vacant) continue;
      const tenant = tenantFor(p.id, t.unitId);
      if (!tenant || !feesExpected(tenant, policy)) continue;
      const rent = expectedRent({ propertyId: p.id, unitId: t.unitId, monthlyRent: t.monthlyRent }, barMonth);
      if (
        needsStatusCheck({
          rent,
          paid: rentInMonth(p.id, t.unitId, barMonth),
          fees: lateFees[`${tenant.id}|${barMonth}`] ?? 0,
          dueDay: tenant.dueDay,
          graceDays: (policy ?? DEFAULT_POLICY).graceDays,
          month: barMonth,
          today: todayKey,
        })
      )
        statusIds.push(tenant.id);
    }
  }
  const statusKey = statusIds.length ? `${barMonth}:${[...new Set(statusIds)].sort().join(",")}` : "";

  // One request for every such tenant at once, and once per set: re-renders
  // with the same tenants on screen don't ask again. A missing endpoint or a
  // failed request leaves the cards as they were.
  useEffect(() => {
    if (!statusKey || statusAsked.current.has(statusKey)) return;
    statusAsked.current.add(statusKey);
    const tenantIds = statusKey.slice(statusKey.indexOf(":") + 1).split(",");
    // No cancel on cleanup: an answer that lands after the view moved on is
    // still true of those tenants, and each status carries its month, so a
    // stale one is ignored where it doesn't apply.
    fetch("/api/late-fees/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantIds }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!body) return;
        const parsed = parseStatuses(body);
        if (Object.keys(parsed).length) setFeeStatuses((prev) => ({ ...prev, ...parsed }));
      })
      .catch(() => {});
  }, [statusKey]);

  // Leases running out are the other thing worth knowing before the month
  // turns — a lease that ended last week and nobody noticed is a vacancy.
  const leaseAlerts = useMemo(() => {
    return tenants
      .filter((t) => visibleIds.has(t.propertyId))
      .map((t) => ({ tenant: t, status: leaseStatus(t, now) }))
      .filter(({ status }) => status.kind === "ending" || status.kind === "expired")
      .sort((a, b) => (a.status.days ?? 0) - (b.status.days ?? 0));
  }, [tenants, visibleIds, now]);

  const search = query.trim().toLowerCase();

  // What the search box matches each entry against, built when the ledger or
  // the names in it change — not on every keystroke.
  const haystacks = useMemo(
    () =>
      new Map(
        transactions.map((t) => [
          t.id,
          [targetLabel(t), t.detail, t.note, t.category, t.amount.toFixed(2), fmtDate(t.date)].join(" ").toLowerCase(),
        ])
      ),
    // targetLabel reads properties and units.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transactions, properties, units]
  );

  // A search looks across every month. Hunting for "that plumber invoice" and
  // being told there's nothing in September — when it was in March — is the
  // opposite of useful, so the period only applies when you aren't searching.
  const rows = useMemo(() => {
    const base = search ? visibleTransactions : scopedTransactions;
    return base
      .filter((t) => !filterProperty || t.propertyId === filterProperty)
      .filter((t) => !filterType || t.type === filterType)
      .filter((t) => !search || (haystacks.get(t.id) ?? "").includes(search))
      .slice()
      .sort((a, b) => {
        const by = sortDir === "asc" ? 1 : -1;
        let first = 0;
        switch (sortKey) {
          case "property":
            first = compareText(targetLabel(a), targetLabel(b));
            break;
          case "type":
            // "expense" sorts before "rent", so ascending is expenses first.
            first = compareText(a.type, b.type);
            break;
          case "details":
            first = compareText(detailsText(a), detailsText(b));
            break;
          case "amount":
            first = a.amount - b.amount;
            break;
          default:
            first = a.date.localeCompare(b.date);
        }
        // Ties fall back to newest first, then the id, so the order never
        // shuffles between renders of the same data.
        return by * first || b.date.localeCompare(a.date) || a.id.localeCompare(b.id);
      });
  }, [scopedTransactions, visibleTransactions, filterProperty, filterType, search, sortKey, sortDir, haystacks]);

  const searchTotals = useMemo(() => totalsFor(null, rows), [rows]);

  // A few years in, "All time" is thousands of rows and the browser renders
  // every one of them before the page settles. Show a page at a time; the
  // period switcher and the search box are the real ways to narrow things.
  const LEDGER_PAGE = 60;
  const [ledgerLimit, setLedgerLimit] = useState(LEDGER_PAGE);
  useEffect(() => {
    setLedgerLimit(LEDGER_PAGE);
  }, [search, filterProperty, filterType, scopeKey, selectedCompany, sortKey, sortDir]);

  const visibleRows = rows.slice(0, ledgerLimit);
  const hiddenRows = rows.length - visibleRows.length;

  /** Click a column to sort by it; click the same one again to flip it. */
  function toggleSort(key: SortKey) {
    setSortDir((prev) => (sortKey === key ? (prev === "asc" ? "desc" : "asc") : FIRST_DIR[key]));
    setSortKey(key);
  }

  // A plain function rather than a component: a component declared in here
  // would be a new type every render, so React would tear the button down and
  // rebuild it on each click and the keyboard focus would go with it.
  function sortHead(key: SortKey, right = false) {
    const on = sortKey === key;
    return (
      <th
        aria-sort={on ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
        style={right ? { textAlign: "right" } : undefined}
      >
        <button
          type="button"
          className={`${styles.sortHead} ${on ? styles.sortOn : ""} ${right ? styles.sortRight : ""}`}
          onClick={() => toggleSort(key)}
          title={
            on
              ? `Sorted by ${SORT_LABEL[key].toLowerCase()} — click to reverse`
              : `Sort by ${SORT_LABEL[key].toLowerCase()}`
          }
        >
          {SORT_LABEL[key]}
          <span className={styles.sortArrow} aria-hidden="true">
            {on ? (sortDir === "asc" ? "\u2191" : "\u2193") : "\u2195"}
          </span>
        </button>
      </th>
    );
  }

  const activeCompany = companies.find((c) => c.id === selectedCompany) ?? null;

  /** The record sheet's key for a ledger place: a unit, a whole building, or a house. */
  function targetKeyOf(propertyId: string, unitId: string | null) {
    if (unitId) return `${propertyId}:${unitId}`;
    return unitsForProperty(propertyId).length > 0 ? `${propertyId}:whole` : propertyId;
  }

  function showSheet(next: EntryDraft) {
    setProofError(null);
    setError("");
    setDraft(next);
    setDraftSeq((n) => n + 1);
    setRecording(true);
  }

  /** "+ Record": a blank entry, dated in the month on screen. */
  function openRecord() {
    showSheet({
      mode: "new",
      targetKey: visibleTargets[0]?.key ?? "",
      prefill: {
        type: "rent",
        amount: "",
        date: defaultDateFor(barMonth, todayKey),
        detail: "",
        note: "",
        category: "",
      },
    });
  }

  type OwedRow = (typeof unpaidThisMonth)[number];

  /**
   * "Mark paid" and "Part paid" on a Needs attention row. They used to write
   * the whole amount straight to the ledger; now they open the rent form
   * with it filled in — tenant, place, what's owed including late fees,
   * dated today in the month on screen, noted as that month's rent — with
   * the amount selected. Enter records exactly what the old button did;
   * typing first records a part payment. Proof and a late fee waiver can go
   * on in the same step instead of after.
   */
  function quickRent(row: OwedRow) {
    const { target, expected, paid, fees, tenant } = row;
    showSheet({
      mode: "quick",
      targetKey: target.key,
      prefill: rentPrefill({ month: barMonth, today: todayKey, expected, paid, fees, tenantName: tenant?.name }),
      context: `${tenant ? `${tenant.name} · ` : ""}${monthName(barMonth)} · ${owedLine({ expected, paid, fees })}`,
    });
  }

  /**
   * "Log it" on a recurring bill: the expense form, filled from the template
   * and dated on the bill's day in the month on screen. It still saves
   * through the template, so it's linked to it and counts for that month.
   */
  function quickRecurring(r: RecurringExpense) {
    showSheet({
      mode: "quick",
      targetKey: targetKeyOf(r.propertyId, r.unitId),
      prefill: recurringPrefill(r, barMonth),
      recurring: { id: r.id, month: barMonth },
      context: `${r.category}${r.detail ? ` · ${r.detail}` : ""} · ${monthName(barMonth)} ${
        r.frequency === "monthly" ? "monthly" : "yearly"
      } bill`,
    });
  }

  /**
   * Only the bulk "Mark all paid" writes rent without the form, and only
   * after a confirmation that lists every amount.
   */
  async function postRent(target: Target, owed: number, tenantName?: string) {
    const res = await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propertyId: target.propertyId,
        unitId: target.unitId,
        type: "rent",
        date: defaultDateFor(barMonth, todayKey),
        amount: owed,
        detail: tenantName ?? "",
        note: `${monthName(barMonth)} rent`,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false as const, error: data?.error as string | undefined };
    setTransactions((prev) => [...prev, { ...data, attachments: [] }]);
    return { ok: true as const };
  }

  /**
   * The same thing for every tenant who owes, because on the 3rd of the month
   * most of them have paid and clearing them one row at a time is the bulk of
   * the work. Kept as one action rather than a form per tenant — that would
   * be the row buttons again — but it never writes silently: the
   * confirmation lists each tenant and amount, and it posts one entry per
   * tenant, so any single one can still be edited or removed afterwards.
   */
  function markAllPaid() {
    const rows = unpaidThisMonth;
    if (rows.length === 0) return;
    const summary = bulkSummary(
      rows.map((r) => ({ name: r.tenant?.name ?? r.target.label, owed: r.expected + r.fees - r.paid }))
    );
    setConfirming({
      title: `Record ${money(summary.total)} of rent?`,
      body: `One entry per tenant, dated in ${monthName(barMonth)}, for the full amount each still owes. To change an amount, add proof or waive a fee, use that row's Mark paid instead.`,
      lines: summary.lines.map((l) => ({ label: l.name, amount: money(l.owed) })),
      confirmLabel: `Record ${rows.length} payments`,
      onConfirm: async () => {
        setBulkBusy("rent");
        let done = 0;
        let failed = 0;
        for (const r of rows) {
          const result = await postRent(r.target, r.expected + r.fees - r.paid, r.tenant?.name);
          if (result.ok) done += 1;
          else failed += 1;
        }
        setBulkBusy("");
        if (failed > 0) push(`Recorded ${done}; ${failed} didn't save. Check the ledger.`, "bad");
        else push(`${money(summary.total)} recorded across ${done} ${done === 1 ? "tenant" : "tenants"}.`);
      },
    });
  }

  /** Opens the same sheet over an existing entry, to correct it in place. */
  function openEdit(t: Transaction) {
    showSheet({
      mode: "edit",
      editingId: t.id,
      existingProof: t.attachments.length,
      targetKey: targetKeyOf(t.propertyId, t.unitId),
      prefill: {
        type: t.type,
        amount: String(t.amount),
        date: t.date,
        detail: t.detail,
        note: t.note,
        category: t.category,
      },
    });
  }

  /** The sheet saved an entry: put it in the ledger and say so. */
  function entrySaved({ entry, created, waive }: { entry: SavedEntry; created: boolean; waive: boolean | null }) {
    setTransactions((prev) =>
      prev.some((t) => t.id === entry.id)
        ? prev.map((t) => (t.id === entry.id ? { ...t, ...entry, attachments: t.attachments } : t))
        : [...prev, { ...entry, attachments: [] }]
    );
    const where = targetLabel(entry);
    const waived = waive === null ? "" : waive ? " Late fee waived for the month." : " Late fees apply again from today.";
    push(
      created
        ? entry.recurringExpenseId
          ? `${money(entry.amount)} ${entry.category || "bill"} logged for ${where}.`
          : `${entry.type === "rent" ? "Rent" : "Expense"} of ${money(entry.amount)} recorded for ${
              entry.type === "rent" && entry.detail ? entry.detail : where
            }.${waived}`
        : `Entry updated — ${money(entry.amount)} for ${where}.${waived}`
    );
    // The late fees and waived months on screen come from the server.
    if (waive !== null) router.refresh();
  }

  function proofLanded(entryId: string, proof: ProofDTO) {
    setTransactions((prev) =>
      prev.map((t) => (t.id === entryId ? { ...t, attachments: [...(t.attachments ?? []), proof] } : t))
    );
  }

  async function addCompany(e: React.FormEvent) {
    e.preventDefault();
    const name = companyName.trim();
    if (!name) return;
    setError("");

    const res = await fetch("/api/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.error || "Couldn't add that LLC.");
      return;
    }
    setCompanies((prev) => [...prev, data]);
    setSelectedCompany(data.id);
    setCompanyName("");
    setAddingCompany(false);
    push(`${data.name} added.`);
  }

  async function joinWithCode(e: React.FormEvent) {
    e.preventDefault();
    const code = joinCode.trim();
    if (!code) return;
    setError("");
    setJoinBusy(true);

    const res = await fetch("/api/invites/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await res.json().catch(() => ({}));
    setJoinBusy(false);
    if (!res.ok) {
      setError(data?.error || "Couldn't join with that code.");
      return;
    }
    // Full reload so the newly visible LLC's properties and ledger come with it.
    window.location.href = "/dashboard";
  }

  function openPropertyForm() {
    setPropCompany(selectedCompany !== "all" ? selectedCompany : companies[0]?.id ?? "");
    setAddingProperty(true);
  }

  async function addProperty(e: React.FormEvent) {
    e.preventDefault();
    const name = propName.trim();
    if (!name || !propCompany) return;
    setError("");

    const res = await fetch("/api/properties", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        address: propAddress.trim(),
        monthlyRent: parseFloat(propRent) || 0,
        companyId: propCompany,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.error || "Couldn't add that property.");
      return;
    }
    setProperties((prev) => [...prev, data]);
    setPropName("");
    setPropAddress("");
    setPropRent("");
    setAddingProperty(false);
    push(`${data.name} added.`);
  }

  function startEditProperty(p: Property) {
    setEditingPropertyId(p.id);
    setEditName(p.name);
    setEditAddress(p.address);
    setEditRent(p.monthlyRent ? String(p.monthlyRent) : "");
    setEditVacant(p.vacant);
    setError("");
  }

  function cancelEditProperty() {
    setEditingPropertyId("");
  }

  async function saveEditProperty(e: React.FormEvent) {
    e.preventDefault();
    const name = editName.trim();
    if (!name) return;
    setError("");
    setEditSaving(true);

    const res = await fetch(`/api/properties/${editingPropertyId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        address: editAddress.trim(),
        monthlyRent: parseFloat(editRent) || 0,
        vacant: editVacant,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setEditSaving(false);
    if (!res.ok) {
      setError(data?.error || "Couldn't save those changes.");
      return;
    }

    // rentChanges rides along on the response but isn't part of the property.
    const { rentChanges: updatedHistory, ...propertyFields } = data as Property & {
      rentChanges?: RentChangeDTO[];
    };
    setProperties((prev) =>
      prev.map((p) => (p.id === editingPropertyId ? { ...p, ...propertyFields } : p))
    );
    if (updatedHistory) {
      setRentChanges((prev) => [
        ...prev.filter((c) => !(c.propertyId === editingPropertyId && c.unitId === null)),
        ...updatedHistory,
      ]);
    }
    setEditingPropertyId("");
    push("Changes saved.");
  }

  function removeProperty(p: Property) {
    const count = transactions.filter((t) => t.propertyId === p.id).length;
    setConfirming({
      title: `Remove ${p.name}?`,
      body: count
        ? `This property has ${count} ledger ${count === 1 ? "entry" : "entries"}. Removing it deletes those entries, its units and its recurring expenses too. This can't be undone.`
        : "Its units and recurring expenses go with it. This can't be undone.",
      confirmLabel: "Remove property",
      danger: true,
      onConfirm: async () => {
        const res = await fetch(`/api/properties/${p.id}`, { method: "DELETE" });
        if (!res.ok) {
          push("Couldn't remove that property.", "bad");
          return;
        }
        setProperties((prev) => prev.filter((x) => x.id !== p.id));
        setTransactions((prev) => prev.filter((t) => t.propertyId !== p.id));
        setUnits((prev) => prev.filter((u) => u.propertyId !== p.id));
        setRecurring((prev) => prev.filter((r) => r.propertyId !== p.id));
        push(`${p.name} removed.`);
      },
    });
  }

  function removeTransaction(t: Transaction) {
    setConfirming({
      title: "Delete this entry?",
      body: `${t.type === "rent" ? "Rent" : "Expense"} of ${money(t.amount)} on ${fmtDate(
        t.date
      )} for ${targetLabel(t)}. Any proof attached to it is deleted too.`,
      confirmLabel: "Delete entry",
      danger: true,
      onConfirm: async () => {
        const res = await fetch(`/api/transactions/${t.id}`, { method: "DELETE" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          push(data?.error || "Couldn't delete that entry.", "bad");
          return;
        }
        setTransactions((prev) => prev.filter((x) => x.id !== t.id));
        push("Entry deleted.");
      },
    });
  }

  /** Uploads one file and files the returned attachment onto its transaction. */
  async function uploadProof(transactionId: string, file: File, scope: string) {
    let res: Response;
    try {
      const prepared = await shrinkImage(file);
      const form = new FormData();
      form.append("file", prepared);
      res = await fetch(`/api/transactions/${transactionId}/attachments`, {
        method: "POST",
        body: form,
      });
    } catch {
      setProofError({ scope, message: `Couldn't upload ${file.name} — check your connection.` });
      return false;
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setProofError({ scope, message: data?.error || `Couldn't upload ${file.name}.` });
      return false;
    }

    setTransactions((prev) =>
      prev.map((t) =>
        t.id === transactionId ? { ...t, attachments: [...(t.attachments ?? []), data] } : t
      )
    );
    return true;
  }

  async function addProofToRow(transactionId: string, files: FileList | null) {
    if (!files || files.length === 0) return;
    setProofError(null);
    setUploadingFor(transactionId);
    let attached = 0;
    for (const file of Array.from(files)) {
      if (!(await uploadProof(transactionId, file, transactionId))) break;
      attached += 1;
    }
    setUploadingFor("");
    if (attached > 0) push(`${attached} ${attached === 1 ? "proof" : "proofs"} attached.`);
  }

  async function removeAttachment(attachmentId: string) {
    const res = await fetch(`/api/attachments/${attachmentId}`, { method: "DELETE" });
    if (!res.ok) return;
    setTransactions((prev) =>
      prev.map((t) => ({ ...t, attachments: t.attachments.filter((a) => a.id !== attachmentId) }))
    );
  }

  /**
   * Records a mortgage payment for the month on screen at the split shown,
   * which writes interest and escrow into the ledger and takes the principal
   * off the balance. Returns false when the server refused it.
   */
  async function postLoanPayment(loanId: string) {
    const res = await fetch(`/api/loans/${loanId}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month: barMonth }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false as const, error: (data?.error as string) || "Couldn't log that payment." };
    const payment = data.payment as LoanPaymentDTO;
    setLoans((prev) =>
      prev.map((l) =>
        l.id === loanId
          ? { ...l, payments: [...l.payments, payment].sort((a, b) => a.month.localeCompare(b.month)) }
          : l
      )
    );
    setTransactions((prev) => [
      ...prev,
      ...(data.transactions as Transaction[]).map((t) => ({ ...t, attachments: [] })),
    ]);
    return { ok: true as const, payment };
  }

  /** A mortgage's form saved a payment: file it and its ledger entries. */
  function loanRecorded(loanId: string, payment: LoanPaymentDTO, entries: unknown[]) {
    setLoans((prev) =>
      prev.map((l) =>
        l.id === loanId
          ? { ...l, payments: [...l.payments, payment].sort((a, b) => a.month.localeCompare(b.month)) }
          : l
      )
    );
    setTransactions((prev) => [...prev, ...(entries as Transaction[]).map((t) => ({ ...t, attachments: [] }))]);
    setPayingLoanId("");
    push(
      `Logged: ${money(payment.interest)} interest${payment.escrow > 0 ? `, ${money(payment.escrow)} escrow` : ""}, ${money(payment.principal)} off the loan.`
    );
  }

  /** Every recurring bill and mortgage payment due this period, logged in one go. */
  function logAllRecurring() {
    const rows = dueRecurring;
    const loanRows = dueLoans;
    const count = rows.length + loanRows.length;
    if (count === 0) return;
    const total = rows.reduce((sum, r) => sum + r.amount, 0) + loanRows.reduce((sum, l) => sum + l.total, 0);
    setConfirming({
      title: `Log ${money(total)} of bills?`,
      body: `Adds ${count} ${count === 1 ? "bill" : "bills"} for ${monthName(barMonth)} at the amounts below.${
        loanRows.length ? " Mortgage principal comes off the loan rather than going in as an expense." : ""
      }`,
      lines: [
        ...rows.map((r) => ({ label: `${r.category}${r.detail ? ` · ${r.detail}` : ""}`, amount: money(r.amount) })),
        ...loanRows.map((l) => ({ label: l.loan.lender, amount: money(l.total) })),
      ],
      confirmLabel: `Log ${count} bills`,
      onConfirm: async () => {
        setBulkBusy("bills");
        let failed = 0;
        for (const l of loanRows) {
          if (!(await postLoanPayment(l.loan.id)).ok) failed += 1;
        }
        for (const r of rows) {
          const res = await fetch(`/api/recurring/${r.id}/log`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ month: barMonth }),
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok) setTransactions((prev) => [...prev, { ...data, attachments: [] }]);
          else failed += 1;
        }
        setBulkBusy("");
        if (failed > 0) push(`${failed} of ${count} bills didn't log.`, "bad");
        else push(`${money(total)} of bills logged for ${monthName(barMonth, false)}.`);
      },
    });
  }

  const deltaFor = (current: number, prior: number | undefined, upIsGood: boolean, priorEmpty = false) => {
    if (prior === undefined || previous === null) return null;
    // An empty previous period isn't a baseline: "↑ $37,112 vs Aug" when
    // August had nothing is noise.
    if (!comparable(prior, priorEmpty)) {
      return (
        <span className={styles.delta}>
          <span className={styles.deltaNote}>No data for {previous.label}</span>
        </span>
      );
    }
    const change = current - prior;
    if (Math.abs(change) < 0.005) {
      return (
        <span className={styles.delta}>
          No change <span className={styles.deltaNote}>vs {previous.label}</span>
        </span>
      );
    }
    const up = change > 0;
    const good = up === upIsGood;
    return (
      <span className={`${styles.delta} ${good ? styles.good : styles.bad}`}>
        {up ? "↑" : "↓"} {money(Math.abs(change))}{" "}
        <span className={styles.deltaNote}>vs {previous.label}</span>
      </span>
    );
  };

  const canStepBack =
    periodKind === "month" ? monthIndex > 0 : periodKind === "year" ? yearIndex > 0 : false;
  const canStepForward =
    periodKind === "month"
      ? monthIndex >= 0 && monthIndex < months.length - 1
      : periodKind === "year"
        ? yearIndex >= 0 && yearIndex < years.length - 1
        : false;

  function stepPeriod(delta: number) {
    if (periodKind === "month") setSelectedMonth(months[monthIndex + delta]);
    else if (periodKind === "year") setSelectedYear(years[yearIndex + delta]);
  }

  const collectPct =
    collection.expected > 0
      ? Math.min(100, Math.round((collection.collected / collection.expected) * 100))
      : 0;
  const collectDone = collection.expected > 0 && collection.collected >= collection.expected;

  // Repairs the tenants can see but you can't dismiss from here: this is a
  // pointer at the queue, not a second place to work them, because a repair
  // needs a status and a reply, not a one-tap clear.
  const repairAlerts = initialRepairs.filter((r) => visibleIds.has(r.propertyId));
  // Scoped to the LLC chip like everything else. Vendor paperwork has no
  // property, so it's matched on the company.
  const docAlerts = byUrgency(
    expiringDocs.filter(
      (d) =>
        (selectedCompany === "all" || d.companyId === selectedCompany) &&
        expiryState(d.expiresOn, todayKey) !== "ok"
    ),
    todayKey
  );
  // A deposit owed back is a legal deadline, not a nice-to-have: overdue first.
  const depositAlerts = deposits
    .filter((d) => !d.returnedOn && visibleIds.has(d.propertyId))
    .map((d) => ({ ...d, state: returnState(d, todayKey) }))
    .sort((a, b) => (a.returnBy ?? "9999").localeCompare(b.returnBy ?? "9999"));

  // Empty places, longest first, with the rent they've gone without. Only
  // ones with a known start: a place marked vacant years ago with no date
  // would sit here forever with a number nobody can check.
  const vacancies = visibleTargets
    .filter((t) => t.vacant && t.vacantSince)
    .map((t) => {
      const since = t.vacantSince!;
      return {
        target: t,
        since,
        days: vacantDays(since, todayKey),
        lost: vacancyCost(since, todayKey, (month) => expectedRent(t, month)),
      };
    })
    .sort((a, b) => b.days - a.days);

  // Listings (a27): each vacancy row says whether its place is listed; any
  // listing with people waiting that isn't on an empty place gets a row too.
  const listingFor = (t: { propertyId: string; unitId: string | null }) =>
    initialListings.find((l) => l.propertyId === t.propertyId && (l.unitId ?? null) === (t.unitId ?? null));
  const listingAlerts = initialListings.filter(
    (l) => l.waiting > 0 && visibleIds.has(l.propertyId) && !vacancies.some((v) => listingFor(v.target)?.id === l.id)
  );

  const attentionCount =
    listingAlerts.length +
    vacancies.length +
    depositAlerts.length +
    repairAlerts.length +
    unpaidThisMonth.length +
    leaseAlerts.length +
    dueRecurring.length +
    dueLoans.length +
    docAlerts.length;

  return (
    <AppShell
      openRepairs={openRepairs}
      title="Overview"
      tagline="Rent collected, repairs paid, and the profit left over — by property."
      userLabel={userLabel}
      actions={
        companies.length > 0 && !viewOnly ? (
          <>
            <Link href="/dashboard/import" className={styles.btn}>
              Import from bank
            </Link>
            <button
              type="button"
              className={`${styles.btn} ${styles.accent} ${styles.desktopOnly}`}
              onClick={() => openRecord()}
            >
              + Record a transaction
            </button>
          </>
        ) : undefined
      }
    >
      <nav className={styles.contextBar} aria-label="Scope">
        <div className={styles.companyBar}>
          {companies.length > 1 && (
            <button
              type="button"
              className={`${styles.chip} ${selectedCompany === "all" ? styles.active : ""}`}
              onClick={() => setSelectedCompany("all")}
            >
              All LLCs
            </button>
          )}
          {companies.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`${styles.chip} ${selectedCompany === c.id ? styles.active : ""}`}
              onClick={() => setSelectedCompany(c.id)}
            >
              {c.name}
            </button>
          ))}
          {viewOnly ? null : addingCompany ? (
            <form className={styles.inlineForm} onSubmit={addCompany}>
              <input
                id="new-company"
                type="text"
                autoFocus
                placeholder="e.g. Birchwood Holdings LLC"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
              />
              <button type="submit" className={`${styles.btn} ${styles.small} ${styles.primary}`}>
                Add
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.small}`}
                onClick={() => {
                  setAddingCompany(false);
                  setCompanyName("");
                }}
              >
                Cancel
              </button>
            </form>
          ) : (
            <button type="button" className={`${styles.chip} ${styles.chipAdd}`} onClick={() => setAddingCompany(true)}>
              + LLC
            </button>
          )}

          {joining ? (
            <form className={styles.inlineForm} onSubmit={joinWithCode}>
              <input
                id="join-code"
                type="text"
                autoFocus
                placeholder="Join code, e.g. K7P2-M9X4"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
              />
              <button type="submit" className={`${styles.btn} ${styles.small} ${styles.primary}`} disabled={joinBusy}>
                {joinBusy ? "Joining…" : "Join"}
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.small}`}
                onClick={() => {
                  setJoining(false);
                  setJoinCode("");
                }}
              >
                Cancel
              </button>
            </form>
          ) : (
            <button
              type="button"
              className={`${styles.chip} ${styles.chipAdd}`}
              onClick={() => setJoining(true)}
              aria-label="Join an LLC with a code"
            >
              Join code
            </button>
          )}
        </div>

        <div className={styles.monthBar}>
          <button
            type="button"
            className={styles.monthArrow}
            aria-label={periodKind === "year" ? "Previous year" : "Previous month"}
            disabled={!canStepBack}
            onClick={() => stepPeriod(-1)}
          >
            ‹
          </button>
          <span className={styles.monthLabel}>{periodLabel}</span>
          <button
            type="button"
            className={styles.monthArrow}
            aria-label={periodKind === "year" ? "Next year" : "Next month"}
            disabled={!canStepForward}
            onClick={() => stepPeriod(1)}
          >
            ›
          </button>
          <div className={styles.periodToggle} role="group" aria-label="Period">
            {(["month", "year", "all"] as PeriodKind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                className={periodKind === kind ? styles.active : ""}
                aria-pressed={periodKind === kind}
                onClick={() => setPeriodKind(kind)}
              >
                {kind === "month" ? "Month" : kind === "year" ? "Year" : "All"}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {error && <div className={styles.errorBar}>{error}</div>}

      {companies.length === 0 ? (
        <div className={styles.firstRun}>
          <h2>Start with an LLC</h2>
          <p>
            Properties live under the company that owns them, so add your first LLC and then add its houses. You can
            invite partners to each LLC separately from the Team page.
          </p>
        </div>
      ) : (
        <>
          <section className={styles.kpis} aria-label="Totals">
            <div className={`${styles.kpi} ${styles.rentKpi}`}>
              <div className={styles.kpiLabel}>Rent collected</div>
              <div className={`${styles.kpiValue} num`}>{money(overall.rent)}</div>
              <div className={styles.kpiFoot}>
                {deltaFor(overall.rent, previous?.rent, true) ?? (
                  <span className={styles.delta}>
                    <span className={styles.deltaNote}>
                      all time{activeCompany ? ` · ${activeCompany.name}` : ""}
                    </span>
                  </span>
                )}
                <span className={styles.kpiSpark}>
                  <Sparkline points={series.map((s) => s.rent)} tone="accent" />
                </span>
              </div>
            </div>

            <div className={`${styles.kpi} ${styles.expenseKpi}`}>
              <div className={styles.kpiLabel}>Repairs &amp; expenses</div>
              <div className={`${styles.kpiValue} num`}>{money(overall.expense)}</div>
              <div className={styles.kpiFoot}>
                {deltaFor(overall.expense, previous?.expense, false) ?? (
                  <span className={styles.delta}>
                    <span className={styles.deltaNote}>
                      {scopedTransactions.filter((t) => t.type === "expense").length} logged
                    </span>
                  </span>
                )}
                <span className={styles.kpiSpark}>
                  <Sparkline points={series.map((s) => s.expense)} tone="expense" />
                </span>
              </div>
            </div>

            <div className={`${styles.kpi} ${styles.netKpi}`}>
              <div className={styles.kpiLabel}>Net profit</div>
              <div className={`${styles.kpiValue} num ${overall.net >= 0 ? styles.pos : styles.neg}`}>
                {overall.net >= 0 ? "" : "−"}
                {money(Math.abs(overall.net))}
              </div>
              <div className={styles.kpiFoot}>
                {deltaFor(overall.net, previous?.net, true, !!previous && !comparable(previous.rent) && !comparable(previous.expense)) ?? (
                  <span className={styles.delta}>
                    <span className={styles.deltaNote}>
                      {overall.net >= 0 ? "in the black to date" : "in the red to date"}
                    </span>
                  </span>
                )}
                <span className={styles.kpiSpark}>
                  <Sparkline points={series.map((s) => s.rent - s.expense)} tone="neutral" />
                </span>
              </div>
            </div>
          </section>

          {collection.dueCount > 0 && (
            <section className={styles.collect} aria-label="Rent collection progress">
              <div className={styles.collectTop}>
                <span className={styles.collectTitle}>{monthName(barMonth)} rent roll</span>
                <span className={`${styles.collectFigure} num`}>
                  {money(collection.collected)}{" "}
                  <span className={styles.of}>of {money(collection.expected)}</span>
                </span>
              </div>
              <div className={styles.bigBar}>
                <span
                  className={collectDone ? styles.barFull : undefined}
                  style={{ width: `${collectPct}%` }}
                />
              </div>
              <div className={styles.collectMeta}>
                <span>
                  {collection.paidCount} of {collection.dueCount}{" "}
                  {collection.dueCount === 1 ? "unit has" : "units have"} paid in full
                </span>
                <span>{collectPct}%</span>
              </div>
            </section>
          )}

          <section className={styles.chartGrid} aria-label="Charts">
            <div className={styles.card}>
              <CashFlowChart
                data={
                  ahead
                    ? ahead.months.map((m) => ({ month: m.month, rent: m.rent, expense: m.out }))
                    : series
                }
                projected={Boolean(ahead)}
                controls={
                  <div className={styles.periodToggle} role="group" aria-label="Cash flow">
                    <button
                      type="button"
                      className={cashView === "past" ? styles.active : ""}
                      aria-pressed={cashView === "past"}
                      onClick={() => setCashView("past")}
                    >
                      Past year
                    </button>
                    <button
                      type="button"
                      className={cashView === "next" ? styles.active : ""}
                      aria-pressed={cashView === "next"}
                      onClick={() => setCashView("next")}
                    >
                      Year ahead
                    </button>
                  </div>
                }
                notes={
                  ahead && (
                    <ul className={styles.aheadNotes}>
                      {ahead.lowest && (
                        <li>
                          {ahead.lowest.net < 0 ? "Short month" : "Lowest month"}: <b>{monthName(ahead.lowest.month)}</b>,{" "}
                          <b className={`num ${ahead.lowest.net < 0 ? styles.neg : ""}`}>
                            {ahead.lowest.net < 0 ? "−" : ""}
                            {money(Math.abs(ahead.lowest.net))}
                          </b>{" "}
                          net
                          {ahead.lowest.lines[0] &&
                            ` — the biggest bill is ${ahead.lowest.lines[0].label}, ${money(ahead.lowest.lines[0].amount)}`}
                          .
                        </li>
                      )}
                      {ahead.atRisk > 0 && (
                        <li>
                          <b className="num">{money(ahead.atRisk)}</b> of it is rent after a lease ends with no renewal:{" "}
                          {ahead.ending.slice(0, 3).map((t, i) => (
                            <span key={t.id}>
                              {i > 0 ? ", " : ""}
                              <Link
                                href={
                                  viewOnly
                                    ? `/dashboard/properties/${t.propertyId}#tenant-${t.id}`
                                    : `/dashboard/properties/${t.propertyId}?renew=${t.id}#tenant-${t.id}`
                                }
                              >
                                {t.name}
                              </Link>{" "}
                              ({formatDay(t.leaseEnd)})
                            </span>
                          ))}
                          {ahead.ending.length > 3 ? ` and ${ahead.ending.length - 3} more` : ""}.
                        </li>
                      )}
                      {ahead.other.perMonth > 0 && (
                        <li>
                          Includes <b className="num">{money(ahead.other.perMonth)}</b> a month for repairs and other
                          spending — the average of the last {ahead.other.months}{" "}
                          {ahead.other.months === 1 ? "month" : "months"}.
                        </li>
                      )}
                    </ul>
                  )
                }
              />
            </div>
            <div className={styles.card}>
              <CategoryBars
                data={byCategory}
                caption={periodLabel}
              />
            </div>
          </section>

          <section className={styles.block}>
              <div className={styles.blockHead}>
                <h2>Needs attention — {monthName(barMonth, false)}</h2>
                <div className={styles.headTools}>
                  {attentionCount > 0 && (
                    <span className={styles.count}>
                      {attentionCount} {attentionCount === 1 ? "item" : "items"}
                    </span>
                  )}
                  {/* Only worth offering once there's more than one of a thing
                      to clear — with a single row the per-row button is fewer
                      taps and needs no confirming. */}
                  {!viewOnly && unpaidThisMonth.length > 1 && (
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.small}`}
                      disabled={bulkBusy !== ""}
                      onClick={markAllPaid}
                    >
                      {bulkBusy === "rent" ? "Recording…" : `Mark all ${unpaidThisMonth.length} paid`}
                    </button>
                  )}
                  {!viewOnly && dueRecurring.length + dueLoans.length > 1 && (
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.small}`}
                      disabled={bulkBusy !== ""}
                      onClick={logAllRecurring}
                    >
                      {bulkBusy === "bills"
                        ? "Logging…"
                        : `Log all ${dueRecurring.length + dueLoans.length} bills`}
                    </button>
                  )}
                </div>
              </div>

              {attentionCount === 0 ? (
                <div className={styles.allClear}>
                  <span className={styles.allClearMark} aria-hidden="true">
                    ✓
                  </span>
                  Every unit has paid, every recurring bill is logged, nothing is waiting to be
                  fixed, and no lease is running out.
                </div>
              ) : (
                <div className={styles.attnList}>
                  {repairAlerts.map((r) => (
                    <div key={`r-${r.id}`} className={styles.attnRow}>
                      <div className={styles.attnMain}>
                        <div className={styles.attnLabel}>
                          {r.title}{" "}
                          <span
                            className={`${styles.pill} ${r.urgency === "urgent" ? styles.bill : styles.owed}`}
                          >
                            {r.urgency === "urgent" ? "Urgent repair" : STATUS_LABEL[r.status].landlord}
                          </span>
                        </div>
                        <div className={styles.attnSub}>
                          {[r.propertyName, r.unitName].filter(Boolean).join(" — ")} ·{" "}
                          {r.tenantName || "a tenant"} · {ago(r.createdAt, clock)}
                        </div>
                      </div>
                      <div className={styles.attnActions}>
                        <Link
                          className={`${styles.btn} ${styles.small} ${styles.quiet}`}
                          href="/dashboard/repairs"
                        >
                          {viewOnly ? "Open" : "Work it"}
                        </Link>
                      </div>
                    </div>
                  ))}
                  {unpaidThisMonth.map((row) => {
                    const { target, expected, paid, fees, tenant, late } = row;
                    return (
                    <div key={`u-${target.key}`} className={styles.attnRow}>
                      <div className={styles.attnMain}>
                        <div className={styles.attnLabel}>
                          <Link
                            href={
                              tenant
                                ? `/dashboard/properties/${target.propertyId}#tenant-${tenant.id}`
                                : `/dashboard/properties/${target.propertyId}`
                            }
                            className={styles.attnLink}
                            title={tenant ? `Open ${tenant.name}\u2019s card` : `Open ${target.label}`}
                          >
                            {tenant ? tenant.name : target.label}
                          </Link>{" "}
                          {late > 0 ? (
                            <span className={`${styles.pill} ${styles.bill}`}>
                              {late === 1 ? "1 day late" : `${late} days late`}
                            </span>
                          ) : (
                            <span className={`${styles.pill} ${styles.owed}`}>Rent owed</span>
                          )}
                        </div>
                        <div className={styles.attnSub}>
                          {tenant ? `${target.label} · ` : ""}
                          {paid > 0
                            ? `${money(paid)} of ${money(expected)} paid so far`
                            : `Nothing received of ${money(expected)}`}
                          {fees > 0.005 ? ` · includes ${money(fees)} in late fees` : ""}
                          {/* a21 */}
                          {tenant && waivedLateFees[`${tenant.id}|${barMonth}`] ? " · Late fee waived" : ""}
                        </div>
                      </div>
                      <span className={`${styles.attnAmt} ${late > 0 ? styles.neg : styles.due} num`}>
                        {money(expected + fees - paid)}
                      </span>
                      <div className={styles.attnActions}>
                        {tenant &&
                          !viewOnly &&
                          (() => {
                            const chase = chases[tenant.id];
                            // Only count a chase about *this* month: last
                            // month's reminder says nothing about this one.
                            const recent =
                              chase?.month === barMonth && chasedRecently(chase.at);
                            return (
                              <button
                                type="button"
                                className={`${styles.btn} ${styles.small} ${
                                  recent ? styles.quiet : styles.primary
                                }`}
                                disabled={chasing === tenant.id}
                                title={
                                  recent
                                    ? `Reminded ${remindedAgo(chase.at, clock)}${
                                        chase.read ? " · they've read it" : " · not read yet"
                                      }`
                                    : `Send ${tenant.name} a reminder`
                                }
                                onClick={() =>
                                  remind(tenant, barMonth, expected, paid, tenant.name)
                                }
                              >
                                {chasing === tenant.id
                                  ? "Sending\u2026"
                                  : recent
                                    ? `Reminded ${remindedAgo(chase.at, clock)}`
                                    : "Remind"}
                              </button>
                            );
                          })()}
                        {tenant?.phone && (
                          <>
                            <a
                              className={`${styles.btn} ${styles.small} ${styles.quiet}`}
                              href={telHref(tenant.phone)}
                              aria-label={`Call ${tenant.name}`}
                            >
                              Call
                            </a>
                            <a
                              className={`${styles.btn} ${styles.small} ${styles.quiet}`}
                              href={smsHref(tenant.phone)}
                              aria-label={`Text ${tenant.name}`}
                            >
                              Text
                            </a>
                          </>
                        )}
                        {/* Both open the rent form with what's owed in it and
                            selected: Enter records it all, typing records part. */}
                        {!viewOnly && (
                          <>
                            <button
                              type="button"
                              className={`${styles.btn} ${styles.small} ${styles.quiet}`}
                              onClick={() => quickRent(row)}
                            >
                              Part paid
                            </button>
                            <button
                              type="button"
                              className={`${styles.btn} ${styles.small} ${styles.primary}`}
                              onClick={() => quickRent(row)}
                            >
                              Mark paid
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    );
                  })}

                  {leaseAlerts.map(({ tenant, status }) => (
                    <div key={`l-${tenant.id}`} className={styles.attnRow}>
                      <div className={styles.attnMain}>
                        <div className={styles.attnLabel}>
                          <Link
                            href={`/dashboard/properties/${tenant.propertyId}#tenant-${tenant.id}`}
                            className={styles.attnLink}
                            title={`Open ${tenant.name}\u2019s card`}
                          >
                            {tenant.name}
                          </Link>{" "}
                          <span
                            className={`${styles.pill} ${status.kind === "expired" ? styles.bill : styles.owed}`}
                          >
                            {status.label}
                          </span>
                        </div>
                        <div className={styles.attnSub}>
                          {targetLabel({ propertyId: tenant.propertyId, unitId: tenant.unitId })} ·{" "}
                          {status.kind === "expired" ? "ended" : "ends"} {formatDay(tenant.leaseEnd)}
                        </div>
                      </div>
                      <div className={styles.attnActions}>
                        {tenant.phone && (
                          <a
                            className={`${styles.btn} ${styles.small} ${styles.quiet}`}
                            href={telHref(tenant.phone)}
                          >
                            Call
                          </a>
                        )}
                        {!viewOnly && (
                          <Link
                            href={`/dashboard/properties/${tenant.propertyId}?renew=${tenant.id}#tenant-${tenant.id}`}
                            className={`${styles.btn} ${styles.small}`}
                          >
                            Renew
                          </Link>
                        )}
                      </div>
                    </div>
                  ))}

                  {docAlerts.map((d) => {
                    const state = expiryState(d.expiresOn, todayKey);
                    return (
                      <div key={`d-${d.id}`} className={styles.attnRow}>
                        <div className={styles.attnMain}>
                          <div className={styles.attnLabel}>
                            {d.title}{" "}
                            <span className={`${styles.pill} ${state === "expired" ? styles.bill : styles.owed}`}>
                              {expiryLabel(d.expiresOn, todayKey, formatDay)}
                            </span>
                          </div>
                          <div className={styles.attnSub}>
                            {d.kind} · {d.ownerLabel}
                          </div>
                        </div>
                        <div className={styles.attnActions}>
                          <FileActions url={d.url} name={d.filename || d.title} mime={d.contentType} />
                          {!viewOnly && (
                            <Link
                              href={
                                d.vendorId
                                  ? "/dashboard/repairs/vendors"
                                  : d.propertyId
                                    ? `/dashboard/properties/${d.propertyId}`
                                    : "/dashboard"
                              }
                              className={`${styles.btn} ${styles.small}`}
                            >
                              Replace
                            </Link>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {dueRecurring.map((r) => (
                    <div key={`r-${r.id}`} className={styles.attnRow}>
                      <div className={styles.attnMain}>
                        <div className={styles.attnLabel}>
                          {targetLabel(r)} <span className={`${styles.pill} ${styles.bill}`}>{r.category}</span>
                        </div>
                        <div className={styles.attnSub}>
                          {r.detail || `${r.frequency === "monthly" ? "Monthly" : "Yearly"} bill, not logged yet`}
                        </div>
                      </div>
                      <span className={`${styles.attnAmt} ${styles.neg} num`}>{money(r.amount)}</span>
                      {!viewOnly && (
                        <div className={styles.attnActions}>
                          <button
                            type="button"
                            className={`${styles.btn} ${styles.small}`}
                            onClick={() => quickRecurring(r)}
                          >
                            Log it
                          </button>
                        </div>
                      )}
                    </div>
                  ))}

                  {vacancies.map((v) => (
                    <div key={`v-${v.target.key}`} className={styles.attnRow}>
                      <div className={styles.attnMain}>
                        <div className={styles.attnLabel}>
                          {v.target.label}{" "}
                          <span className={`${styles.pill} ${styles.vacant}`}>Vacant {vacantFor(v.days)}</span>
                        </div>
                        <div className={styles.attnSub}>
                          Empty since {formatDay(v.since)}
                          {v.days > 0 ? ` · ${moneyRound(v.lost)} of rent gone so far` : " · rent stops today"}
                        </div>
                      </div>
                      <span className={`${styles.attnAmt} ${styles.neg} num`}>
                        {v.lost > 0 ? `\u2212${moneyRound(v.lost)}` : ""}
                      </span>
                      <div className={styles.attnActions}>
                        {(() => {
                          const listed = listingFor(v.target);
                          return listed ? (
                            <Link href={`/dashboard/listings#listing-${listed.id}`} className={`${styles.btn} ${styles.small} ${listed.waiting ? styles.primary : ""}`}>
                              {listed.waiting
                                ? `${listed.waiting} ${listed.waiting === 1 ? "application" : "applications"}`
                                : "Listed"}
                            </Link>
                          ) : (
                            viewOnly ? null : (
                              <Link
                                href={`/dashboard/properties/${v.target.propertyId}?list=${v.target.unitId ?? "whole"}`}
                                className={`${styles.btn} ${styles.small}`}
                              >
                                List it
                              </Link>
                            )
                          );
                        })()}
                        {!viewOnly && (
                          <Link
                            href={`/dashboard/properties/${v.target.propertyId}`}
                            className={`${styles.btn} ${styles.small} ${styles.quiet}`}
                          >
                            Add a tenant
                          </Link>
                        )}
                      </div>
                    </div>
                  ))}

                  {listingAlerts.map((l) => (
                    <div key={`ls-${l.id}`} className={styles.attnRow}>
                      <div className={styles.attnMain}>
                        <div className={styles.attnLabel}>
                          {targetLabel({ propertyId: l.propertyId, unitId: l.unitId })}{" "}
                          <span className={`${styles.pill} ${styles.owed}`}>
                            {l.waiting} {l.waiting === 1 ? "application" : "applications"}
                          </span>
                        </div>
                        <div className={styles.attnSub}>{l.headline} · {money(l.rent)} a month</div>
                      </div>
                      <div className={styles.attnActions}>
                        <Link href={`/dashboard/listings#listing-${l.id}`} className={`${styles.btn} ${styles.small} ${styles.primary}`}>
                          Review
                        </Link>
                      </div>
                    </div>
                  ))}

                  {depositAlerts.map((d) => (
                    <div key={`d-${d.id}`} className={styles.attnRow}>
                      <div className={styles.attnMain}>
                        <div className={styles.attnLabel}>
                          {d.tenantName}&apos;s deposit{" "}
                          <span className={`${styles.pill} ${d.state.kind === "overdue" ? styles.bill : styles.owed}`}>
                            {returnLabel(d.state)}
                          </span>
                        </div>
                        <div className={styles.attnSub}>
                          {propName_(d.propertyId)} · moved out {formatDay(d.movedOutOn)}
                          {d.returnBy ? ` · return by ${formatDay(d.returnBy)}` : ""}
                          {d.refund === 0 ? " · all kept, the itemized list still goes out" : ""}
                        </div>
                      </div>
                      <span className={`${styles.attnAmt} num`}>{money(d.refund)}</span>
                      <div className={styles.attnActions}>
                        <Link href={`/dashboard/move-outs/${d.id}`} className={`${styles.btn} ${styles.small}`}>
                          Statement
                        </Link>
                        {!viewOnly && (
                          <button
                            type="button"
                            className={`${styles.btn} ${styles.small}`}
                            onClick={() => setReturningId(d.id)}
                          >
                            Mark sent
                          </button>
                        )}
                      </div>
                    </div>
                  ))}

                  {dueLoans.map(({ loan, missed, interest, principal, escrow, total }) => (
                    <div key={`l-${loan.id}`} className={styles.attnRow}>
                      <div className={styles.attnMain}>
                        <div className={styles.attnLabel}>
                          {targetLabel({ propertyId: loan.propertyId, unitId: null })}{" "}
                          <span className={`${styles.pill} ${styles.bill}`}>Mortgage</span>
                        </div>
                        <div className={styles.attnSub}>
                          {loan.lender}: {money(interest)} interest
                          {escrow > 0 ? ` · ${money(escrow)} escrow` : ""} · {money(principal)} principal
                          {missed.length > 0 && (
                            <span className={styles.loanMissed}>
                              {" "}
                              · {missed.length === 1 ? monthName(missed[0], false) : `${missed.length} earlier months`} not
                              recorded yet
                            </span>
                          )}
                        </div>
                      </div>
                      <span className={`${styles.attnAmt} ${styles.neg} num`}>{money(total)}</span>
                      {!viewOnly && (
                        <div className={styles.attnActions}>
                          <Link href={`/dashboard/properties/${loan.propertyId}`} className={`${styles.btn} ${styles.small}`}>
                            Split differently
                          </Link>
                          <button
                            type="button"
                            className={`${styles.btn} ${styles.small}`}
                            onClick={() => setPayingLoanId(loan.id)}
                          >
                            Log it
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

          {selectedCompany === "all" && companies.length > 1 && (
            <section className={styles.block}>
              <div className={styles.blockHead}>
                <h2>By LLC</h2>
              </div>
              <div className={styles.ledgerWrap}>
                <table className={styles.ledger}>
                  <thead>
                    <tr>
                      <th>LLC</th>
                      <th>Properties</th>
                      <th style={{ textAlign: "right" }}>Collected</th>
                      <th style={{ textAlign: "right" }}>Expenses</th>
                      <th style={{ textAlign: "right" }}>Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perCompany.map((row) => (
                      <tr key={row.company.id}>
                        <td>
                          <button
                            type="button"
                            className={styles.linkCell}
                            onClick={() => setSelectedCompany(row.company.id)}
                          >
                            {row.company.name}
                          </button>
                        </td>
                        <td>{row.count}</td>
                        <td className={`${styles.amt} num ${styles.pos}`}>{money(row.rent)}</td>
                        <td className={`${styles.amt} num ${styles.neg}`}>{money(row.expense)}</td>
                        <td className={`${styles.amt} num ${row.net >= 0 ? styles.pos : styles.neg}`}>
                          {row.net >= 0 ? "" : "−"}
                          {money(Math.abs(row.net))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className={styles.block}>
            <div className={styles.blockHead}>
              <h2>Properties</h2>
              <span className={styles.count}>
                {visibleProperties.length
                  ? `${visibleProperties.length} ${visibleProperties.length === 1 ? "property" : "properties"}`
                  : ""}
              </span>
            </div>
            <div className={styles.properties}>
              {visibleProperties.map((p) => {
                const t = totalsByProperty.get(p.id) ?? { rent: 0, expense: 0, net: 0 };
                const propUnits = unitsForProperty(p.id);
                const target = expectedRent({ propertyId: p.id, unitId: null, monthlyRent: p.monthlyRent }, barMonth);
                const paidThisMonth = rentInBarMonth(p.id);
                const pct = target > 0 ? Math.min(100, Math.round((paidThisMonth / target) * 100)) : 0;
                // The month's late fees count toward what's owed, so rent paid
                // with a fee still open is short, not paid.
                const houseFees = propUnits.length === 0 ? cardFees(p.id, null, target, paidThisMonth) : null;
                const paidInFull = Boolean(houseFees?.paidUp);
                const owner = companies.find((c) => c.id === p.companyId);
                // Members can record and correct; only an owner can remove a
                // house and the ledger under it, so don't offer them a button
                // that will come back refused.
                const canRemove = owner?.role === "owner";
                const houseTenant = propUnits.length === 0 ? tenantFor(p.id, null) : null;

                // One glanceable state per card: vacant, all paid, or how many
                // units are still short this month.
                const unitRent = (u: Unit) =>
                  expectedRent({ propertyId: p.id, unitId: u.id, monthlyRent: u.monthlyRent }, barMonth);
                const rentedUnits = propUnits.filter((u) => !u.vacant && unitRent(u) > 0);
                const unitsPaid = rentedUnits.filter(
                  (u) => cardFees(p.id, u.id, unitRent(u), rentInMonth(p.id, u.id, barMonth)).paidUp
                ).length;
                let status: { text: string; tone: string } | null = null;
                if (propUnits.length === 0) {
                  if (p.vacant)
                    status = {
                      text: p.vacantSince ? `Vacant ${vacantFor(vacantDays(p.vacantSince, todayKey))}` : "Vacant",
                      tone: styles.vacant,
                    };
                  else if (paidInFull) status = { text: "Paid", tone: styles.paid };
                  else if (target > 0 && houseFees)
                    status = { text: `${money(houseFees.short)} short`, tone: styles.owed };
                } else if (rentedUnits.length > 0) {
                  status =
                    unitsPaid === rentedUnits.length
                      ? { text: "All paid", tone: styles.paid }
                      : { text: `${unitsPaid}/${rentedUnits.length} paid`, tone: styles.owed };
                }

                if (editingPropertyId === p.id) {
                  return (
                    <form
                      key={p.id}
                      className={`${styles.propCard} ${styles.propForm}`}
                      onSubmit={saveEditProperty}
                    >
                      <div className={styles.field}>
                        <label htmlFor={`edit-prop-name-${p.id}`}>Property name</label>
                        <input
                          id={`edit-prop-name-${p.id}`}
                          type="text"
                          autoFocus
                          required
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                        />
                      </div>
                      <div className={styles.field}>
                        <label htmlFor={`edit-prop-address-${p.id}`}>Address</label>
                        <input
                          id={`edit-prop-address-${p.id}`}
                          type="text"
                          value={editAddress}
                          onChange={(e) => setEditAddress(e.target.value)}
                        />
                      </div>
                      <div className={styles.field}>
                        <label htmlFor={`edit-prop-rent-${p.id}`}>Monthly rent ($)</label>
                        <input
                          id={`edit-prop-rent-${p.id}`}
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          value={editRent}
                          onChange={(e) => setEditRent(e.target.value)}
                        />
                      </div>
                      <label className={styles.checkboxField}>
                        <input
                          type="checkbox"
                          checked={editVacant}
                          onChange={(e) => setEditVacant(e.target.checked)}
                        />
                        Vacant
                      </label>
                      <div className={styles.propActions}>
                        <button
                          type="submit"
                          className={`${styles.btn} ${styles.small} ${styles.primary}`}
                          disabled={editSaving}
                        >
                          {editSaving ? "Saving…" : "Save"}
                        </button>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.small}`}
                          onClick={cancelEditProperty}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  );
                }

                return (
                  <div key={p.id} className={styles.propCard}>
                    <div className={styles.propHead}>
                      <div style={{ minWidth: 0 }}>
                        <div className={styles.name}>{p.name}</div>
                        {p.address && <div className={styles.addr}>{p.address}</div>}
                        {propUnits.length === 0 && houseTenant && (
                          <div className={styles.tenantLine}>{houseTenant.name}</div>
                        )}
                        {selectedCompany === "all" && owner && (
                          <div className={styles.ownerTag}>{owner.name}</div>
                        )}
                      </div>
                      {status && <span className={`${styles.pill} ${status.tone}`}>{status.text}</span>}
                    </div>

                    {propUnits.length > 0 ? (
                      <div className={styles.unitList}>
                        {propUnits.map((u) => {
                          const uPaid = rentInMonth(p.id, u.id, barMonth);
                          const uTarget = unitRent(u);
                          const uFees = cardFees(p.id, u.id, uTarget, uPaid);
                          const uFull = uFees.paidUp;
                          const uTenant = tenantFor(p.id, u.id);
                          return (
                            <div key={u.id} className={styles.unitRow}>
                              <span className={styles.unitName}>
                                {u.name}
                                {uTenant && <span className={styles.unitTenant}>{uTenant.name}</span>}
                              </span>
                              {u.vacant ? (
                                <span className={styles.vacantTag}>
                                  {u.vacantSince ? `Vacant ${vacantFor(vacantDays(u.vacantSince, todayKey))}` : "Vacant"}
                                </span>
                              ) : uTarget > 0 ? (
                                <span className={`num ${uFull ? styles.pos : styles.unitDue}`}>
                                  {uFull
                                    ? "Paid in full"
                                    : uFees.fees > 0
                                      ? `${money(uFees.short)} short`
                                      : `${money(uPaid)} of ${money(uTarget)}`}
                                </span>
                              ) : (
                                <span className={styles.note}>No rent set</span>
                              )}
                              {!u.vacant && uTarget > 0 && uFees.line && (
                                <span className={styles.feeLine}>{uFees.line}</span>
                              )}
                              {!u.vacant && uTarget > 0 && uFees.note && (
                                <span className={styles.feeNote}>{uFees.note}</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <>
                        <div className={styles.rentLine}>
                          <span>Monthly rent</span>
                          <span className="num">{money(target)}</span>
                        </div>
                        {!p.vacant && target > 0 && (
                          <div>
                            <div className={styles.bar}>
                              <span
                                className={paidInFull ? styles.barFull : undefined}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <div className={styles.barCaption}>
                              <span>{monthName(barMonth, false)} rent</span>
                              <span className={`num ${paidInFull ? styles.pos : ""}`}>
                                {paidInFull
                                  ? "Paid in full"
                                  : `${money(paidThisMonth)} of ${money(target)}`}
                              </span>
                            </div>
                            {houseFees?.line && <div className={styles.feeLine}>{houseFees.line}</div>}
                            {houseFees?.note && <div className={styles.feeNote}>{houseFees.note}</div>}
                          </div>
                        )}
                      </>
                    )}

                    <div className={styles.propFigures}>
                      <div className={styles.figure}>
                        <span className={styles.figureLabel}>In</span>
                        <span className={`${styles.figureValue} ${styles.pos} num`}>{money(t.rent)}</span>
                      </div>
                      <div className={styles.figure}>
                        <span className={styles.figureLabel}>Out</span>
                        <span className={`${styles.figureValue} ${styles.neg} num`}>{money(t.expense)}</span>
                      </div>
                      <div className={styles.figure}>
                        <span className={styles.figureLabel}>Net</span>
                        <span
                          className={`${styles.figureValue} ${t.net >= 0 ? styles.pos : styles.neg} num`}
                        >
                          {t.net >= 0 ? "" : "−"}
                          {money(Math.abs(t.net))}
                        </span>
                      </div>
                    </div>

                    <div className={styles.propActions}>
                      <Link
                        href={`/dashboard/properties/${p.id}`}
                        className={`${styles.btn} ${styles.small} ${styles.quiet}`}
                      >
                        Open
                      </Link>
                      {!viewOnly && (
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.small} ${styles.quiet}`}
                          onClick={() => startEditProperty(p)}
                        >
                          Edit
                        </button>
                      )}
                      {canRemove && !viewOnly && (
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.small} ${styles.quiet} ${styles.danger}`}
                          onClick={() => removeProperty(p)}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              {viewOnly ? null : addingProperty ? (
                <form className={`${styles.propCard} ${styles.propForm}`} onSubmit={addProperty}>
                  <div className={styles.field}>
                    <label htmlFor="new-prop-name">Property name</label>
                    <input
                      id="new-prop-name"
                      type="text"
                      autoFocus
                      required
                      placeholder="e.g. Birchwood Ave"
                      value={propName}
                      onChange={(e) => setPropName(e.target.value)}
                    />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="new-prop-address">Address</label>
                    <input
                      id="new-prop-address"
                      type="text"
                      placeholder="142 Birchwood Ave"
                      value={propAddress}
                      onChange={(e) => setPropAddress(e.target.value)}
                    />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="new-prop-rent">Monthly rent ($)</label>
                    <input
                      id="new-prop-rent"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={propRent}
                      onChange={(e) => setPropRent(e.target.value)}
                    />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="new-prop-company">Owned by</label>
                    <select
                      id="new-prop-company"
                      required
                      value={propCompany}
                      onChange={(e) => setPropCompany(e.target.value)}
                    >
                      {companies.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.propActions}>
                    <button type="submit" className={`${styles.btn} ${styles.small} ${styles.primary}`}>
                      Add property
                    </button>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.small}`}
                      onClick={() => setAddingProperty(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <button type="button" className={styles.addCard} onClick={openPropertyForm}>
                  + Add a property
                </button>
              )}
            </div>
          </section>

          <section className={styles.block}>
            <div className={styles.blockHead}>
              <h2>Ledger · {search ? "search" : periodShort}</h2>
              <div className={styles.ledgerControls}>
                <div className={styles.searchField}>
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search every entry…"
                    aria-label="Search the ledger"
                  />
                  {search && (
                    <button
                      type="button"
                      className={styles.searchClear}
                      onClick={() => setQuery("")}
                      aria-label="Clear search"
                    >
                      ×
                    </button>
                  )}
                </div>
                <select
                  value={filterProperty}
                  onChange={(e) => setFilterProperty(e.target.value)}
                  aria-label="Filter by property"
                >
                  <option value="">All properties</option>
                  {visibleProperties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  aria-label="Filter by type"
                >
                  <option value="">All types</option>
                  <option value="rent">Rent only</option>
                  <option value="expense">Expenses only</option>
                </select>
                {/* Below 640px the rows become cards and the header row is
                    hidden, so this is the only way to sort on a phone. */}
                <select
                  className={styles.sortPicker}
                  value={`${sortKey}:${sortDir}`}
                  onChange={(e) => {
                    const [key, dir] = e.target.value.split(":") as [SortKey, SortDir];
                    setSortKey(key);
                    setSortDir(dir);
                  }}
                  aria-label="Sort the ledger"
                >
                  {SORT_CHOICES.map((c) => (
                    <option key={`${c.key}:${c.dir}`} value={`${c.key}:${c.dir}`}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {search && rows.length > 0 && (
              <div className={styles.searchSummary}>
                <span>
                  <strong>{rows.length}</strong> {rows.length === 1 ? "entry" : "entries"} matching
                  &ldquo;{query.trim()}&rdquo; across all time
                </span>
                <span className="num">
                  {searchTotals.rent > 0 && <>+{money(searchTotals.rent)} in</>}
                  {searchTotals.rent > 0 && searchTotals.expense > 0 && " · "}
                  {searchTotals.expense > 0 && <>−{money(searchTotals.expense)} out</>}
                </span>
              </div>
            )}
            {rows.length === 0 ? (
              <div className={styles.ledgerWrap}>
                <div className={styles.emptyState}>
                  {search
                    ? `Nothing matches “${query.trim()}”. Search covers the property, description, note, category, date and amount.`
                    : allTime
                      ? (
                        <>
                          {viewOnly ? (
                            "No transactions yet."
                          ) : (
                            <>
                              No transactions yet — record a rent payment or expense to get started, or{" "}
                              <Link href="/dashboard/import">import a statement from your bank</Link>.
                            </>
                          )}
                        </>
                      )
                      : `Nothing recorded in ${periodLabel} yet.`}
                </div>
              </div>
            ) : (
              <div className={styles.ledgerWrap}>
                <table className={`${styles.ledger} ${styles.txnTable}`}>
                  <thead>
                    <tr>
                      {sortHead("date")}
                      {sortHead("property")}
                      {sortHead("type")}
                      {sortHead("details")}
                      {sortHead("amount", true)}
                      {!viewOnly && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((t) => (
                      <tr key={t.id}>
                        <td>{fmtDate(t.date)}</td>
                        <td>{targetLabel(t)}</td>
                        <td>
                          <span className={`${styles.tag} ${t.type === "rent" ? styles.rent : styles.expense}`}>
                            {t.type === "rent" ? "Rent" : "Expense"}
                          </span>
                        </td>
                        <td>
                          {t.category && <div className={styles.categoryTag}>{t.category}</div>}
                          {t.detail}
                          {t.note && <div className={styles.note}>{t.note}</div>}
                          {t.attachments.length > 0 && (
                            <div className={styles.proofRow}>
                              {t.attachments.map((a) => (
                                <span key={a.id} className={styles.proofItem}>
                                  <ThumbWithActions url={a.url} name={a.filename} mime={a.contentType}>
                                    <FileLink url={a.url} name={a.filename} mime={a.contentType} title={a.filename}>
                                      {a.contentType.startsWith("image/") ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={a.url} alt={a.filename} className={styles.proofThumb} />
                                      ) : (
                                        <span className={styles.proofFile}>PDF</span>
                                      )}
                                    </FileLink>
                                  </ThumbWithActions>
                                  {!viewOnly && (
                                    <button
                                      type="button"
                                      className={styles.proofRemove}
                                      aria-label={`Remove ${a.filename}`}
                                      onClick={() => removeAttachment(a.id)}
                                    >
                                      ×
                                    </button>
                                  )}
                                </span>
                              ))}
                            </div>
                          )}
                          {storageReady && !viewOnly && (
                            <label className={styles.proofAdd}>
                              {uploadingFor === t.id
                                ? "Uploading…"
                                : t.attachments.length > 0
                                  ? "+ Add another"
                                  : "+ Attach proof"}
                              {/* iOS: a display:none (hidden) file input inside a label is not a
                                  reliable picker target, esp. in the home-screen app — keep it in
                                  the layout, clipped. accept names HEIC/PDF explicitly. */}
                              <input
                                type="file"
                                multiple
                                accept={PROOF_ACCEPT}
                                className={proofStyles.srOnly}
                                disabled={uploadingFor === t.id}
                                onChange={(e) => {
                                  addProofToRow(t.id, e.target.files);
                                  e.target.value = "";
                                }}
                              />
                            </label>
                          )}
                          {proofError?.scope === t.id && (
                            <div className={styles.proofWarn}>{proofError.message}</div>
                          )}
                        </td>
                        <td className={`${styles.amt} num ${t.type === "rent" ? styles.pos : styles.neg}`}>
                          {t.type === "rent" ? "+" : "−"}
                          {money(t.amount)}
                        </td>
                        {!viewOnly && (
                          <td>
                            <div className={styles.rowActions}>
                              <button
                                type="button"
                                className={`${styles.btn} ${styles.small} ${styles.quiet} ${styles.rowDel}`}
                                onClick={() => openEdit(t)}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className={`${styles.btn} ${styles.small} ${styles.quiet} ${styles.danger} ${styles.rowDel}`}
                                onClick={() => removeTransaction(t)}
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {hiddenRows > 0 && (
              <div className={styles.moreRow}>
                <button
                  type="button"
                  className={styles.btn}
                  onClick={() => setLedgerLimit((n) => n + LEDGER_PAGE)}
                >
                  Show {Math.min(hiddenRows, LEDGER_PAGE)} more
                </button>
                <span className={styles.count}>
                  {visibleRows.length} of {rows.length} entries
                </span>
              </div>
            )}
          </section>

          {!viewOnly && (
            <>
              <div className={styles.fabSpace} aria-hidden="true" />
              <button type="button" className={styles.fab} onClick={() => openRecord()} aria-label="Record a transaction">
                <span aria-hidden="true">+</span> Record
              </button>
            </>
          )}
        </>
      )}

      {draft && (
        <RecordEntrySheet
          key={draftSeq}
          open={recording}
          draft={draft}
          targets={visibleTargets}
          storageReady={storageReady}
          onClose={() => setRecording(false)}
          onSaved={entrySaved}
          onProof={proofLanded}
        />
      )}

      {(() => {
        const loan = loans.find((l) => l.id === payingLoanId);
        return loan ? (
          <LoanPaymentDialog
            loan={loan}
            month={barMonth}
            today={todayKey}
            focusAmount
            onClose={() => setPayingLoanId("")}
            onRecorded={(payment, entries) => loanRecorded(loan.id, payment, entries)}
          />
        ) : null;
      })()}

      <MarkReturnedDialog
        moveOut={deposits.find((d) => d.id === returningId) ?? null}
        tenantName={deposits.find((d) => d.id === returningId)?.tenantName ?? ""}
        today={todayKey}
        onClose={() => setReturningId("")}
        onDone={(m) => {
          setDeposits((prev) => prev.map((d) => (d.id === m.id ? { ...d, ...m } : d)));
          setReturningId("");
          push("Deposit marked returned.");
        }}
      />

      <ConfirmDialog request={confirming} onCancel={() => setConfirming(null)} />
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </AppShell>
  );
}
