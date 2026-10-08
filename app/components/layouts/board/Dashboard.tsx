"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { shrinkImage } from "@/lib/shrinkImage";
import { money } from "@/lib/money";
import { STATUS_LABEL, ago } from "@/lib/maintenance";
import { chasedRecently, remindedAgo } from "@/lib/notices";
import { rentForMonth } from "@/lib/rent";
import type { TenantDTO } from "@/lib/tenants";
import { cardLateFeeLine } from "@/lib/late-fee-card";
import { dateFromISO, formatDay, isoDay, leaseStatus } from "@/lib/lease";
import { byUrgency, expiryLabel, expiryState } from "@/lib/documents";
import { isDue as loanIsDue, missedMonths, suggestPayment } from "@/lib/loans";
import type { LoanDTO, LoanPaymentDTO } from "@/lib/loans-db";
import { returnLabel, returnState } from "@/lib/move-out";
import { vacancyCost } from "@/lib/vacancy";
import { bulkSummary, entryDateFor, monthLabel, owedLine, recurringPrefill, rentNote, rentPrefill } from "@/lib/quick-record";
import { LANES, boardTargets, buildBoard, monthsThrough, shiftMonth, type BoardCard, type Lane } from "@/lib/layouts/board-lanes";
import AppShell from "../../AppShell";
import { useViewOnly } from "../../ViewOnly";
import CashFlowChart from "../../CashFlowChart";
import CategoryBars from "../../CategoryBars";
import Modal from "../../Modal";
import { FileActions } from "../../FileViewer";
import ConfirmDialog, { type ConfirmRequest } from "../../ConfirmDialog";
import { Toasts, useToasts } from "../../Toasts";
import { useNow } from "../../useNow";
import { useLivePulse } from "../../useLivePulse";
import RecordEntrySheet, { type EntryDraft, type SavedEntry } from "../../RecordEntrySheet";
import LoanPaymentDialog from "../../LoanPaymentDialog";
import { MarkReturnedDialog } from "../../MoveOut";
import type { ProofDTO } from "../../ProofPicker";
import StatusBadge from "../../ui/StatusBadge";
import OverflowMenu from "../../ui/OverflowMenu";
import { IconChevronLeft, IconChevronRight, IconPlus, IconExternal, IconTrash, IconFolder, IconPencil } from "../../icons";
import type { DashboardProps } from "../dashboard-props";
import LaneCard, { type CardExtras } from "./LaneCard";
import BoardLedger, { type Txn } from "./BoardLedger";
import styles from "./Dashboard.module.css";

type Company = DashboardProps["initialCompanies"][number];
type Property = DashboardProps["initialProperties"][number];
type Recurring = DashboardProps["initialRecurring"][number];

const LANE_TITLE: Record<Lane, string> = {
  late: "Late",
  due: "Due",
  vacant: "Vacant",
  ended: "Lease ended",
  paid: "Paid",
};

const LANE_EMPTY: Record<Lane, string> = {
  late: "Nobody is late.",
  due: "",
  vacant: "Every unit is let.",
  ended: "No leases have run out.",
  paid: "No one has paid in full yet.",
};

/** Paid cards past this many fold into "N more". */
const PAID_SHOWN = 5;

/**
 * The Status Board's Overview: one month of rent as a board — Late, Vacant,
 * Lease ended, Paid — with what to do about each card on the card. The rest
 * of what Classic's Overview carries (cash flow, bills, repairs, documents,
 * deposits, properties, the ledger) sits underneath, same data, same actions.
 */
export default function BoardDashboard({
  openRepairs,
  initialRepairs,
  expiringDocs,
  initialChases,
  lateFees = {},
  waivedLateFees = {},
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
  initialDeposits,
}: DashboardProps) {
  // Server's day first so the first render matches the HTML; the browser's
  // own day straight after (as Classic does).
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
  const recurring = initialRecurring;
  const rentChanges = initialRentChanges;
  const [loans, setLoans] = useState<LoanDTO[]>(initialLoans);
  const [transactions, setTransactions] = useState<Txn[]>(initialTransactions);
  const [deposits, setDeposits] = useState(initialDeposits);
  const [chases, setChases] = useState(initialChases);
  const [chasing, setChasing] = useState("");

  const [selectedCompany, setSelectedCompany] = useState<string>(
    initialCompanies.length === 1 ? initialCompanies[0].id : "all"
  );
  const [month, setMonth] = useState(serverToday.slice(0, 7));
  const [paidOpen, setPaidOpen] = useState(false);

  const [recording, setRecording] = useState(false);
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const [draftSeq, setDraftSeq] = useState(0);
  const [payingLoanId, setPayingLoanId] = useState("");
  const [returningId, setReturningId] = useState("");
  const [bulkBusy, setBulkBusy] = useState<"" | "rent" | "bills">("");
  const [uploadingFor, setUploadingFor] = useState("");
  const [proofError, setProofError] = useState<{ scope: string; message: string } | null>(null);
  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null);
  const [adding, setAdding] = useState<"" | "property" | "company" | "join">("");
  const [formError, setFormError] = useState("");
  const [formBusy, setFormBusy] = useState(false);
  const { toasts, push, dismiss } = useToasts();

  const visibleProperties = useMemo(
    () => (selectedCompany === "all" ? properties : properties.filter((p) => p.companyId === selectedCompany)),
    [properties, selectedCompany]
  );
  const visibleIds = useMemo(() => new Set(visibleProperties.map((p) => p.id)), [visibleProperties]);
  const visibleTransactions = useMemo(
    () => transactions.filter((t) => visibleIds.has(t.propertyId)),
    [transactions, visibleIds]
  );
  const targets = useMemo(() => boardTargets(visibleProperties, units), [visibleProperties, units]);

  const months = useMemo(() => monthsThrough(transactions, thisMonth), [transactions, thisMonth]);
  const monthIndex = months.indexOf(month);

  const board = useMemo(
    () =>
      buildBoard({
        month,
        today: todayKey,
        properties: visibleProperties,
        units,
        tenants,
        transactions,
        rentChanges,
        lateFees,
      }),
    [month, todayKey, visibleProperties, units, tenants, transactions, rentChanges, lateFees]
  );

  const unitsOf = useCallback((propertyId: string) => units.filter((u) => u.propertyId === propertyId), [units]);
  const targetLabel = useCallback(
    (t: { propertyId: string; unitId: string | null }) => {
      const p = properties.find((x) => x.id === t.propertyId)?.name ?? "—";
      if (!t.unitId) return p;
      const u = units.find((x) => x.id === t.unitId);
      return u ? `${p} — ${u.name}` : p;
    },
    [properties, units]
  );

  /* ---------- The record sheet (the same one Classic opens) ---------- */

  function showSheet(next: EntryDraft) {
    setProofError(null);
    setDraft(next);
    setDraftSeq((n) => n + 1);
    setRecording(true);
  }

  function targetKeyOf(propertyId: string, unitId: string | null) {
    if (unitId) return `${propertyId}:${unitId}`;
    return unitsOf(propertyId).length > 0 ? `${propertyId}:whole` : propertyId;
  }

  function openRecord() {
    showSheet({
      mode: "new",
      targetKey: targets[0]?.key ?? "",
      prefill: {
        type: "rent",
        amount: "",
        date: entryDateFor(month, todayKey),
        detail: "",
        note: "",
        category: "",
      },
    });
  }

  /** Classic's "Mark paid": the rent form with what's owed in it, fees included. */
  function recordFor(card: BoardCard<TenantDTO>) {
    const { target, expected, paid, fees, tenant } = card;
    if (card.lane === "late" || card.lane === "due") {
      showSheet({
        mode: "quick",
        targetKey: target.key,
        prefill: rentPrefill({ month, today: todayKey, expected, paid, fees, tenantName: tenant?.name }),
        context: `${tenant ? `${tenant.name} · ` : ""}${monthLabel(month)} · ${owedLine({ expected, paid, fees })}`,
      });
      return;
    }
    showSheet({
      mode: "new",
      targetKey: target.key,
      prefill: {
        type: "rent",
        amount: "",
        date: entryDateFor(month, todayKey),
        detail: tenant?.name ?? "",
        note: rentNote(month),
        category: "",
      },
    });
  }

  function quickRecurring(r: Recurring) {
    showSheet({
      mode: "quick",
      targetKey: targetKeyOf(r.propertyId, r.unitId),
      prefill: recurringPrefill(r, month),
      recurring: { id: r.id, month },
      context: `${r.category}${r.detail ? ` · ${r.detail}` : ""} · ${monthLabel(month)} ${r.frequency} bill`,
    });
  }

  function openEdit(t: Txn) {
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
    setTransactions((prev) => prev.map((t) => (t.id === entryId ? { ...t, attachments: [...t.attachments, proof] } : t)));
  }

  /* ---------- Rent chasing, bulk actions ---------- */

  async function remind(card: BoardCard<TenantDTO>) {
    const tenant = card.tenant;
    if (!tenant) return;
    setChasing(tenant.id);
    const res = await fetch(`/api/tenants/${tenant.id}/notices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "rent", month, expected: card.expected, paid: card.paid }),
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

  const owedCards = useMemo(() => [...board.lanes.late, ...board.lanes.due], [board]);

  async function postRent(card: BoardCard<TenantDTO>) {
    const res = await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propertyId: card.target.propertyId,
        unitId: card.target.unitId,
        type: "rent",
        date: entryDateFor(month, todayKey),
        amount: card.owed,
        detail: card.tenant?.name ?? "",
        note: rentNote(month),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return false;
    setTransactions((prev) => [...prev, { ...data, attachments: [] }]);
    return true;
  }

  function markAllPaid() {
    const rows = owedCards;
    if (rows.length === 0) return;
    const summary = bulkSummary(rows.map((r) => ({ name: r.tenant?.name ?? r.target.label, owed: r.owed })));
    setConfirming({
      title: `Record ${money(summary.total)} of rent?`,
      body: `One entry per tenant, dated in ${monthLabel(month)}, for the full amount each still owes. To change an amount, add proof or waive a fee, use that card's Record instead.`,
      lines: summary.lines.map((l) => ({ label: l.name, amount: money(l.owed) })),
      confirmLabel: `Record ${rows.length} payments`,
      onConfirm: async () => {
        setBulkBusy("rent");
        let done = 0;
        let failed = 0;
        for (const r of rows) {
          if (await postRent(r)) done += 1;
          else failed += 1;
        }
        setBulkBusy("");
        if (failed > 0) push(`Recorded ${done}; ${failed} didn't save. Check the ledger.`, "bad");
        else push(`${money(summary.total)} recorded across ${done} ${done === 1 ? "tenant" : "tenants"}.`);
      },
    });
  }

  /* ---------- Bills, mortgages, deposits ---------- */

  const recurringLogged = useMemo(() => {
    const set = new Set<string>();
    for (const t of transactions) if (t.recurringExpenseId) set.add(`${t.recurringExpenseId}|${t.date.slice(0, 7)}`);
    return set;
  }, [transactions]);

  const dueRecurring = useMemo(() => {
    const monthNum = Number(month.slice(5));
    return recurring
      .filter((r) => r.active && visibleIds.has(r.propertyId))
      .filter((r) => r.frequency === "monthly" || r.month === monthNum)
      .filter((r) => !recurringLogged.has(`${r.id}|${month}`));
  }, [recurring, visibleIds, month, recurringLogged]);

  const dueLoans = useMemo(
    () =>
      loans
        .filter((l) => visibleIds.has(l.propertyId) && loanIsDue(l, l.payments, month, l.active))
        .map((l) => {
          const s = suggestPayment(l, l.payments, month);
          const escrow = Math.round((s.escrowTax + s.escrowInsurance) * 100) / 100;
          return {
            loan: l,
            missed: missedMonths(l, l.payments, month, l.active).filter((m) => m < month),
            interest: s.interest,
            principal: s.principal,
            escrow,
            total: Math.round((s.interest + s.principal + escrow) * 100) / 100,
          };
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
    loanRecorded(loanId, data.payment as LoanPaymentDTO, data.transactions, false);
    return true;
  }

  function loanRecorded(loanId: string, payment: LoanPaymentDTO, entries: unknown[], announce = true) {
    setLoans((prev) =>
      prev.map((l) =>
        l.id === loanId ? { ...l, payments: [...l.payments, payment].sort((a, b) => a.month.localeCompare(b.month)) } : l
      )
    );
    setTransactions((prev) => [...prev, ...(entries as Txn[]).map((t) => ({ ...t, attachments: [] }))]);
    setPayingLoanId("");
    if (announce)
      push(
        `Logged: ${money(payment.interest)} interest${payment.escrow > 0 ? `, ${money(payment.escrow)} escrow` : ""}, ${money(payment.principal)} off the loan.`
      );
  }

  function logAllBills() {
    const count = dueRecurring.length + dueLoans.length;
    if (count === 0) return;
    const total = dueRecurring.reduce((s, r) => s + r.amount, 0) + dueLoans.reduce((s, l) => s + l.total, 0);
    setConfirming({
      title: `Log ${money(total)} of bills?`,
      body: `Adds ${count} ${count === 1 ? "bill" : "bills"} for ${monthLabel(month)} at the amounts below.${
        dueLoans.length ? " Mortgage principal comes off the loan rather than going in as an expense." : ""
      }`,
      lines: [
        ...dueRecurring.map((r) => ({ label: `${r.category}${r.detail ? ` · ${r.detail}` : ""}`, amount: money(r.amount) })),
        ...dueLoans.map((l) => ({ label: l.loan.lender, amount: money(l.total) })),
      ],
      confirmLabel: `Log ${count} bills`,
      onConfirm: async () => {
        setBulkBusy("bills");
        let failed = 0;
        for (const l of dueLoans) if (!(await postLoanPayment(l.loan.id))) failed += 1;
        for (const r of dueRecurring) {
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
        else push(`${money(total)} of bills logged for ${monthLabel(month)}.`);
      },
    });
  }

  /* ---------- Ledger actions ---------- */

  function removeTransaction(t: Txn) {
    setConfirming({
      title: "Delete this entry?",
      body: `${t.type === "rent" ? "Rent" : "Expense"} of ${money(t.amount)} on ${formatDay(t.date)} for ${targetLabel(t)}. Any proof attached to it is deleted too.`,
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

  async function addProof(transactionId: string, files: FileList | null) {
    if (!files || files.length === 0) return;
    setProofError(null);
    setUploadingFor(transactionId);
    let attached = 0;
    for (const file of Array.from(files)) {
      let res: Response;
      try {
        const form = new FormData();
        form.append("file", await shrinkImage(file));
        res = await fetch(`/api/transactions/${transactionId}/attachments`, { method: "POST", body: form });
      } catch {
        setProofError({ scope: transactionId, message: `Couldn't upload ${file.name} — check your connection.` });
        break;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setProofError({ scope: transactionId, message: data?.error || `Couldn't upload ${file.name}.` });
        break;
      }
      setTransactions((prev) =>
        prev.map((t) => (t.id === transactionId ? { ...t, attachments: [...t.attachments, data] } : t))
      );
      attached += 1;
    }
    setUploadingFor("");
    if (attached > 0) push(`${attached} ${attached === 1 ? "proof" : "proofs"} attached.`);
  }

  async function removeProof(attachmentId: string) {
    const res = await fetch(`/api/attachments/${attachmentId}`, { method: "DELETE" });
    if (!res.ok) return;
    setTransactions((prev) => prev.map((t) => ({ ...t, attachments: t.attachments.filter((a) => a.id !== attachmentId) })));
  }

  /* ---------- Properties & LLCs ---------- */

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
        push(`${p.name} removed.`);
      },
    });
  }

  async function submitForm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const val = (k: string) => String(f.get(k) ?? "").trim();
    setFormError("");
    setFormBusy(true);
    try {
      if (adding === "company") {
        const res = await fetch("/api/companies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: val("name") }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return setFormError(data?.error || "Couldn't add that LLC.");
        setCompanies((prev) => [...prev, data]);
        setSelectedCompany(data.id);
        push(`${data.name} added.`);
      } else if (adding === "join") {
        const res = await fetch("/api/invites/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: val("code") }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return setFormError(data?.error || "Couldn't join with that code.");
        window.location.href = "/dashboard";
        return;
      } else if (adding === "property") {
        const res = await fetch("/api/properties", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: val("name"),
            address: val("address"),
            monthlyRent: parseFloat(val("rent")) || 0,
            companyId: val("company"),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return setFormError(data?.error || "Couldn't add that property.");
        setProperties((prev) => [...prev, data]);
        push(`${data.name} added.`);
      }
      setAdding("");
    } finally {
      setFormBusy(false);
    }
  }

  /* ---------- Derived for the page ---------- */

  function extrasFor(card: BoardCard<TenantDTO>): CardExtras {
    const t = card.tenant;
    const policy = lateFeePolicies[card.property.companyId] ?? null;
    const waived = Boolean(t && waivedLateFees[`${t.id}|${month}`]);
    const chase = t ? chases[t.id] : undefined;
    const recent = chase && chase.month === month && chasedRecently(chase.at);
    const since = card.target.vacantSince?.slice(0, 10);
    return {
      feeLine:
        !waived && card.fees > 0
          ? cardLateFeeLine({ fees: card.fees, rent: card.expected, policy, mode: t?.lateFeeMode ?? "default" })
          : "",
      waived,
      lost:
        card.lane === "vacant" && since
          ? vacancyCost(since, todayKey, (m) =>
              rentForMonth(rentChanges, card.target.propertyId, card.target.unitId, m, card.target.monthlyRent)
            )
          : 0,
      reminded: recent ? `${remindedAgo(chase.at, clock)}${chase.read ? " · read" : ""}` : "",
      chasing: Boolean(t && chasing === t.id),
    };
  }

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

  const monthTotals = useMemo(() => {
    let rent = 0;
    let expense = 0;
    const cats = new Map<string, number>();
    for (const t of visibleTransactions) {
      if (!t.date.startsWith(month)) continue;
      if (t.type === "rent") rent += t.amount;
      else {
        expense += t.amount;
        const k = t.category || "Other";
        cats.set(k, (cats.get(k) ?? 0) + t.amount);
      }
    }
    return { rent, expense, net: rent - expense, byCategory: Array.from(cats, ([label, value]) => ({ label, value })) };
  }, [visibleTransactions, month]);

  const perCompany = useMemo(
    () =>
      companies.map((c) => {
        const ids = new Set(properties.filter((p) => p.companyId === c.id).map((p) => p.id));
        let rent = 0;
        let expense = 0;
        for (const t of transactions) {
          if (!ids.has(t.propertyId) || !t.date.startsWith(month)) continue;
          if (t.type === "rent") rent += t.amount;
          else expense += t.amount;
        }
        return { company: c, count: ids.size, rent, expense, net: rent - expense };
      }),
    [companies, properties, transactions, month]
  );

  const repairAlerts = initialRepairs.filter((r) => visibleIds.has(r.propertyId));
  const leaseSoon = tenants
    .filter((t) => visibleIds.has(t.propertyId))
    .map((t) => ({ tenant: t, status: leaseStatus(t, now) }))
    .filter(({ status }) => status.kind === "ending")
    .sort((a, b) => (a.status.days ?? 0) - (b.status.days ?? 0));
  const docAlerts = byUrgency(
    expiringDocs.filter(
      (d) => (selectedCompany === "all" || d.companyId === selectedCompany) && expiryState(d.expiresOn, todayKey) !== "ok"
    ),
    todayKey
  );
  const depositAlerts = deposits
    .filter((d) => !d.returnedOn && visibleIds.has(d.propertyId))
    .map((d) => ({ ...d, state: returnState(d, todayKey) }))
    .sort((a, b) => (a.returnBy ?? "9999").localeCompare(b.returnBy ?? "9999"));
  const billCount = dueRecurring.length + dueLoans.length;
  const otherCount = repairAlerts.length + leaseSoon.length + docAlerts.length + billCount + depositAlerts.length;

  const { collection } = board;
  const collectPct = collection.expected > 0 ? Math.min(100, Math.round((collection.collected / collection.expected) * 100)) : 0;
  const lanes = LANES.filter((l) => l !== "due" || board.lanes.due.length > 0);

  function jumpTo(lane: Lane) {
    document.getElementById(`lane-${lane}`)?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  }

  return (
    <AppShell
      openRepairs={openRepairs}
      title="Rent board"
      userLabel={userLabel}
      actions={
        companies.length > 0 && !viewOnly ? (
          <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={openRecord}>
            <IconPlus size={16} />
            Record
          </button>
        ) : undefined
      }
    >
      {companies.length === 0 ? (
        <div className={styles.firstRun}>
          <h2>Start with an LLC</h2>
          <p>
            Properties live under the company that owns them, so add your first LLC and then add its houses. You can
            invite partners to each LLC separately from the Team page.
          </p>
          <div className={styles.rowGap}>
            <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={() => setAdding("company")}>
              Add an LLC
            </button>
            <button type="button" className={styles.btn} onClick={() => setAdding("join")}>
              Join with a code
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* ---------- Month, LLC, and the month's money ---------- */}
          <div className={styles.toolbar}>
            <div className={styles.monthSwitch} role="group" aria-label="Month">
              <button
                type="button"
                className={styles.iconBtn}
                aria-label="Previous month"
                disabled={monthIndex <= 0}
                onClick={() => setMonth(months[monthIndex - 1])}
              >
                <IconChevronLeft size={18} />
              </button>
              <span className={styles.monthLabel} aria-live="polite">
                {monthLabel(month)}
              </span>
              <button
                type="button"
                className={styles.iconBtn}
                aria-label="Next month"
                disabled={monthIndex < 0 || monthIndex >= months.length - 1}
                onClick={() => setMonth(months[monthIndex + 1])}
              >
                <IconChevronRight size={18} />
              </button>
              {month !== thisMonth && (
                <button type="button" className={styles.linkBtn} onClick={() => setMonth(thisMonth)}>
                  This month
                </button>
              )}
            </div>
            {companies.length > 1 && (
              <div className={styles.llcScroll}>
                <div role="radiogroup" aria-label="LLC" className={styles.segment}>
                  {[{ id: "all", name: "All" }, ...companies].map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      role="radio"
                      aria-checked={selectedCompany === c.id}
                      className={`${styles.segOption} ${selectedCompany === c.id ? styles.segOn : ""}`}
                      onClick={() => setSelectedCompany(c.id)}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <section className={styles.summary} aria-label={`${monthLabel(month)} rent`}>
            <div className={styles.collected}>
              <span className={styles.summaryLabel}>Collected in {monthLabel(month)}</span>
              <span className={`${styles.collectedValue} num`}>{money(board.rentIn)}</span>
            </div>
            <div className={styles.rollBox}>
              <div className={styles.rollTop}>
                <span>
                  Rent roll <span className="num">{money(collection.collected)}</span> of{" "}
                  <span className="num">{money(collection.expected)}</span>
                </span>
                <span className="num">{collectPct}%</span>
              </div>
              <div className={styles.bigBar}>
                <span style={{ width: `${collectPct}%` }} />
              </div>
              <div className={styles.rollMeta}>
                {collection.paidCount} of {collection.dueCount} {collection.dueCount === 1 ? "unit" : "units"} paid their
                rent in full
              </div>
            </div>
            <div className={styles.laneJump} aria-label="Jump to a lane">
              {lanes.map((l) => (
                <button key={l} type="button" className={`${styles.jump} ${styles[`jump_${l}`] ?? ""}`} onClick={() => jumpTo(l)}>
                  <span className={`${styles.jumpCount} num`}>{board.lanes[l].length}</span>
                  {LANE_TITLE[l]}
                </button>
              ))}
            </div>
          </section>

          {/* ---------- The board ---------- */}
          <div className={styles.board} data-lanes={lanes.length}>
            {lanes.map((lane) => {
              const cards = board.lanes[lane];
              const shown = lane === "paid" && !paidOpen ? cards.slice(0, PAID_SHOWN) : cards;
              const laneTotal =
                lane === "late" || lane === "due"
                  ? cards.reduce((s, c) => s + c.owed, 0)
                  : lane === "paid"
                    ? cards.reduce((s, c) => s + c.paid, 0)
                    : lane === "vacant"
                      ? cards.reduce((s, c) => s + c.expected, 0)
                      : 0;
              return (
                <section key={lane} id={`lane-${lane}`} className={`${styles.lane} ${styles[`laneBox_${lane}`]}`} aria-labelledby={`lane-h-${lane}`}>
                  <header className={styles.laneHead}>
                    <span className={styles.laneDot} aria-hidden="true" />
                    <h2 id={`lane-h-${lane}`}>{LANE_TITLE[lane]}</h2>
                    <span className={styles.laneCount}>{cards.length}</span>
                    <span className={styles.grow} />
                    {laneTotal > 0 && (
                      <span className={`${styles.laneTotal} num`}>
                        {money(Math.round(laneTotal * 100) / 100)}
                        {lane === "vacant" ? "/mo" : ""}
                      </span>
                    )}
                    {lane === "late" && owedCards.length > 1 && !viewOnly && (
                      <OverflowMenu
                        label="Late lane actions"
                        items={[
                          {
                            label: bulkBusy === "rent" ? "Recording…" : `Mark all ${owedCards.length} paid`,
                            icon: IconPlus,
                            onSelect: markAllPaid,
                            disabled: bulkBusy !== "",
                          },
                        ]}
                      />
                    )}
                  </header>
                  <div className={styles.laneBody}>
                    {cards.length === 0 && <div className={styles.laneEmpty}>{LANE_EMPTY[lane]}</div>}
                    {shown.map((card) => (
                      <LaneCard
                        key={card.target.key}
                        card={card}
                        extras={extrasFor(card)}
                        onRecord={() => recordFor(card)}
                        onRemind={() => void remind(card)}
                      />
                    ))}
                    {lane === "paid" && cards.length > PAID_SHOWN && (
                      <button type="button" className={styles.moreBtn} onClick={() => setPaidOpen((o) => !o)} aria-expanded={paidOpen}>
                        {paidOpen ? "Show fewer" : `${cards.length - PAID_SHOWN} more`}
                      </button>
                    )}
                  </div>
                </section>
              );
            })}
          </div>

          {/* ---------- Everything else, underneath ---------- */}
          <div className={styles.below}>
            <section className={`${styles.section} ${styles.attention}`} aria-labelledby="board-attn">
              <div className={styles.sectionHead}>
                <h2 id="board-attn">Also this month</h2>
                <span className={styles.sectionMeta}>{otherCount ? `${otherCount} to look at` : "All clear"}</span>
                {billCount > 1 && !viewOnly && (
                  <button type="button" className={`${styles.btn} ${styles.small}`} disabled={bulkBusy !== ""} onClick={logAllBills}>
                    {bulkBusy === "bills" ? "Logging…" : `Log all ${billCount} bills`}
                  </button>
                )}
              </div>
              {otherCount === 0 ? (
                <div className={styles.empty}>No repairs waiting, every bill logged, no documents or leases running out.</div>
              ) : (
                <ul className={styles.attnList}>
                  {repairAlerts.map((r) => (
                    <li key={`r-${r.id}`} className={styles.attnRow}>
                      <div className={styles.attnMain}>
                        <div className={styles.attnTitle}>
                          {r.title}{" "}
                          <StatusBadge status={r.urgency === "urgent" ? "late" : "partial"}>
                            {r.urgency === "urgent" ? "Urgent repair" : STATUS_LABEL[r.status].landlord}
                          </StatusBadge>
                        </div>
                        <div className={styles.sub}>
                          {[r.propertyName, r.unitName].filter(Boolean).join(" — ")} · {r.tenantName || "a tenant"} ·{" "}
                          {ago(r.createdAt, clock)}
                        </div>
                      </div>
                      <Link href="/dashboard/repairs" className={`${styles.btn} ${styles.small}`}>
                        {viewOnly ? "Open" : "Work it"}
                      </Link>
                    </li>
                  ))}
                  {dueRecurring.map((r) => (
                    <li key={`b-${r.id}`} className={styles.attnRow}>
                      <div className={styles.attnMain}>
                        <div className={styles.attnTitle}>
                          {targetLabel(r)} <StatusBadge status="neutral">{r.category}</StatusBadge>
                        </div>
                        <div className={styles.sub}>
                          {r.detail || `${r.frequency === "monthly" ? "Monthly" : "Yearly"} bill, not logged yet`}
                        </div>
                      </div>
                      <span className={`${styles.attnAmt} num`}>{money(r.amount)}</span>
                      {!viewOnly && (
                        <button type="button" className={`${styles.btn} ${styles.small}`} onClick={() => quickRecurring(r)}>
                          Log it
                        </button>
                      )}
                    </li>
                  ))}
                  {dueLoans.map(({ loan, missed, interest, principal, escrow, total }) => (
                    <li key={`m-${loan.id}`} className={styles.attnRow}>
                      <div className={styles.attnMain}>
                        <div className={styles.attnTitle}>
                          {targetLabel({ propertyId: loan.propertyId, unitId: null })}{" "}
                          <StatusBadge status="neutral">Mortgage</StatusBadge>
                        </div>
                        <div className={styles.sub}>
                          {loan.lender}: {money(interest)} interest{escrow > 0 ? ` · ${money(escrow)} escrow` : ""} ·{" "}
                          {money(principal)} principal
                          {missed.length > 0 &&
                            ` · ${missed.length === 1 ? monthLabel(missed[0]) : `${missed.length} earlier months`} not recorded yet`}
                        </div>
                      </div>
                      <span className={`${styles.attnAmt} num`}>{money(total)}</span>
                      {!viewOnly && (
                        <>
                          <OverflowMenu
                            label={`More for ${loan.lender}`}
                            items={[{ label: "Split differently", icon: IconExternal, href: `/dashboard/properties/${loan.propertyId}` }]}
                          />
                          <button type="button" className={`${styles.btn} ${styles.small}`} onClick={() => setPayingLoanId(loan.id)}>
                            Log it
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                  {leaseSoon.map(({ tenant, status }) => (
                    <li key={`l-${tenant.id}`} className={styles.attnRow}>
                      <div className={styles.attnMain}>
                        <div className={styles.attnTitle}>
                          {tenant.name} <StatusBadge status="partial">{status.label}</StatusBadge>
                        </div>
                        <div className={styles.sub}>
                          {targetLabel({ propertyId: tenant.propertyId, unitId: tenant.unitId })} · ends {formatDay(tenant.leaseEnd)}
                        </div>
                      </div>
                      <Link href={`/dashboard/properties/${tenant.propertyId}#tenant-${tenant.id}`} className={`${styles.btn} ${styles.small}`}>
                        Open lease
                      </Link>
                    </li>
                  ))}
                  {docAlerts.map((d) => {
                    const state = expiryState(d.expiresOn, todayKey);
                    return (
                      <li key={`d-${d.id}`} className={styles.attnRow}>
                        <div className={styles.attnMain}>
                          <div className={styles.attnTitle}>
                            {d.title}{" "}
                            <StatusBadge status={state === "expired" ? "late" : "partial"}>
                              {expiryLabel(d.expiresOn, todayKey, formatDay)}
                            </StatusBadge>
                          </div>
                          <div className={styles.sub}>
                            {d.kind} · {d.ownerLabel}
                          </div>
                        </div>
                        <FileActions url={d.url} name={d.filename || d.title} mime={d.contentType} />
                        {!viewOnly && (
                          <Link
                            href={d.vendorId ? "/dashboard/repairs/vendors" : d.propertyId ? `/dashboard/properties/${d.propertyId}` : "/dashboard"}
                            className={`${styles.btn} ${styles.small}`}
                          >
                            Replace
                          </Link>
                        )}
                      </li>
                    );
                  })}
                  {depositAlerts.map((d) => (
                    <li key={`dep-${d.id}`} className={styles.attnRow}>
                      <div className={styles.attnMain}>
                        <div className={styles.attnTitle}>
                          {d.tenantName}&apos;s deposit{" "}
                          <StatusBadge status={d.state.kind === "overdue" ? "late" : "partial"}>{returnLabel(d.state)}</StatusBadge>
                        </div>
                        <div className={styles.sub}>
                          {properties.find((p) => p.id === d.propertyId)?.name ?? "—"} · moved out {formatDay(d.movedOutOn)}
                          {d.returnBy ? ` · return by ${formatDay(d.returnBy)}` : ""}
                          {d.refund === 0 ? " · all kept, the itemized list still goes out" : ""}
                        </div>
                      </div>
                      <span className={`${styles.attnAmt} num`}>{money(d.refund)}</span>
                      <Link href={`/dashboard/move-outs/${d.id}`} className={`${styles.btn} ${styles.small}`}>
                        Statement
                      </Link>
                      {!viewOnly && (
                        <button type="button" className={`${styles.btn} ${styles.small}`} onClick={() => setReturningId(d.id)}>
                          Mark sent
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className={`${styles.section} ${styles.cash}`} aria-labelledby="board-cash">
              <div className={styles.sectionHead}>
                <h2 id="board-cash">Cash flow</h2>
                <span className={styles.sectionMeta}>
                  {monthLabel(month)}: <span className="num">{money(monthTotals.rent)}</span> in ·{" "}
                  <span className="num">{money(monthTotals.expense)}</span> out · net{" "}
                  <span className={`num ${monthTotals.net > 0 ? styles.pos : monthTotals.net < 0 ? styles.neg : ""}`}>
                    {monthTotals.net < 0 ? "−" : ""}
                    {money(Math.abs(monthTotals.net))}
                  </span>
                </span>
              </div>
              <div className={styles.chartCard}>
                <CashFlowChart data={series} />
              </div>
              <div className={styles.chartCard}>
                <CategoryBars data={monthTotals.byCategory} caption={monthLabel(month)} />
              </div>
            </section>
          </div>

          {selectedCompany === "all" && companies.length > 1 && (
            <section className={styles.section} aria-labelledby="board-llc">
              <div className={styles.sectionHead}>
                <h2 id="board-llc">By LLC · {monthLabel(month)}</h2>
              </div>
              <div className={styles.llcGrid}>
                {perCompany.map((row) => (
                  <button key={row.company.id} type="button" className={styles.llcCard} onClick={() => setSelectedCompany(row.company.id)}>
                    <span className={styles.llcName}>{row.company.name}</span>
                    <span className={styles.sub}>
                      {row.count} {row.count === 1 ? "property" : "properties"}
                    </span>
                    <span className={styles.llcFigures}>
                      <span>
                        In <b className="num">{money(row.rent)}</b>
                      </span>
                      <span>
                        Out <b className="num">{money(row.expense)}</b>
                      </span>
                      <span>
                        Net{" "}
                        <b className={`num ${row.net > 0 ? styles.pos : row.net < 0 ? styles.neg : ""}`}>
                          {row.net < 0 ? "−" : ""}
                          {money(Math.abs(row.net))}
                        </b>
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className={styles.section} id="properties" aria-labelledby="board-props">
            <div className={styles.sectionHead}>
              <h2 id="board-props">Properties</h2>
              <span className={styles.sectionMeta}>
                {visibleProperties.length} {visibleProperties.length === 1 ? "property" : "properties"}
              </span>
              <span className={styles.grow} />
              {!viewOnly && (
                <button type="button" className={`${styles.btn} ${styles.small}`} onClick={() => setAdding("company")}>
                  + LLC
                </button>
              )}
              <button type="button" className={`${styles.btn} ${styles.small}`} onClick={() => setAdding("join")}>
                Join code
              </button>
              {!viewOnly && (
                <button type="button" className={`${styles.btn} ${styles.small} ${styles.primary}`} onClick={() => setAdding("property")}>
                  + Property
                </button>
              )}
            </div>
            <ul className={styles.propList}>
              {visibleProperties.map((p) => {
                const pu = unitsOf(p.id);
                const owner = companies.find((c) => c.id === p.companyId);
                const cards = LANES.flatMap((l) => board.lanes[l]).filter((c) => c.property.id === p.id);
                const late = cards.filter((c) => c.lane === "late").length;
                const vacant = cards.filter((c) => c.lane === "vacant").length;
                return (
                  <li key={p.id} className={styles.propRow}>
                    <Link href={`/dashboard/properties/${p.id}`} className={styles.propMain}>
                      <span className={styles.placeName}>{p.name}</span>
                      <span className={styles.placeAddr}>
                        {[p.address, pu.length ? `${pu.length} units` : null, selectedCompany === "all" ? owner?.name : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </Link>
                    <span className={styles.propBadges}>
                      {late > 0 && <StatusBadge status="late">{late} late</StatusBadge>}
                      {vacant > 0 && <StatusBadge status="vacant">{vacant} vacant</StatusBadge>}
                      {late === 0 && vacant === 0 && cards.some((c) => c.lane === "paid") && (
                        <StatusBadge status="paid">All paid</StatusBadge>
                      )}
                    </span>
                    <OverflowMenu
                      label={`Actions for ${p.name}`}
                      items={[
                        { label: "Open", icon: IconExternal, href: `/dashboard/properties/${p.id}` },
                        ...(viewOnly ? [] : [{ label: "Edit details", icon: IconPencil, href: `/dashboard/properties/${p.id}` }]),
                        { label: "Files", icon: IconFolder, href: `/dashboard/properties/${p.id}/files` },
                        ...(owner?.role === "owner" && !viewOnly
                          ? [{ label: "Remove property", icon: IconTrash, destructive: true, onSelect: () => removeProperty(p) }]
                          : []),
                      ]}
                    />
                  </li>
                );
              })}
            </ul>
          </section>

          <BoardLedger
            transactions={visibleTransactions}
            month={month}
            properties={visibleProperties}
            targetLabel={targetLabel}
            storageReady={storageReady}
            uploadingFor={uploadingFor}
            proofError={proofError}
            onEdit={openEdit}
            onDelete={removeTransaction}
            onAttach={(id, files) => void addProof(id, files)}
            onRemoveProof={(id) => void removeProof(id)}
          />
        </>
      )}

      <Modal
        open={adding !== ""}
        narrow
        title={adding === "property" ? "Add a property" : adding === "company" ? "Add an LLC" : "Join an LLC"}
        subtitle={adding === "join" ? "Enter the code a partner sent you from their Team page." : undefined}
        onClose={() => {
          setAdding("");
          setFormError("");
        }}
      >
        <form className={styles.form} onSubmit={submitForm} key={adding}>
          {adding === "property" && (
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
                <input name="rent" type="number" min="0" step="0.01" placeholder="0.00" />
              </label>
              <label className={styles.field}>
                <span>Owned by</span>
                <select name="company" required defaultValue={selectedCompany !== "all" ? selectedCompany : companies[0]?.id}>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {adding === "company" && (
            <label className={styles.field}>
              <span>LLC name</span>
              <input name="name" required autoFocus placeholder="e.g. Birchwood Holdings LLC" />
            </label>
          )}
          {adding === "join" && (
            <label className={styles.field}>
              <span>Join code</span>
              <input name="code" required autoFocus placeholder="K7P2-M9X4" />
            </label>
          )}
          {formError && <div className={styles.warn}>{formError}</div>}
          <div className={styles.formActions}>
            <button type="button" className={styles.btn} onClick={() => setAdding("")}>
              Cancel
            </button>
            <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={formBusy}>
              {formBusy ? "Saving…" : adding === "join" ? "Join" : "Add"}
            </button>
          </div>
        </form>
      </Modal>

      {draft && (
        <RecordEntrySheet
          key={draftSeq}
          open={recording}
          draft={draft}
          targets={targets}
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
