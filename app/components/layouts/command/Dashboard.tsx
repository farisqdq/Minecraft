"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "../../AppShell";
import { useViewOnly } from "../../ViewOnly";
import CashFlowChart from "../../CashFlowChart";
import CategoryBars from "../../CategoryBars";
import ConfirmDialog, { type ConfirmRequest } from "../../ConfirmDialog";
import LoanPaymentDialog from "../../LoanPaymentDialog";
import Modal from "../../Modal";
import RecordEntrySheet, { type EntryDraft, type SavedEntry } from "../../RecordEntrySheet";
import type { ProofDTO } from "../../ProofPicker";
import { FileLink } from "../../FileViewer";
import { Toasts, useToasts } from "../../Toasts";
import { useNow } from "../../useNow";
import { useLivePulse } from "../../useLivePulse";
import StatusBadge, { type Status } from "../../ui/StatusBadge";
import OverflowMenu, { type MenuItem } from "../../ui/OverflowMenu";
import { IconChevronLeft, IconChevronRight, IconPencil, IconPlus, IconSearch, IconTrash } from "../../icons";
import type { DashboardProps } from "../dashboard-props";
import { money } from "@/lib/money";
import { dateFromISO, formatDay, isoDay, leaseStatus, smsHref, telHref } from "@/lib/lease";
import { chasedRecently, remindedAgo } from "@/lib/notices";
import { byUrgency, expiryLabel, expiryState } from "@/lib/documents";
import { isDue as loanIsDue, suggestPayment } from "@/lib/loans";
import type { LoanDTO, LoanPaymentDTO } from "@/lib/loans-db";
import { returnLabel, returnState } from "@/lib/move-out";
import { vacantDays, vacantFor } from "@/lib/vacancy";
import { bulkSummary, owedLine, recurringPrefill, rentPrefill } from "@/lib/quick-record";
import { monthModel, monthRange, resolveCompany, shiftMonth, type RowStatus, type TargetRow } from "@/lib/layouts/command-month";
import { CommandPageProvider, setLlcSelection, useLlcSelection } from "./context";
import styles from "./dashboard.module.css";

type Transaction = DashboardProps["initialTransactions"][number];
type Recurring = DashboardProps["initialRecurring"][number];
type Company = DashboardProps["initialCompanies"][number];
type Property = DashboardProps["initialProperties"][number];
type Tenant = DashboardProps["initialTenants"][number];

const MONTH_YEAR = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
const MONTH_ONLY = new Intl.DateTimeFormat("en-US", { month: "long" });
const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function monthName(key: string, withYear = true) {
  const [y, m] = key.split("-").map(Number);
  return (withYear ? MONTH_YEAR : MONTH_ONLY).format(new Date(y, m - 1, 1));
}
const shortDay = (iso: string) => DAY.format(new Date(iso + "T00:00:00"));

const STATUS_BADGE: Record<RowStatus, { status: Status; label: string }> = {
  paid: { status: "paid", label: "Paid" },
  partial: { status: "partial", label: "Partial" },
  late: { status: "late", label: "Late" },
  due: { status: "neutral", label: "Due" },
  vacant: { status: "vacant", label: "Vacant" },
  ended: { status: "ended", label: "Lease ended" },
  norent: { status: "neutral", label: "No rent set" },
};

type Tone = "danger" | "warning" | "neutral" | "accent";
type Attention = {
  key: string;
  tone: Tone;
  text: ReactNode;
  action?: { label: string; href?: string; onClick?: () => void };
  menu?: MenuItem[];
};

type Tab = "transactions" | "cashflow" | "bills";
const LEDGER_PAGE = 60;
// Needs attention shows this many, most pressing first, then "Show all".
const ATTENTION_FIRST = 8;

/**
 * The Command Center overview: four KPI tiles, a dense properties table, and
 * a right rail with what needs doing and each LLC's collection. Every figure
 * comes from lib/layouts/command-month.ts, which follows the Classic
 * dashboard's rules exactly, and every action opens the same sheet or dialog
 * the Classic dashboard does. Below the table, tabs keep the rest of the
 * Classic overview: the ledger, the cash-flow charts and the recurring bills.
 */
export default function CommandDashboard(props: DashboardProps) {
  const {
    openRepairs,
    initialRepairs,
    expiringDocs,
    initialChases,
    lateFees = {},
    waivedLateFees = {},
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
    initialDeposits,
  } = props;

  // Same clock handling as Classic: the server's day first, then the local one.
  const [todayKey, setTodayKey] = useState(serverToday);
  useEffect(() => {
    const local = isoDay(new Date());
    if (local !== serverToday) setTodayKey(local);
  }, [serverToday]);
  const now = useMemo(() => dateFromISO(todayKey), [todayKey]);
  const clock = useNow(serverNow);
  const router = useRouter();
  const viewOnly = useViewOnly();
  useLivePulse("/api/requests/pulse", () => router.refresh());

  const thisMonth = todayKey.slice(0, 7);
  const [companies, setCompanies] = useState<Company[]>(initialCompanies);
  const [properties, setProperties] = useState<Property[]>(initialProperties);
  const units = initialUnits;
  const tenants = initialTenants;
  const rentChanges = initialRentChanges;
  const recurring = initialRecurring;
  const deposits = initialDeposits;
  const [loans, setLoans] = useState<LoanDTO[]>(initialLoans);
  const [transactions, setTransactions] = useState<Transaction[]>(initialTransactions);
  const [chases, setChases] = useState(initialChases);
  const [chasing, setChasing] = useState("");
  const [month, setMonth] = useState(serverToday.slice(0, 7));
  const [tab, setTab] = useState<Tab>("transactions");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"" | "rent" | "expense">("");
  const [ledgerLimit, setLedgerLimit] = useState(LEDGER_PAGE);
  const [allAttention, setAllAttention] = useState(false);
  const [bulkBusy, setBulkBusy] = useState<"" | "rent" | "bills">("");
  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null);
  const { toasts, push, dismiss } = useToasts();

  const stored = useLlcSelection();
  const llc = resolveCompany(stored, companies);
  const activeCompany = companies.find((c) => c.id === llc) ?? null;

  // The record sheet, opened exactly as Classic opens it.
  const [recording, setRecording] = useState(false);
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const [draftSeq, setDraftSeq] = useState(0);
  const [payingLoanId, setPayingLoanId] = useState("");

  const model = useMemo(
    () =>
      monthModel({
        companies,
        properties,
        units,
        tenants,
        transactions,
        rentChanges,
        lateFees,
        company: llc,
        month,
        today: todayKey,
      }),
    [companies, properties, units, tenants, transactions, rentChanges, lateFees, llc, month, todayKey]
  );

  const visibleIds = useMemo(
    () => new Set(properties.filter((p) => llc === "all" || p.companyId === llc).map((p) => p.id)),
    [properties, llc]
  );
  const visibleTransactions = useMemo(
    () => transactions.filter((t) => visibleIds.has(t.propertyId)),
    [transactions, visibleIds]
  );
  const months = useMemo(() => monthRange(transactions.map((t) => t.date), thisMonth), [transactions, thisMonth]);
  const monthIndex = months.indexOf(month);

  const propName = (id: string) => properties.find((p) => p.id === id)?.name ?? "—";
  const unitsFor = (id: string) => units.filter((u) => u.propertyId === id);
  function targetLabel(t: { propertyId: string; unitId: string | null }) {
    const property = propName(t.propertyId);
    if (!t.unitId) return property;
    const unit = units.find((u) => u.id === t.unitId);
    return unit ? `${property} — ${unit.name}` : property;
  }
  function targetKeyOf(propertyId: string, unitId: string | null) {
    if (unitId) return `${propertyId}:${unitId}`;
    return unitsFor(propertyId).length > 0 ? `${propertyId}:whole` : propertyId;
  }
  const defaultDate = (m: string) => (todayKey.startsWith(m) ? todayKey : `${m}-01`);

  function showSheet(next: EntryDraft) {
    setDraft(next);
    setDraftSeq((n) => n + 1);
    setRecording(true);
  }

  function openRecord() {
    showSheet({
      mode: "new",
      targetKey: model.targets[0]?.key ?? "",
      prefill: { type: "rent", amount: "", date: defaultDate(month), detail: "", note: "", category: "" },
    });
  }

  /** "Record" on an owed row: Classic's "Mark paid" — the rent form, filled and selected. */
  function quickRent(row: TargetRow<Tenant>) {
    const { target, expected, paid, fees, tenant } = row;
    showSheet({
      mode: "quick",
      targetKey: target.key,
      prefill: rentPrefill({ month, today: todayKey, expected, paid, fees, tenantName: tenant?.name }),
      context: `${tenant ? `${tenant.name} · ` : ""}${monthName(month)} · ${owedLine({ expected, paid, fees })}`,
    });
  }

  function quickRecurring(r: Recurring) {
    showSheet({
      mode: "quick",
      targetKey: targetKeyOf(r.propertyId, r.unitId),
      prefill: recurringPrefill(r, month),
      recurring: { id: r.id, month },
      context: `${r.category}${r.detail ? ` · ${r.detail}` : ""} · ${monthName(month)} ${
        r.frequency === "monthly" ? "monthly" : "yearly"
      } bill`,
    });
  }

  function openEdit(t: Transaction) {
    showSheet({
      mode: "edit",
      editingId: t.id,
      existingProof: t.attachments.length,
      targetKey: targetKeyOf(t.propertyId, t.unitId),
      prefill: { type: t.type, amount: String(t.amount), date: t.date, detail: t.detail, note: t.note, category: t.category },
    });
  }

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
    if (waive !== null) router.refresh();
  }

  function proofLanded(entryId: string, proof: ProofDTO) {
    setTransactions((prev) =>
      prev.map((t) => (t.id === entryId ? { ...t, attachments: [...(t.attachments ?? []), proof] } : t))
    );
  }

  // Header "+ Record payment" from another page lands here with ?record=rent;
  // #payments opens the transactions tab.
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("record")) {
        url.searchParams.delete("record");
        window.history.replaceState(window.history.state, "", url.toString());
        if (companies.length > 0 && !viewOnly) openRecord();
      }
    } catch {
      // Nothing to open.
    }
    const onHash = () => {
      if (window.location.hash === "#payments") setTab("transactions");
    };
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- Chasing and bulk actions (Classic's, unchanged) ---------- */

  async function remind(tenant: Tenant, expected: number, paid: number) {
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
    setChases((prev) => ({ ...prev, [tenant.id]: { at: data.notice.createdAt, month, read: false } }));
    if (data.smsHref) {
      window.location.href = data.smsHref;
      push(`Noted on ${tenant.name}'s portal. Your messages app has the text ready.`);
    } else {
      push(`Noted on ${tenant.name}'s portal. No phone number on file to text.`);
    }
  }

  async function postRent(row: TargetRow<Tenant>, owed: number) {
    const res = await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propertyId: row.target.propertyId,
        unitId: row.target.unitId,
        type: "rent",
        date: defaultDate(month),
        amount: owed,
        detail: row.tenant?.name ?? "",
        note: `${monthName(month)} rent`,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return false;
    setTransactions((prev) => [...prev, { ...data, attachments: [] }]);
    return true;
  }

  function markAllPaid() {
    const rows = model.owed;
    if (rows.length === 0) return;
    const summary = bulkSummary(rows.map((r) => ({ name: r.tenant?.name ?? r.target.label, owed: r.expected + r.fees - r.paid })));
    setConfirming({
      title: `Record ${money(summary.total)} of rent?`,
      body: `One entry per tenant, dated in ${monthName(month)}, for the full amount each still owes. To change an amount, add proof or waive a fee, use that row's Record instead.`,
      lines: summary.lines.map((l) => ({ label: l.name, amount: money(l.owed) })),
      confirmLabel: `Record ${rows.length} payments`,
      onConfirm: async () => {
        setBulkBusy("rent");
        let done = 0;
        let failed = 0;
        for (const r of rows) {
          if (await postRent(r, r.expected + r.fees - r.paid)) done += 1;
          else failed += 1;
        }
        setBulkBusy("");
        if (failed > 0) push(`Recorded ${done}; ${failed} didn't save. Check the ledger.`, "bad");
        else push(`${money(summary.total)} recorded across ${done} ${done === 1 ? "tenant" : "tenants"}.`);
      },
    });
  }

  const dueRecurring = useMemo(() => {
    const monthNum = Number(month.slice(5, 7));
    const logged = new Set(
      transactions.filter((t) => t.recurringExpenseId && t.date.startsWith(month)).map((t) => t.recurringExpenseId)
    );
    return recurring
      .filter((r) => r.active && visibleIds.has(r.propertyId))
      .filter((r) => r.frequency === "monthly" || r.month === monthNum)
      .filter((r) => !logged.has(r.id));
  }, [recurring, transactions, month, visibleIds]);

  const dueLoans = useMemo(
    () =>
      loans
        .filter((l) => visibleIds.has(l.propertyId) && loanIsDue(l, l.payments, month, l.active))
        .map((l) => {
          const s = suggestPayment(l, l.payments, month);
          const escrow = Math.round((s.escrowTax + s.escrowInsurance) * 100) / 100;
          return { loan: l, total: Math.round((s.interest + s.principal + escrow) * 100) / 100 };
        }),
    [loans, month, visibleIds]
  );

  async function postLoanPayment(loanId: string) {
    const res = await fetch(`/api/loans/${loanId}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return false;
    loanRecorded(loanId, data.payment as LoanPaymentDTO, data.transactions as unknown[], false);
    return true;
  }

  function loanRecorded(loanId: string, payment: LoanPaymentDTO, entries: unknown[], announce = true) {
    setLoans((prev) =>
      prev.map((l) =>
        l.id === loanId ? { ...l, payments: [...l.payments, payment].sort((a, b) => a.month.localeCompare(b.month)) } : l
      )
    );
    setTransactions((prev) => [...prev, ...(entries as Transaction[]).map((t) => ({ ...t, attachments: [] }))]);
    setPayingLoanId("");
    if (announce)
      push(
        `Logged: ${money(payment.interest)} interest${payment.escrow > 0 ? `, ${money(payment.escrow)} escrow` : ""}, ${money(
          payment.principal
        )} off the loan.`
      );
  }

  function logAllBills() {
    const rows = dueRecurring;
    const loanRows = dueLoans;
    const count = rows.length + loanRows.length;
    if (count === 0) return;
    const total = rows.reduce((s, r) => s + r.amount, 0) + loanRows.reduce((s, l) => s + l.total, 0);
    setConfirming({
      title: `Log ${money(total)} of bills?`,
      body: `Adds ${count} ${count === 1 ? "bill" : "bills"} for ${monthName(month)} at the amounts below.${
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
        for (const l of loanRows) if (!(await postLoanPayment(l.loan.id))) failed += 1;
        for (const r of rows) {
          const res = await fetch(`/api/recurring/${r.id}/log`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ month }),
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok) setTransactions((prev) => [...prev, { ...data, attachments: [] }]);
          else failed += 1;
        }
        setBulkBusy("");
        if (failed > 0) push(`${failed} of ${count} bills didn't log.`, "bad");
        else push(`${money(total)} of bills logged for ${monthName(month, false)}.`);
      },
    });
  }

  function removeTransaction(t: Transaction) {
    setConfirming({
      title: "Delete this entry?",
      body: `${t.type === "rent" ? "Rent" : "Expense"} of ${money(t.amount)} on ${formatDay(t.date)} for ${targetLabel(
        t
      )}. Any proof attached to it is deleted too.`,
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

  /* ---------- Needs attention ---------- */

  const attention = useMemo<Attention[]>(() => {
    const out: Attention[] = [];
    for (const r of initialRepairs.filter((r) => visibleIds.has(r.propertyId))) {
      out.push({
        key: `repair-${r.id}`,
        tone: r.urgency === "urgent" ? "danger" : "warning",
        text: (
          <>
            <strong>{r.title}</strong> · {[r.propertyName, r.unitName].filter(Boolean).join(" — ")}
          </>
        ),
        action: { label: "Review", href: "/dashboard/repairs" },
      });
    }
    for (const row of model.owed) {
      const { tenant, late, expected, paid, fees } = row;
      const owe = expected + fees - paid;
      const chase = tenant ? chases[tenant.id] : undefined;
      const recent = Boolean(tenant && chase?.month === month && chasedRecently(chase.at));
      const menu: MenuItem[] = [];
      if (tenant && !viewOnly)
        menu.push({
          label:
            chasing === tenant.id
              ? "Sending…"
              : recent && chase
                ? `Remind again (last ${remindedAgo(chase.at, clock)})`
                : "Remind",
          disabled: chasing === tenant.id,
          onSelect: () => void remind(tenant, expected, paid),
        });
      if (tenant?.phone) {
        menu.push({ label: "Call", href: telHref(tenant.phone) });
        menu.push({ label: "Text", href: smsHref(tenant.phone) });
      }
      menu.push({
        label: "Open property",
        href: tenant ? `/dashboard/properties/${row.target.propertyId}#tenant-${tenant.id}` : `/dashboard/properties/${row.target.propertyId}`,
      });
      out.push({
        key: `owed-${row.target.key}`,
        tone: late > 0 ? "danger" : "warning",
        text: (
          <>
            <strong>{tenant ? tenant.name : row.target.label}</strong> owes{" "}
            <span className="num">{money(owe)}</span>
            {late > 0 ? ` · ${late === 1 ? "1 day" : `${late} days`} late` : ""}
            {tenant && waivedLateFees[`${tenant.id}|${month}`] ? " · fee waived" : ""}
          </>
        ),
        action: viewOnly
          ? {
              label: "Open",
              href: tenant ? `/dashboard/properties/${row.target.propertyId}#tenant-${tenant.id}` : `/dashboard/properties/${row.target.propertyId}`,
            }
          : { label: "Record", onClick: () => quickRent(row) },
        menu: viewOnly ? menu.filter((m) => m.label !== "Open property") : menu,
      });
    }
    for (const t of tenants.filter((t) => visibleIds.has(t.propertyId))) {
      const status = leaseStatus(t, now);
      if (status.kind !== "ending" && status.kind !== "expired") continue;
      out.push({
        key: `lease-${t.id}`,
        tone: status.kind === "expired" ? "danger" : "warning",
        text: (
          <>
            <strong>{t.name}</strong> · lease {status.kind === "expired" ? `ended ${formatDay(t.leaseEnd)}` : status.label.toLowerCase()}
          </>
        ),
        action: { label: viewOnly ? "Open" : "Renew", href: `/dashboard/properties/${t.propertyId}#tenant-${t.id}` },
      });
    }
    for (const t of model.targets.filter((t) => t.vacant && t.vacantSince)) {
      const days = vacantDays(t.vacantSince!, todayKey);
      out.push({
        key: `vacant-${t.key}`,
        tone: "neutral",
        text: (
          <>
            <strong>{t.label}</strong> · vacant {vacantFor(days)}
          </>
        ),
        action: { label: viewOnly ? "Open" : "Add tenant", href: `/dashboard/properties/${t.propertyId}` },
      });
    }
    const docs = byUrgency(
      expiringDocs.filter((d) => (llc === "all" || d.companyId === llc) && expiryState(d.expiresOn, todayKey) !== "ok"),
      todayKey
    );
    for (const d of docs) {
      out.push({
        key: `doc-${d.id}`,
        tone: expiryState(d.expiresOn, todayKey) === "expired" ? "danger" : "warning",
        text: (
          <>
            <strong>{d.title}</strong> · {expiryLabel(d.expiresOn, todayKey, formatDay).toLowerCase()}
          </>
        ),
        action: {
          label: "Review",
          href: d.vendorId ? "/dashboard/repairs/vendors" : d.propertyId ? `/dashboard/properties/${d.propertyId}` : "/dashboard/files",
        },
      });
    }
    for (const d of deposits.filter((d) => !d.returnedOn && visibleIds.has(d.propertyId))) {
      const state = returnState(d, todayKey);
      out.push({
        key: `deposit-${d.id}`,
        tone: state.kind === "overdue" ? "danger" : "warning",
        text: (
          <>
            <strong>{d.tenantName}</strong>&apos;s deposit · {returnLabel(state).toLowerCase()}
          </>
        ),
        action: { label: "Review", href: `/dashboard/move-outs/${d.id}` },
      });
    }
    for (const r of dueRecurring) {
      out.push({
        key: `bill-${r.id}`,
        tone: "accent",
        text: (
          <>
            <strong>{r.category}</strong> · {targetLabel(r)} · <span className="num">{money(r.amount)}</span>
          </>
        ),
        action: viewOnly ? undefined : { label: "Log", onClick: () => quickRecurring(r) },
      });
    }
    for (const l of dueLoans) {
      out.push({
        key: `loan-${l.loan.id}`,
        tone: "accent",
        text: (
          <>
            <strong>Mortgage</strong> · {l.loan.lender} · <span className="num">{money(l.total)}</span>
          </>
        ),
        action: viewOnly ? undefined : { label: "Log", onClick: () => setPayingLoanId(l.loan.id) },
      });
    }
    // Red first, then amber, then bills to log, then vacancies; stable within each.
    const rank: Record<Tone, number> = { danger: 0, warning: 1, accent: 2, neutral: 3 };
    return out.map((a, i) => ({ a, i })).sort((x, y) => rank[x.a.tone] - rank[y.a.tone] || x.i - y.i).map((x) => x.a);
    // quickRent/quickRecurring/remind close over state they read at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRepairs, visibleIds, model, chases, chasing, clock, month, waivedLateFees, tenants, now, todayKey, expiringDocs, llc, deposits, dueRecurring, dueLoans, viewOnly]);

  /* ---------- Ledger, charts, bills ---------- */

  const search = query.trim().toLowerCase();
  const ledgerRows = useMemo(() => {
    const base = search ? visibleTransactions : visibleTransactions.filter((t) => t.date.startsWith(month));
    return base
      .filter((t) => !typeFilter || t.type === typeFilter)
      .filter(
        (t) =>
          !search ||
          [targetLabel(t), t.detail, t.note, t.category, t.amount.toFixed(2), formatDay(t.date)]
            .join(" ")
            .toLowerCase()
            .includes(search)
      )
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
    // targetLabel reads properties and units.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleTransactions, month, search, typeFilter, properties]);
  useEffect(() => setLedgerLimit(LEDGER_PAGE), [search, typeFilter, month, llc]);

  const series = useMemo(() => {
    const keys = Array.from({ length: 12 }, (_, i) => shiftMonth(month, i - 11));
    const buckets = new Map(keys.map((k) => [k, { month: k, rent: 0, expense: 0 }]));
    for (const t of visibleTransactions) {
      const b = buckets.get(t.date.slice(0, 7));
      if (!b) continue;
      if (t.type === "rent") b.rent += t.amount;
      else b.expense += t.amount;
    }
    return keys.map((k) => buckets.get(k)!);
  }, [visibleTransactions, month]);

  const byCategory = useMemo(() => {
    const totals = new Map<string, number>();
    for (const t of visibleTransactions) {
      if (t.type !== "expense" || !t.date.startsWith(month)) continue;
      const key = t.category || "Other";
      totals.set(key, (totals.get(key) ?? 0) + t.amount);
    }
    return Array.from(totals, ([label, value]) => ({ label, value }));
  }, [visibleTransactions, month]);

  const activeRecurring = recurring.filter((r) => r.active && visibleIds.has(r.propertyId));
  const dueIds = new Set(dueRecurring.map((r) => r.id));

  /* ---------- Add property / LLC / join ---------- */

  const [form, setForm] = useState<"" | "property" | "llc" | "join">("");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submitForm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setFormError("");
    setBusy(true);
    try {
      if (form === "llc") {
        const res = await fetch("/api/companies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: String(data.get("name") ?? "").trim() }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return setFormError(body?.error || "Couldn't add that LLC.");
        setCompanies((prev) => [...prev, body]);
        setLlcSelection(body.id);
        push(`${body.name} added.`);
      } else if (form === "join") {
        const res = await fetch("/api/invites/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: String(data.get("code") ?? "").trim() }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return setFormError(body?.error || "Couldn't join with that code.");
        window.location.href = "/dashboard";
        return;
      } else if (form === "property") {
        const res = await fetch("/api/properties", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: String(data.get("name") ?? "").trim(),
            address: String(data.get("address") ?? "").trim(),
            monthlyRent: parseFloat(String(data.get("rent") ?? "")) || 0,
            companyId: String(data.get("companyId") ?? ""),
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return setFormError(body?.error || "Couldn't add that property.");
        setProperties((prev) => [...prev, body]);
        push(`${body.name} added.`);
      }
      setForm("");
    } finally {
      setBusy(false);
    }
  }

  /* ---------- Render ---------- */

  const feesOwed = model.owed.reduce((s, r) => s + r.fees, 0);
  const occupancyPct = model.rentable > 0 ? Math.round((model.occupied / model.rentable) * 100) : 0;
  const showLlcColumn = llc === "all" && companies.length > 1;

  const monthPicker = (
    <div className={styles.monthPicker} role="group" aria-label="Month">
      <button
        type="button"
        className={styles.monthStep}
        aria-label="Previous month"
        disabled={monthIndex <= 0}
        onClick={() => setMonth(months[monthIndex - 1])}
      >
        <IconChevronLeft size={16} />
      </button>
      <select className={styles.monthSelect} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
        {months
          .slice()
          .reverse()
          .map((m) => (
            <option key={m} value={m}>
              {monthName(m)}
            </option>
          ))}
      </select>
      <button
        type="button"
        className={styles.monthStep}
        aria-label="Next month"
        disabled={monthIndex < 0 || monthIndex >= months.length - 1}
        onClick={() => setMonth(months[monthIndex + 1])}
      >
        <IconChevronRight size={16} />
      </button>
    </div>
  );

  const bulkItems: MenuItem[] = [];
  if (!viewOnly && model.owed.length > 1)
    bulkItems.push({
      label: bulkBusy === "rent" ? "Recording…" : `Mark all ${model.owed.length} paid`,
      disabled: bulkBusy !== "",
      onSelect: markAllPaid,
    });
  if (!viewOnly && dueRecurring.length + dueLoans.length > 1)
    bulkItems.push({
      label: bulkBusy === "bills" ? "Logging…" : `Log all ${dueRecurring.length + dueLoans.length} bills`,
      disabled: bulkBusy !== "",
      onSelect: logAllBills,
    });

  const pageInfo = useMemo(
    () => ({ companies, onRecord: companies.length > 0 ? openRecord : undefined }),
    // openRecord reads the latest model when it runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [companies, model, month, todayKey]
  );

  return (
    <CommandPageProvider value={pageInfo}>
      <AppShell openRepairs={openRepairs} title="Overview" userLabel={userLabel} actions={companies.length > 0 ? monthPicker : undefined}>
        {companies.length === 0 ? (
          <div className={styles.firstRun}>
            <h2>Start with an LLC</h2>
            <p>Properties live under the company that owns them. Add your first LLC, then its properties.</p>
            <div className={styles.firstRunActions}>
              <button type="button" className={styles.btnPrimary} onClick={() => setForm("llc")}>
                Add an LLC
              </button>
              <button type="button" className={styles.btn} onClick={() => setForm("join")}>
                Join with a code
              </button>
            </div>
          </div>
        ) : (
          <>
            <section className={styles.kpis} aria-label={`${monthName(month)} totals`}>
              <div className={styles.kpi}>
                <div className={styles.kpiLabel}>Collected</div>
                <div className={`${styles.kpiValue} num`}>{money(model.collected)}</div>
                <div className={styles.progress} aria-hidden="true">
                  <span className={model.collectedPct >= 100 ? styles.progressDone : undefined} style={{ width: `${model.collectedPct}%` }} />
                </div>
                <div className={styles.kpiFoot}>
                  <span className="num">{model.collectedPct}% of due</span>
                  <span className="num">of {money(model.expected)}</span>
                </div>
              </div>
              <div className={styles.kpi}>
                <div className={styles.kpiLabel}>Outstanding</div>
                <div className={`${styles.kpiValue} num ${model.outstanding === 0 ? styles.zero : ""}`}>{money(model.outstanding)}</div>
                <div className={styles.kpiFoot}>
                  <span>
                    {model.owed.length === 0
                      ? "Everyone has paid"
                      : `${model.owed.length} ${model.owed.length === 1 ? "unit owes" : "units owe"}`}
                  </span>
                  {feesOwed > 0.005 && <span className="num">incl. {money(feesOwed)} fees</span>}
                </div>
              </div>
              <div className={styles.kpi}>
                <div className={styles.kpiLabel}>Expenses</div>
                <div className={`${styles.kpiValue} num ${model.expenses === 0 ? styles.zero : ""}`}>{money(model.expenses)}</div>
                <div className={styles.kpiFoot}>
                  <span>
                    {model.expenseCount} logged in {monthName(month, false)}
                  </span>
                </div>
              </div>
              <div className={styles.kpi}>
                <div className={styles.kpiLabel}>Occupancy</div>
                <div className={`${styles.kpiValue} num`}>{occupancyPct}%</div>
                <div className={styles.kpiFoot}>
                  <span className="num">
                    {model.occupied} of {model.rentable} {model.rentable === 1 ? "unit" : "units"} occupied
                  </span>
                </div>
              </div>
            </section>

            <div className={styles.body}>
              <div className={styles.main}>
                <section className={styles.panel} id="properties" aria-labelledby="cc-properties">
                  <div className={styles.panelHead}>
                    <h2 id="cc-properties">
                      Properties
                      <span className={styles.panelCount}>{model.rows.length}</span>
                    </h2>
                    {viewOnly ? (
                      <button type="button" className={styles.btnSmall} onClick={() => setForm("join")}>
                        Join with a code
                      </button>
                    ) : (
                      <OverflowMenu
                        label="Add"
                        trigger={
                          <>
                            <IconPlus size={16} /> Add
                          </>
                        }
                        triggerClassName={styles.btnSmall}
                        items={[
                          { label: "Add a property", onSelect: () => setForm("property") },
                          { label: "Add an LLC", onSelect: () => setForm("llc") },
                          { label: "Join an LLC with a code", onSelect: () => setForm("join") },
                        ]}
                      />
                    )}
                  </div>
                  <div className={styles.tableWrap}>
                    <table className={`${styles.table} ${styles.propTable}`} id="tenants">
                      <thead>
                        <tr>
                          <th>Property</th>
                          <th>Tenant</th>
                          {showLlcColumn && <th className={styles.llcCol}>LLC</th>}
                          <th className={styles.numCol}>Rent</th>
                          <th>Status</th>
                          <th className={styles.numCol}>Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {model.rows.map((row) => {
                          const badge = STATUS_BADGE[row.status];
                          const href = row.tenant
                            ? `/dashboard/properties/${row.property.id}#tenant-${row.tenant.id}`
                            : `/dashboard/properties/${row.property.id}`;
                          const company = companies.find((c) => c.id === row.companyId);
                          const lease = row.tenant ? leaseStatus(row.tenant, now) : null;
                          return (
                            <tr key={row.target.key} className={styles.rowLink} onClick={() => router.push(href)}>
                              <td data-label="Property" className={styles.propCell}>
                                <Link href={href} prefetch={false} className={styles.propName} onClick={(e) => e.stopPropagation()}>
                                  {row.property.name}
                                  {row.unitName && <span className={styles.unit}> · {row.unitName}</span>}
                                </Link>
                                {row.property.address && <div className={styles.sub}>{row.property.address}</div>}
                              </td>
                              <td data-label="Tenant" className={styles.tenantCell}>
                                {row.tenant ? (
                                  <>
                                    <div>{row.tenant.name}</div>
                                    {lease && lease.kind !== "ok" && lease.kind !== "past" && (
                                      <div className={styles.sub}>{lease.label}</div>
                                    )}
                                  </>
                                ) : (
                                  <span className={styles.muted}>—</span>
                                )}
                              </td>
                              {showLlcColumn && (
                                <td data-label="LLC" className={`${styles.llcCell} ${styles.llcCol}`}>
                                  {company?.name ?? ""}
                                </td>
                              )}
                              <td data-label="Rent" className={`${styles.numCol} ${styles.rentCell} num`}>
                                {row.expected > 0 ? money(row.expected) : <span className={styles.muted}>—</span>}
                              </td>
                              <td data-label="Status" className={styles.statusCell}>
                                <StatusBadge
                                  status={badge.status}
                                  title={
                                    row.status === "late"
                                      ? `${row.late} ${row.late === 1 ? "day" : "days"} past due`
                                      : row.status === "vacant" && row.target.vacantSince
                                        ? `Vacant ${vacantFor(vacantDays(row.target.vacantSince, todayKey))}`
                                        : undefined
                                  }
                                >
                                  {badge.label}
                                </StatusBadge>
                              </td>
                              <td data-label="Balance" className={`${styles.numCol} ${styles.balanceCell} num ${row.balance > 0 ? styles.owe : styles.muted}`}>
                                {money(row.balance)}
                              </td>
                            </tr>
                          );
                        })}
                        {model.rows.length === 0 && (
                          <tr>
                            <td colSpan={showLlcColumn ? 6 : 5} className={styles.empty}>
                              No properties yet.
                              {!viewOnly && (
                                <>
                                  {" "}
                                  <button type="button" className={styles.linkBtn} onClick={() => setForm("property")}>
                                    Add a property
                                  </button>
                                </>
                              )}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className={styles.panel} id="payments" aria-label="Activity">
                  <div className={styles.tabs} role="tablist" aria-label="Activity">
                    {(
                      [
                        ["transactions", "Transactions"],
                        ["cashflow", "Cash flow"],
                        ["bills", "Recurring bills"],
                      ] as [Tab, string][]
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={tab === key}
                        className={`${styles.tab} ${tab === key ? styles.tabOn : ""}`}
                        onClick={() => setTab(key)}
                      >
                        {label}
                        {key === "bills" && dueRecurring.length + dueLoans.length > 0 && (
                          <span className={styles.tabCount}>{dueRecurring.length + dueLoans.length}</span>
                        )}
                      </button>
                    ))}
                  </div>

                  {tab === "transactions" && (
                    <div role="tabpanel" aria-label="Transactions">
                      <div className={styles.ledgerTools}>
                        <label className={styles.searchBox}>
                          <IconSearch size={16} />
                          <input
                            type="search"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search every entry…"
                            aria-label="Search the ledger"
                          />
                        </label>
                        <select
                          className={styles.select}
                          value={typeFilter}
                          onChange={(e) => setTypeFilter(e.target.value as "" | "rent" | "expense")}
                          aria-label="Filter by type"
                        >
                          <option value="">All types</option>
                          <option value="rent">Rent</option>
                          <option value="expense">Expenses</option>
                        </select>
                        <span className={styles.ledgerScope}>
                          {search ? `${ledgerRows.length} across all time` : `${ledgerRows.length} in ${monthName(month)}`}
                        </span>
                      </div>
                      {ledgerRows.length === 0 ? (
                        <div className={styles.empty}>
                          {search ? `Nothing matches “${query.trim()}”.` : `Nothing recorded in ${monthName(month)} yet.`}
                        </div>
                      ) : (
                        <div className={styles.tableWrap}>
                          <table className={`${styles.table} ${styles.ledger}`}>
                            <thead>
                              <tr>
                                <th>Date</th>
                                <th>Property</th>
                                <th>Details</th>
                                <th className={styles.numCol}>Amount</th>
                                {!viewOnly && <th aria-label="Actions" />}
                              </tr>
                            </thead>
                            <tbody>
                              {ledgerRows.slice(0, ledgerLimit).map((t) => (
                                <tr key={t.id}>
                                  <td data-label="Date" className={styles.nowrap}>
                                    {shortDay(t.date)}
                                  </td>
                                  <td data-label="Property">{targetLabel(t)}</td>
                                  <td data-label="Details">
                                    <span className={styles.kind}>{t.type === "rent" ? "Rent" : t.category || "Expense"}</span>
                                    {t.detail && <span> {t.detail}</span>}
                                    {t.note && <div className={styles.sub}>{t.note}</div>}
                                    {t.attachments.length > 0 && (
                                      <div className={styles.proofs}>
                                        {t.attachments.map((a) => (
                                          <FileLink key={a.id} url={a.url} name={a.filename} mime={a.contentType} className={styles.proof} title={a.filename}>
                                            {a.filename}
                                          </FileLink>
                                        ))}
                                      </div>
                                    )}
                                  </td>
                                  <td data-label="Amount" className={`${styles.numCol} num ${t.type === "rent" ? styles.pos : styles.neg}`}>
                                    {t.type === "rent" ? "+" : "−"}
                                    {money(t.amount)}
                                  </td>
                                  {!viewOnly && (
                                    <td className={styles.actionsCell}>
                                      <OverflowMenu
                                        label={`Actions for ${money(t.amount)} on ${formatDay(t.date)}`}
                                        items={[
                                          { label: "Edit", icon: IconPencil, onSelect: () => openEdit(t) },
                                          { label: "Delete", icon: IconTrash, destructive: true, onSelect: () => removeTransaction(t) },
                                        ]}
                                      />
                                    </td>
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {ledgerRows.length > ledgerLimit && (
                        <div className={styles.more}>
                          <button type="button" className={styles.btn} onClick={() => setLedgerLimit((n) => n + LEDGER_PAGE)}>
                            Show {Math.min(ledgerRows.length - ledgerLimit, LEDGER_PAGE)} more
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {tab === "cashflow" && (
                    <div role="tabpanel" aria-label="Cash flow" className={styles.charts}>
                      <div className={styles.chartBox}>
                        <CashFlowChart data={series} />
                      </div>
                      <div className={styles.chartBox}>
                        <CategoryBars data={byCategory} caption={monthName(month)} />
                      </div>
                    </div>
                  )}

                  {tab === "bills" && (
                    <div role="tabpanel" aria-label="Recurring bills">
                      {activeRecurring.length === 0 && dueLoans.length === 0 ? (
                        <div className={styles.empty}>{viewOnly ? "No recurring bills set up." : "No recurring bills set up. Add them on a property page."}</div>
                      ) : (
                        <div className={styles.tableWrap}>
                          <table className={styles.table}>
                            <thead>
                              <tr>
                                <th>Bill</th>
                                <th>Property</th>
                                <th>Schedule</th>
                                <th className={styles.numCol}>Amount</th>
                                <th>{monthName(month, false)}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {dueLoans.map((l) => (
                                <tr key={`loan-${l.loan.id}`}>
                                  <td data-label="Bill">Mortgage · {l.loan.lender}</td>
                                  <td data-label="Property">{propName(l.loan.propertyId)}</td>
                                  <td data-label="Schedule">Monthly</td>
                                  <td data-label="Amount" className={`${styles.numCol} num`}>
                                    {money(l.total)}
                                  </td>
                                  <td data-label={monthName(month, false)}>
                                    {viewOnly ? (
                                      <StatusBadge status="info">Due</StatusBadge>
                                    ) : (
                                      <button type="button" className={styles.btnSmall} onClick={() => setPayingLoanId(l.loan.id)}>
                                        Log
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                              {activeRecurring.map((r) => {
                                const inMonth = r.frequency === "monthly" || r.month === Number(month.slice(5, 7));
                                return (
                                  <tr key={r.id}>
                                    <td data-label="Bill">
                                      {r.category}
                                      {r.detail && <div className={styles.sub}>{r.detail}</div>}
                                    </td>
                                    <td data-label="Property">{targetLabel(r)}</td>
                                    <td data-label="Schedule">
                                      {r.frequency === "monthly"
                                        ? `Monthly, day ${r.day}`
                                        : `Yearly, ${r.month ? MONTH_ONLY.format(new Date(2000, r.month - 1, 1)) : ""} ${r.day}`}
                                    </td>
                                    <td data-label="Amount" className={`${styles.numCol} num`}>
                                      {money(r.amount)}
                                    </td>
                                    <td data-label={monthName(month, false)}>
                                      {dueIds.has(r.id) ? (
                                        viewOnly ? (
                                          <StatusBadge status="info">Due</StatusBadge>
                                        ) : (
                                          <button type="button" className={styles.btnSmall} onClick={() => quickRecurring(r)}>
                                            Log
                                          </button>
                                        )
                                      ) : inMonth ? (
                                        <StatusBadge status="paid">Logged</StatusBadge>
                                      ) : (
                                        <span className={styles.muted}>Not this month</span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </section>
              </div>

              <aside className={styles.rail} aria-label="Needs attention and LLCs">
                <section className={styles.panel} aria-labelledby="cc-attention">
                  <div className={styles.panelHead}>
                    <h2 id="cc-attention">
                      Needs attention
                      {attention.length > 0 && <span className={styles.panelCount}>{attention.length}</span>}
                    </h2>
                    {bulkItems.length > 0 && <OverflowMenu label="Bulk actions" items={bulkItems} />}
                  </div>
                  {attention.length === 0 ? (
                    <div className={styles.allClear}>All clear for {monthName(month, false)}.</div>
                  ) : (
                    <ul className={styles.attnList}>
                      {(allAttention ? attention : attention.slice(0, ATTENTION_FIRST)).map((a) => (
                        <li key={a.key} className={styles.attnItem}>
                          <span className={`${styles.dot} ${styles[`dot_${a.tone}`]}`} aria-hidden="true" />
                          <span className={styles.attnText}>{a.text}</span>
                          {!a.action ? null : a.action.href ? (
                            <Link href={a.action.href} prefetch={false} className={styles.attnAction}>
                              {a.action.label}
                            </Link>
                          ) : (
                            <button type="button" className={styles.attnAction} onClick={a.action.onClick}>
                              {a.action.label}
                            </button>
                          )}
                          {a.menu && a.menu.length > 0 && <OverflowMenu label="More" items={a.menu} triggerClassName={styles.attnMore} />}
                        </li>
                      ))}
                    </ul>
                  )}
                  {attention.length > ATTENTION_FIRST && (
                    <button type="button" className={styles.showAll} onClick={() => setAllAttention((v) => !v)} aria-expanded={allAttention}>
                      {allAttention ? "Show fewer" : `Show all ${attention.length}`}
                    </button>
                  )}
                </section>

                <section className={styles.panel} aria-labelledby="cc-llc">
                  <div className={styles.panelHead}>
                    <h2 id="cc-llc">By LLC</h2>
                    {activeCompany && companies.length > 1 && (
                      <button type="button" className={styles.linkBtn} onClick={() => setLlcSelection("all")}>
                        All LLCs
                      </button>
                    )}
                  </div>
                  <ul className={styles.llcList}>
                    {model.byCompany.map((c) => (
                      <li key={c.company.id}>
                        <button type="button" className={styles.llcRow} onClick={() => setLlcSelection(c.company.id)} aria-pressed={llc === c.company.id}>
                          <span className={styles.llcTop}>
                            <span className={styles.llcName}>{c.company.name}</span>
                            <span className={`${styles.llcPct} num`}>{c.pct}%</span>
                          </span>
                          <span className={styles.progress} aria-hidden="true">
                            <span className={c.pct >= 100 ? styles.progressDone : undefined} style={{ width: `${c.pct}%` }} />
                          </span>
                          <span className={`${styles.llcSub} num`}>
                            {money(c.collected)} of {money(c.expected)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              </aside>
            </div>
          </>
        )}

        {draft && (
          <RecordEntrySheet
            key={draftSeq}
            open={recording}
            draft={draft}
            targets={model.targets}
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
              month={month}
              today={todayKey}
              focusAmount
              onClose={() => setPayingLoanId("")}
              onRecorded={(payment, entries) => loanRecorded(loan.id, payment, entries)}
            />
          ) : null;
        })()}

        <Modal
          open={form !== ""}
          narrow
          title={form === "property" ? "Add a property" : form === "llc" ? "Add an LLC" : "Join an LLC"}
          onClose={() => {
            setForm("");
            setFormError("");
          }}
        >
          <form className={styles.form} onSubmit={submitForm}>
            {form === "property" && (
              <>
                <label className={styles.field}>
                  <span>Property name</span>
                  <input name="name" required autoFocus placeholder="e.g. Birchwood Ave" />
                </label>
                <label className={styles.field}>
                  <span>Address</span>
                  <input name="address" placeholder="142 Birchwood Ave" />
                </label>
                <label className={styles.field}>
                  <span>Monthly rent ($)</span>
                  <input name="rent" type="number" min="0" step="0.01" placeholder="0.00" inputMode="decimal" />
                </label>
                <label className={styles.field}>
                  <span>Owned by</span>
                  <select name="companyId" defaultValue={activeCompany?.id ?? companies[0]?.id} required>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {form === "llc" && (
              <label className={styles.field}>
                <span>LLC name</span>
                <input name="name" required autoFocus placeholder="e.g. Birchwood Holdings LLC" />
              </label>
            )}
            {form === "join" && (
              <label className={styles.field}>
                <span>Join code</span>
                <input name="code" required autoFocus placeholder="K7P2-M9X4" autoComplete="off" />
              </label>
            )}
            {formError && <div className={styles.formError}>{formError}</div>}
            <div className={styles.formActions}>
              <button type="button" className={styles.btn} onClick={() => setForm("")}>
                Cancel
              </button>
              <button type="submit" className={styles.btnPrimary} disabled={busy}>
                {busy ? "Saving…" : form === "join" ? "Join" : "Add"}
              </button>
            </div>
          </form>
        </Modal>

        <ConfirmDialog request={confirming} onCancel={() => setConfirming(null)} />
        <Toasts toasts={toasts} onDismiss={dismiss} />
      </AppShell>
    </CommandPageProvider>
  );
}
