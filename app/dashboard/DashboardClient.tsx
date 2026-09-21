"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { shrinkImage } from "@/lib/shrinkImage";
import { EXPENSE_CATEGORIES } from "@/lib/categories";
import { money } from "@/lib/money";
import { rentForMonth, type RentChangeDTO } from "@/lib/rent";
import type { TenantDTO } from "@/lib/tenants";
import { dateFromISO, daysLate, formatDay, isoDay, leaseStatus, smsHref, telHref } from "@/lib/lease";
import AppShell from "../components/AppShell";
import CashFlowChart from "../components/CashFlowChart";
import CategoryBars from "../components/CategoryBars";
import Sparkline from "../components/Sparkline";
import Modal from "../components/Modal";
import ConfirmDialog, { type ConfirmRequest } from "../components/ConfirmDialog";
import { Toasts, useToasts } from "../components/Toasts";
import styles from "./dashboard.module.css";

type Company = { id: string; name: string; role: "owner" | "member" };

type Property = {
  id: string;
  companyId: string;
  name: string;
  address: string;
  monthlyRent: number;
  vacant: boolean;
};

type Unit = {
  id: string;
  propertyId: string;
  name: string;
  monthlyRent: number;
  vacant: boolean;
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
};

const fmtDate = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
type PeriodKind = "month" | "year" | "all";

const STORAGE_HINT =
  "Proof uploads need file storage. In Vercel, open this project's Storage tab, add Blob, then redeploy.";

function monthName(key: string, withYear = true) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

function shortMonth(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short" });
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
  userLabel,
  storageReady,
  serverToday,
  initialCompanies,
  initialProperties,
  initialUnits,
  initialRecurring,
  initialRentChanges,
  initialTenants,
  initialTransactions,
}: {
  userLabel: string;
  storageReady: boolean;
  serverToday: string;
  initialCompanies: Company[];
  initialProperties: Property[];
  initialUnits: Unit[];
  initialRecurring: RecurringExpense[];
  initialRentChanges: RentChangeDTO[];
  initialTenants: TenantDTO[];
  initialTransactions: Transaction[];
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
  const thisMonth = todayKey.slice(0, 7);
  const thisYear = todayKey.slice(0, 4);

  const [companies, setCompanies] = useState<Company[]>(initialCompanies);
  const [properties, setProperties] = useState<Property[]>(initialProperties);
  const [units, setUnits] = useState<Unit[]>(initialUnits);
  const [recurring, setRecurring] = useState<RecurringExpense[]>(initialRecurring);
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

  const [recording, setRecording] = useState(false);
  const [editingTxnId, setEditingTxnId] = useState("");
  const [markingKey, setMarkingKey] = useState("");
  const [bulkBusy, setBulkBusy] = useState<"" | "rent" | "bills">("");
  const [type, setType] = useState<"rent" | "expense">("rent");
  const [targetKey, setTargetKey] = useState("");
  const [date, setDate] = useState(serverToday);
  const [amount, setAmount] = useState("");
  const [detail, setDetail] = useState("");
  const [note, setNote] = useState("");
  const [category, setCategory] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [recurringBusyId, setRecurringBusyId] = useState("");

  const [periodKind, setPeriodKind] = useState<PeriodKind>("month");
  const [selectedMonth, setSelectedMonth] = useState(serverToday.slice(0, 7));
  const [selectedYear, setSelectedYear] = useState(serverToday.slice(0, 4));
  const [filterProperty, setFilterProperty] = useState("");
  const [filterType, setFilterType] = useState("");
  const [query, setQuery] = useState("");

  const [pendingProof, setPendingProof] = useState<File[]>([]);
  const proofInput = useRef<HTMLInputElement>(null);
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
          { key: p.id, propertyId: p.id, unitId: null, label: p.name, monthlyRent: p.monthlyRent, vacant: p.vacant },
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
        })),
        {
          key: `${p.id}:whole`,
          propertyId: p.id,
          unitId: null,
          label: `${p.name} — (whole building)`,
          monthlyRent: 0,
          vacant: false,
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
    return transactions
      .filter(
        (t) => t.propertyId === propertyId && t.unitId === unitId && t.type === "rent" && t.date.startsWith(month)
      )
      .reduce((sum, t) => sum + t.amount, 0);
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
          tenant,
          // Only a month that has actually started can be late, so a future
          // month shows as owed rather than overdue.
          late: tenant ? Math.max(0, daysLate(barMonth, tenant.dueDay, now)) : 0,
        };
      })
      .filter(({ expected, paid }) => paid < expected)
      // Longest overdue first, then by how much is outstanding.
      .sort((a, b) => b.late - a.late || b.expected - b.paid - (a.expected - a.paid));
  }, [visibleTargets, transactions, barMonth, tenants, now, rentChanges]);

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
          !transactions.some((t) => t.recurringExpenseId === r.id && t.date.startsWith(barMonth))
      );
  }, [recurring, transactions, barMonth, visibleIds]);

  /** The current tenant of a target, if one is on file. */
  function tenantFor(propertyId: string, unitId: string | null) {
    return (
      tenants.find((t) => t.active && t.propertyId === propertyId && (t.unitId ?? null) === unitId) ??
      null
    );
  }

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

  // A search looks across every month. Hunting for "that plumber invoice" and
  // being told there's nothing in September — when it was in March — is the
  // opposite of useful, so the period only applies when you aren't searching.
  const rows = useMemo(() => {
    const base = search ? visibleTransactions : scopedTransactions;
    return base
      .filter((t) => !filterProperty || t.propertyId === filterProperty)
      .filter((t) => !filterType || t.type === filterType)
      .filter((t) => {
        if (!search) return true;
        const haystack = [
          targetLabel(t),
          t.detail,
          t.note,
          t.category,
          t.amount.toFixed(2),
          fmtDate(t.date),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(search);
      })
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [scopedTransactions, visibleTransactions, filterProperty, filterType, search]);

  const searchTotals = useMemo(() => totalsFor(null, rows), [rows]);

  // A few years in, "All time" is thousands of rows and the browser renders
  // every one of them before the page settles. Show a page at a time; the
  // period switcher and the search box are the real ways to narrow things.
  const LEDGER_PAGE = 60;
  const [ledgerLimit, setLedgerLimit] = useState(LEDGER_PAGE);
  useEffect(() => {
    setLedgerLimit(LEDGER_PAGE);
  }, [search, filterProperty, filterType, scopeKey, selectedCompany]);

  const visibleRows = rows.slice(0, ledgerLimit);
  const hiddenRows = rows.length - visibleRows.length;

  const activeCompany = companies.find((c) => c.id === selectedCompany) ?? null;

  const isRent = type === "rent";
  const formTarget =
    visibleTargets.find((t) => t.key === targetKey) ?? visibleTargets[0] ?? null;

  /** Opens the record sheet, optionally pre-filled from a row that needs action. */
  function openRecord(prefill?: { type: "rent" | "expense"; targetKey: string; amount?: number }) {
    setProofError(null);
    setError("");
    setEditingTxnId("");
    setDate(defaultDateFor(barMonth, todayKey));
    if (prefill) {
      setType(prefill.type);
      setTargetKey(prefill.targetKey);
      setAmount(prefill.amount ? String(prefill.amount) : "");
      if (prefill.type === "rent") setCategory("");
    }
    setRecording(true);
  }

  /**
   * Logs the whole outstanding rent for a target in one tap. This is the
   * action of the month — every tenant, every month — and routing it through
   * the form meant opening a sheet to confirm numbers the app already knows.
   * A mistake is fixable from the ledger, where the entry can be edited or
   * deleted.
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

  async function markPaid(target: Target, owed: number, tenantName?: string) {
    setMarkingKey(target.key);
    const result = await postRent(target, owed, tenantName);
    setMarkingKey("");
    if (!result.ok) {
      push(result.error || "Couldn't record that payment.", "bad");
      return;
    }
    push(`${money(owed)} recorded for ${tenantName ?? target.label}.`);
  }

  /**
   * The same thing for every tenant who owes, because on the 3rd of the month
   * most of them have paid and clearing them one row at a time is the bulk of
   * the work. Confirmed first — it writes real money into the books — and it
   * posts one entry per tenant, so any single one can still be edited or
   * removed afterwards.
   */
  function markAllPaid() {
    const rows = unpaidThisMonth;
    if (rows.length === 0) return;
    const total = rows.reduce((sum, r) => sum + (r.expected - r.paid), 0);
    setConfirming({
      title: `Record ${money(total)} of rent?`,
      body: `One entry per tenant, dated in ${monthName(barMonth)}, for the full amount each still owes: ${rows
        .map((r) => `${r.tenant?.name ?? r.target.label} ${money(r.expected - r.paid)}`)
        .join(", ")}.`,
      confirmLabel: `Record ${rows.length} payments`,
      onConfirm: async () => {
        setBulkBusy("rent");
        let done = 0;
        let failed = 0;
        for (const r of rows) {
          const result = await postRent(r.target, r.expected - r.paid, r.tenant?.name);
          if (result.ok) done += 1;
          else failed += 1;
        }
        setBulkBusy("");
        if (failed > 0) push(`Recorded ${done}; ${failed} didn't save. Check the ledger.`, "bad");
        else push(`${money(total)} recorded across ${done} ${done === 1 ? "tenant" : "tenants"}.`);
      },
    });
  }

  /** Opens the same sheet over an existing entry, to correct it in place. */
  function openEdit(t: Transaction) {
    setProofError(null);
    setError("");
    setPendingProof([]);
    if (proofInput.current) proofInput.current.value = "";
    setEditingTxnId(t.id);
    setType(t.type);
    // Match the select: a unit-level entry points at its unit, a
    // property-level one at the property (or its "whole building" option).
    const propUnits = unitsForProperty(t.propertyId);
    setTargetKey(
      t.unitId
        ? `${t.propertyId}:${t.unitId}`
        : propUnits.length > 0
          ? `${t.propertyId}:whole`
          : t.propertyId
    );
    setDate(t.date);
    setAmount(String(t.amount));
    setDetail(t.detail);
    setNote(t.note);
    setCategory(t.category);
    setRecording(true);
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
    if (!targetKey) setTargetKey(data.id);
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
          push("Couldn't delete that entry.", "bad");
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

  async function logRecurring(templateId: string) {
    setRecurringBusyId(templateId);
    setError("");
    const res = await fetch(`/api/recurring/${templateId}/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month: barMonth }),
    });
    const data = await res.json().catch(() => ({}));
    setRecurringBusyId("");
    if (!res.ok) {
      setError(data?.error || "Couldn't log that expense.");
      return;
    }
    setTransactions((prev) => [...prev, { ...data, attachments: [] }]);
    push("Logged to the ledger.");
  }

  /** Every recurring bill due this period, logged in one go. */
  function logAllRecurring() {
    const rows = dueRecurring;
    if (rows.length === 0) return;
    const total = rows.reduce((sum, r) => sum + r.amount, 0);
    setConfirming({
      title: `Log ${money(total)} of bills?`,
      body: `Adds ${rows.length} ${rows.length === 1 ? "entry" : "entries"} for ${monthName(
        barMonth
      )}: ${rows.map((r) => `${r.category} ${money(r.amount)}`).join(", ")}.`,
      confirmLabel: `Log ${rows.length} bills`,
      onConfirm: async () => {
        setBulkBusy("bills");
        let failed = 0;
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
        if (failed > 0) push(`${failed} of ${rows.length} bills didn't log.`, "bad");
        else push(`${money(total)} of bills logged for ${monthName(barMonth, false)}.`);
      },
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(amount);
    // Must match what the select shows: a stale selection from another LLC
    // (or from a property that has since grown units) would otherwise book
    // the money against the wrong house.
    if (!formTarget || !date || !(amt > 0)) return;
    if (type === "expense" && !category) return;
    setError("");

    setSubmitting(true);
    const editing = Boolean(editingTxnId);
    const res = await fetch(editing ? `/api/transactions/${editingTxnId}` : "/api/transactions", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propertyId: formTarget.propertyId,
        unitId: formTarget.unitId,
        type,
        date,
        amount: amt,
        detail,
        note,
        category: type === "expense" ? category : undefined,
      }),
    });
    setSubmitting(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.error || "Couldn't save that transaction.");
      return;
    }

    // Editing keeps whatever proof is already attached — that's the whole
    // reason to correct an entry rather than delete and retype it.
    if (editing) {
      setTransactions((prev) =>
        prev.map((t) => (t.id === editingTxnId ? { ...t, ...data, attachments: t.attachments } : t))
      );
      setRecording(false);
      setEditingTxnId("");
      push(`Entry updated — ${money(amt)} for ${formTarget.label}.`);
      return;
    }

    const created: Transaction = { ...data, attachments: [] };
    setTransactions((prev) => [...prev, created]);
    setAmount("");
    setDetail("");
    setNote("");
    setCategory("");
    setDate(defaultDateFor(barMonth, todayKey));

    let uploadFailed = false;
    if (pendingProof.length > 0) {
      setProofError(null);
      setUploadingFor(created.id);
      for (const file of pendingProof) {
        if (!(await uploadProof(created.id, file, "form"))) {
          uploadFailed = true;
          break;
        }
      }
      setUploadingFor("");
      // Keep the selection on failure so it can be retried from the new row
      // rather than vanishing with no explanation.
      if (!uploadFailed) {
        setPendingProof([]);
        if (proofInput.current) proofInput.current.value = "";
      }
    }

    if (!uploadFailed) {
      setRecording(false);
      push(
        `${type === "rent" ? "Rent" : "Expense"} of ${money(amt)} recorded for ${formTarget.label}.`
      );
    }
  }

  const deltaFor = (current: number, prior: number | undefined, upIsGood: boolean) => {
    if (prior === undefined || previous === null) return null;
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

  const attentionCount = unpaidThisMonth.length + leaseAlerts.length + dueRecurring.length;

  return (
    <AppShell
      title="Overview"
      tagline="Rent collected, repairs paid, and the profit left over — by property."
      userLabel={userLabel}
      actions={
        companies.length > 0 ? (
          <button
            type="button"
            className={`${styles.btn} ${styles.accent} ${styles.desktopOnly}`}
            onClick={() => openRecord()}
          >
            + Record a transaction
          </button>
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
          {addingCompany ? (
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
                {deltaFor(overall.net, previous?.net, true) ?? (
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
              <CashFlowChart data={series} />
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
                  {unpaidThisMonth.length > 1 && (
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.small}`}
                      disabled={bulkBusy !== ""}
                      onClick={markAllPaid}
                    >
                      {bulkBusy === "rent" ? "Recording…" : `Mark all ${unpaidThisMonth.length} paid`}
                    </button>
                  )}
                  {dueRecurring.length > 1 && (
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.small}`}
                      disabled={bulkBusy !== ""}
                      onClick={logAllRecurring}
                    >
                      {bulkBusy === "bills" ? "Logging…" : `Log all ${dueRecurring.length} bills`}
                    </button>
                  )}
                </div>
              </div>

              {attentionCount === 0 ? (
                <div className={styles.allClear}>
                  <span className={styles.allClearMark} aria-hidden="true">
                    ✓
                  </span>
                  Every unit has paid, every recurring bill is logged, and no lease is running out.
                </div>
              ) : (
                <div className={styles.attnList}>
                  {unpaidThisMonth.map(({ target, expected, paid, tenant, late }) => (
                    <div key={`u-${target.key}`} className={styles.attnRow}>
                      <div className={styles.attnMain}>
                        <div className={styles.attnLabel}>
                          {tenant ? tenant.name : target.label}{" "}
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
                        </div>
                      </div>
                      <span className={`${styles.attnAmt} ${late > 0 ? styles.neg : styles.due} num`}>
                        {money(expected - paid)}
                      </span>
                      <div className={styles.attnActions}>
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
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.small} ${styles.quiet}`}
                          onClick={() =>
                            openRecord({
                              type: "rent",
                              targetKey: target.key,
                              amount: expected - paid,
                            })
                          }
                        >
                          Part paid
                        </button>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.small} ${styles.primary}`}
                          disabled={markingKey === target.key}
                          onClick={() => markPaid(target, expected - paid, tenant?.name)}
                        >
                          {markingKey === target.key ? "Saving…" : "Mark paid"}
                        </button>
                      </div>
                    </div>
                  ))}

                  {leaseAlerts.map(({ tenant, status }) => (
                    <div key={`l-${tenant.id}`} className={styles.attnRow}>
                      <div className={styles.attnMain}>
                        <div className={styles.attnLabel}>
                          {tenant.name}{" "}
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
                        <Link
                          href={`/dashboard/properties/${tenant.propertyId}`}
                          className={`${styles.btn} ${styles.small}`}
                        >
                          Open lease
                        </Link>
                      </div>
                    </div>
                  ))}

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
                      <div className={styles.attnActions}>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.small}`}
                          disabled={recurringBusyId === r.id}
                          onClick={() => logRecurring(r.id)}
                        >
                          {recurringBusyId === r.id ? "Logging…" : "Log it"}
                        </button>
                      </div>
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
                const ids = new Set([p.id]);
                const t = totalsFor(ids, inScopeTransactions);
                const propUnits = unitsForProperty(p.id);
                const target = expectedRent({ propertyId: p.id, unitId: null, monthlyRent: p.monthlyRent }, barMonth);
                const paidThisMonth = rentInBarMonth(p.id);
                const pct = target > 0 ? Math.min(100, Math.round((paidThisMonth / target) * 100)) : 0;
                const paidInFull = target > 0 && paidThisMonth >= target;
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
                  (u) => rentInMonth(p.id, u.id, barMonth) >= unitRent(u)
                ).length;
                let status: { text: string; tone: string } | null = null;
                if (propUnits.length === 0) {
                  if (p.vacant) status = { text: "Vacant", tone: styles.vacant };
                  else if (paidInFull) status = { text: "Paid", tone: styles.paid };
                  else if (target > 0) status = { text: `${money(target - paidThisMonth)} short`, tone: styles.owed };
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
                          const uFull = uTarget > 0 && uPaid >= uTarget;
                          const uTenant = tenantFor(p.id, u.id);
                          return (
                            <div key={u.id} className={styles.unitRow}>
                              <span className={styles.unitName}>
                                {u.name}
                                {uTenant && <span className={styles.unitTenant}>{uTenant.name}</span>}
                              </span>
                              {u.vacant ? (
                                <span className={styles.vacantTag}>Vacant</span>
                              ) : uTarget > 0 ? (
                                <span className={`num ${uFull ? styles.pos : styles.unitDue}`}>
                                  {uFull ? "Paid in full" : `${money(uPaid)} of ${money(uTarget)}`}
                                </span>
                              ) : (
                                <span className={styles.note}>No rent set</span>
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
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.small} ${styles.quiet}`}
                        onClick={() => startEditProperty(p)}
                      >
                        Edit
                      </button>
                      {canRemove && (
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

              {addingProperty ? (
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
                      ? "No transactions yet — record a rent payment or expense to get started."
                      : `Nothing recorded in ${periodLabel} yet.`}
                </div>
              </div>
            ) : (
              <div className={styles.ledgerWrap}>
                <table className={`${styles.ledger} ${styles.txnTable}`}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Property</th>
                      <th>Type</th>
                      <th>Details</th>
                      <th style={{ textAlign: "right" }}>Amount</th>
                      <th></th>
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
                                  <a href={a.url} target="_blank" rel="noopener noreferrer" title={a.filename}>
                                    {a.contentType.startsWith("image/") ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img src={a.url} alt={a.filename} className={styles.proofThumb} />
                                    ) : (
                                      <span className={styles.proofFile}>PDF</span>
                                    )}
                                  </a>
                                  <button
                                    type="button"
                                    className={styles.proofRemove}
                                    aria-label={`Remove ${a.filename}`}
                                    onClick={() => removeAttachment(a.id)}
                                  >
                                    ×
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}
                          {storageReady && (
                            <label className={styles.proofAdd}>
                              {uploadingFor === t.id
                                ? "Uploading…"
                                : t.attachments.length > 0
                                  ? "+ Add another"
                                  : "+ Attach proof"}
                              <input
                                type="file"
                                multiple
                                accept="image/*,application/pdf"
                                hidden
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

          <div className={styles.fabSpace} aria-hidden="true" />
          <button type="button" className={styles.fab} onClick={() => openRecord()} aria-label="Record a transaction">
            <span aria-hidden="true">+</span> Record
          </button>
        </>
      )}

      <Modal
        open={recording}
        title={editingTxnId ? "Edit this entry" : "Record a transaction"}
        subtitle={
          editingTxnId
            ? "Correct any of it. Proof already attached to this entry stays put."
            : "Rent that came in, or money that went out on a repair or bill."
        }
        onClose={() => setRecording(false)}
      >
        <div className={`${styles.formCard} ${styles.formBare}`}>
          <div className={styles.typeToggle}>
            <button
              type="button"
              className={type === "rent" ? `${styles.active} ${styles.rent}` : ""}
              onClick={() => setType("rent")}
            >
              Rent payment
            </button>
            <button
              type="button"
              className={type === "expense" ? `${styles.active} ${styles.expense}` : ""}
              onClick={() => setType("expense")}
            >
              Repair / expense
            </button>
          </div>
          <form onSubmit={onSubmit}>
            <div className={`${styles.fieldGrid} ${styles.modalGrid}`}>
              <div className={`${styles.field} ${styles.wide}`}>
                <label htmlFor="f-property">Property</label>
                <select
                  id="f-property"
                  required
                  value={formTarget?.key ?? ""}
                  onChange={(e) => setTargetKey(e.target.value)}
                >
                  {visibleTargets.length === 0 && <option value="">Add a property first</option>}
                  {visibleTargets.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label htmlFor="f-date">Date</label>
                <input id="f-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className={styles.field}>
                <label htmlFor="f-amount">Amount ($)</label>
                <input
                  id="f-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              {!isRent && (
                <div className={`${styles.field} ${styles.wide}`}>
                  <label htmlFor="f-category">Category</label>
                  <select id="f-category" required value={category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="">Choose one</option>
                    {EXPENSE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className={`${styles.field} ${styles.wide}`}>
                <label htmlFor="f-detail">{isRent ? "Paid by (tenant)" : "Description (optional)"}</label>
                <input
                  id="f-detail"
                  type="text"
                  placeholder={isRent ? "e.g. J. Alvarez" : "e.g. Fixed leaking kitchen faucet"}
                  value={detail}
                  onChange={(e) => setDetail(e.target.value)}
                />
              </div>
              <div className={`${styles.field} ${styles.span3}`}>
                <label htmlFor="f-note">Note (optional)</label>
                <input
                  id="f-note"
                  type="text"
                  placeholder={
                    isRent ? "e.g. September rent, paid via check" : "e.g. Paid to Smith Plumbing, invoice #123"
                  }
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
              {!editingTxnId && (
              <div className={`${styles.field} ${styles.span4}`}>
                <label htmlFor="f-proof">{isRent ? "Proof of payment (optional)" : "Receipt or photo (optional)"}</label>
                <input
                  id="f-proof"
                  ref={proofInput}
                  type="file"
                  multiple
                  accept="image/*,application/pdf"
                  className={styles.fileInput}
                  disabled={!storageReady}
                  onChange={(e) => setPendingProof(Array.from(e.target.files ?? []))}
                />
                {!storageReady && <span className={styles.proofWarn}>{STORAGE_HINT}</span>}
                {storageReady && pendingProof.length > 0 && (
                  <span className={styles.note}>
                    {pendingProof.length} file{pendingProof.length === 1 ? "" : "s"} will be attached
                  </span>
                )}
                {proofError?.scope === "form" && <span className={styles.proofWarn}>{proofError.message}</span>}
              </div>
              )}
            </div>
            {error && <div className={styles.errorBar}>{error}</div>}
            <div className={styles.formFoot}>
              <button type="button" className={styles.btn} onClick={() => setRecording(false)}>
                Cancel
              </button>
              <button
                type="submit"
                className={`${styles.btn} ${styles.accent}`}
                disabled={submitting || visibleTargets.length === 0}
              >
                {submitting
                  ? "Saving…"
                  : editingTxnId
                    ? "Save changes"
                    : isRent
                      ? "Add rent payment"
                      : "Add expense"}
              </button>
            </div>
          </form>
        </div>
      </Modal>

      <ConfirmDialog request={confirming} onCancel={() => setConfirming(null)} />
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </AppShell>
  );
}
