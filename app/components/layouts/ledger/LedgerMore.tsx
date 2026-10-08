"use client";

import { useEffect, useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { spreadSummary, spreadForReports } from "@/lib/spread";
import { monthLabel } from "@/lib/rent-month";
import Link from "next/link";
import CashFlowChart from "../../CashFlowChart";
import CategoryBars from "../../CategoryBars";
import LoanPaymentDialog from "../../LoanPaymentDialog";
import { MarkReturnedDialog } from "../../MoveOut";
import { FileActions, FileLink } from "../../FileViewer";
import type { EntryDraft } from "../../RecordEntrySheet";
import type { ConfirmRequest } from "../../ConfirmDialog";
import OverflowMenu from "../../ui/OverflowMenu";
import SegmentedControl from "../../ui/SegmentedControl";
import type { DashboardProps } from "../dashboard-props";
import { money, signedMoney } from "@/lib/money";
import { moneyTone } from "@/lib/money-tone";
import { STATUS_LABEL, ago, type RequestDTO } from "@/lib/maintenance";
import { formatDay } from "@/lib/lease";
import { byUrgency, expiryLabel, expiryState, type DocumentDTO } from "@/lib/documents";
import { isDue as loanIsDue, missedMonths, suggestPayment } from "@/lib/loans";
import type { LoanPaymentDTO } from "@/lib/loans-db";
import { returnLabel, returnState } from "@/lib/move-out";
import { recurringPrefill } from "@/lib/quick-record";
import { periodTotals, shiftMonth, type RentTarget } from "@/lib/layouts/ledger-rentroll";
import { dayLabel, monthName } from "@/lib/layouts/ledger-format";
import styles from "./ledger-dashboard.module.css";
import { useViewOnly } from "../../ViewOnly";

type P = DashboardProps;
type Txn = P["initialTransactions"][number];
type Company = P["initialCompanies"][number];
type Property = P["initialProperties"][number];
type Unit = P["initialUnits"][number];
type Recurring = P["initialRecurring"][number];
type Loan = P["initialLoans"][number];
type Deposit = P["initialDeposits"][number];
type Push = (message: string, tone?: "good" | "bad" | "plain") => void;

export type MoreTab = "cash" | "ledger" | "bills" | "portfolio";

const LEDGER_PAGE = 60;

/**
 * Everything the Classic overview has beyond this month's rent roll, one tab
 * at a time: cash flow, the ledger, bills and deadlines, and portfolio setup.
 */
export default function LedgerMore(props: {
  tab: MoreTab;
  onTab: (t: MoreTab) => void;
  month: string;
  todayKey: string;
  clock: Date;
  storageReady: boolean;
  companies: Company[];
  properties: Property[];
  units: Unit[];
  targets: RentTarget[];
  recurring: Recurring[];
  loans: Loan[];
  deposits: Deposit[];
  transactions: Txn[];
  repairs: RequestDTO[];
  expiringDocs: DocumentDTO[];
  onTransactions: Dispatch<SetStateAction<Txn[]>>;
  onCompanies: Dispatch<SetStateAction<Company[]>>;
  onProperties: Dispatch<SetStateAction<Property[]>>;
  onUnits: Dispatch<SetStateAction<Unit[]>>;
  onRecurring: Dispatch<SetStateAction<Recurring[]>>;
  onLoans: Dispatch<SetStateAction<Loan[]>>;
  onDeposits: Dispatch<SetStateAction<Deposit[]>>;
  openSheet: (d: EntryDraft) => void;
  confirm: (r: ConfirmRequest) => void;
  push: Push;
}) {
  const { tab, onTab, month, todayKey, recurring, loans, deposits, transactions, repairs, expiringDocs } = props;
  const [, monthNum] = month.split("-").map(Number);

  const dueRecurring = useMemo(() => {
    const logged = new Set(
      transactions.filter((t) => t.recurringExpenseId && t.date.startsWith(month)).map((t) => t.recurringExpenseId)
    );
    return recurring
      .filter((r) => r.active)
      .filter((r) => r.frequency === "monthly" || r.month === monthNum)
      .filter((r) => !logged.has(r.id));
  }, [recurring, transactions, month, monthNum]);

  const dueLoans = useMemo(
    () =>
      loans
        .filter((l) => loanIsDue(l, l.payments, month, l.active))
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
    [loans, month]
  );

  const docAlerts = byUrgency(
    expiringDocs.filter((d) => expiryState(d.expiresOn, todayKey) !== "ok"),
    todayKey
  );
  const depositAlerts = deposits
    .filter((d) => !d.returnedOn)
    .map((d) => ({ ...d, state: returnState(d, todayKey) }))
    .sort((a, b) => (a.returnBy ?? "9999").localeCompare(b.returnBy ?? "9999"));

  const billsCount = dueRecurring.length + dueLoans.length + depositAlerts.length + docAlerts.length + repairs.length;

  return (
    <div className={styles.more}>
      <div className={styles.moreHead}>
        <h2 className={styles.h2}>More for {monthName(month)}</h2>
        <SegmentedControl
          label="Section"
          value={tab}
          onChange={onTab}
          options={[
            { value: "cash", label: "Cash flow" },
            { value: "ledger", label: "Transactions" },
            { value: "bills", label: billsCount ? `Bills & deadlines (${billsCount})` : "Bills & deadlines" },
            { value: "portfolio", label: "Portfolio" },
          ]}
        />
      </div>

      {tab === "cash" && <CashTab {...props} />}
      {tab === "ledger" && <LedgerTab {...props} />}
      {tab === "bills" && (
        <BillsTab
          {...props}
          dueRecurring={dueRecurring}
          dueLoans={dueLoans}
          docAlerts={docAlerts}
          depositAlerts={depositAlerts}
        />
      )}
      {tab === "portfolio" && <PortfolioTab {...props} />}
    </div>
  );
}

type TabProps = Parameters<typeof LedgerMore>[0];

function placeLabel(properties: Property[], units: Unit[], t: { propertyId: string; unitId: string | null }) {
  const p = properties.find((x) => x.id === t.propertyId)?.name ?? "—";
  if (!t.unitId) return p;
  const u = units.find((x) => x.id === t.unitId);
  return u ? `${p} — ${u.name}` : p;
}

/* ---------- Cash flow ---------- */

function CashTab({ month, transactions: entries, companies, properties }: TabProps) {
  // Figures count a spread entry as its monthly shares (lib/spread).
  const transactions = useMemo(() => spreadForReports(entries), [entries]);
  const series = useMemo(() => {
    const keys = Array.from({ length: 12 }, (_, i) => shiftMonth(month, i - 11));
    const buckets = new Map(keys.map((k) => [k, { month: k, rent: 0, expense: 0 }]));
    for (const t of transactions) {
      const b = buckets.get(t.date.slice(0, 7));
      if (!b) continue;
      if (t.type === "rent") b.rent += t.amount;
      else b.expense += t.amount;
    }
    return keys.map((k) => buckets.get(k)!);
  }, [transactions, month]);

  const byCategory = useMemo(() => {
    const totals = new Map<string, number>();
    for (const t of transactions) {
      if (t.type !== "expense" || !t.date.startsWith(month)) continue;
      const key = t.category || "Other";
      totals.set(key, (totals.get(key) ?? 0) + t.amount);
    }
    return Array.from(totals, ([label, value]) => ({ label, value }));
  }, [transactions, month]);

  const perCompany = companies.map((c) => {
    const ids = new Set(properties.filter((p) => p.companyId === c.id).map((p) => p.id));
    return { company: c, count: ids.size, ...periodTotals(transactions, month, ids) };
  });

  return (
    <>
      <div className={styles.chartGrid}>
        <div className={styles.card}>
          <CashFlowChart data={series} />
        </div>
        <div className={styles.card}>
          <CategoryBars data={byCategory} caption={monthName(month)} />
        </div>
      </div>
      {companies.length > 1 && (
        <div className={styles.cardFlush}>
          <table className={`${styles.table} ${styles.simple}`}>
            <thead>
              <tr>
                <th scope="col">LLC</th>
                <th scope="col" className={styles.numCol}>Properties</th>
                <th scope="col" className={styles.numCol}>Rent in</th>
                <th scope="col" className={styles.numCol}>Expenses</th>
                <th scope="col" className={styles.numCol}>Net</th>
              </tr>
            </thead>
            <tbody>
              {perCompany.map((r) => (
                <tr key={r.company.id}>
                  <td>{r.company.name}</td>
                  <td className={styles.numCol} data-label="Properties">{r.count}</td>
                  <td className={styles.numCol} data-label="Rent in">{money(r.rent)}</td>
                  <td className={styles.numCol} data-label="Expenses">{money(r.expense)}</td>
                  <td className={`${styles.numCol} ${styles[moneyTone(r.net)]}`} data-label="Net">
                    {signedMoney(r.net)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ---------- Transactions ---------- */

function LedgerTab({ month, transactions, properties, units, openSheet, confirm, push, onTransactions }: TabProps) {
  const viewOnly = useViewOnly();
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"" | "rent" | "expense">("");
  const [propertyId, setPropertyId] = useState("");
  const [limit, setLimit] = useState(LEDGER_PAGE);
  const search = query.trim().toLowerCase();
  useEffect(() => setLimit(LEDGER_PAGE), [search, type, propertyId, month]);

  // A search looks across every month, as on Classic: the invoice you're
  // hunting for is rarely in the month on screen.
  const rows = useMemo(() => {
    return transactions
      .filter((t) => (search ? true : t.date.startsWith(month)))
      .filter((t) => !type || t.type === type)
      .filter((t) => !propertyId || t.propertyId === propertyId)
      .filter(
        (t) =>
          !search ||
          [placeLabel(properties, units, t), t.detail, t.note, t.category, t.amount.toFixed(2), dayLabel(t.date)]
            .join(" ")
            .toLowerCase()
            .includes(search)
      )
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  }, [transactions, month, search, type, propertyId, properties, units]);

  const unitsOf = (pid: string) => units.filter((u) => u.propertyId === pid);
  const keyOf = (t: Txn) => (t.unitId ? `${t.propertyId}:${t.unitId}` : unitsOf(t.propertyId).length ? `${t.propertyId}:whole` : t.propertyId);

  function edit(t: Txn) {
    openSheet({
      mode: "edit",
      editingId: t.id,
      existingProof: t.attachments.length,
      targetKey: keyOf(t),
      prefill: { type: t.type, amount: String(t.amount), date: t.date, detail: t.detail, note: t.note, category: t.category, appliesTo: t.appliesTo ?? undefined, spreadMonths: t.spreadMonths ?? undefined },
    });
  }

  function remove(t: Txn) {
    confirm({
      title: "Delete this entry?",
      body: `${t.type === "rent" ? "Rent" : "Expense"} of ${money(t.amount)} on ${dayLabel(t.date)} for ${placeLabel(
        properties,
        units,
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
        onTransactions((prev) => prev.filter((x) => x.id !== t.id));
        push("Entry deleted.");
      },
    });
  }

  const shown = rows.slice(0, limit);
  const totals = periodTotals(rows, "");

  return (
    <div className={styles.cardFlush}>
      <div className={styles.filters}>
        <input
          type="search"
          className={styles.input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search every entry…"
          aria-label="Search the ledger"
        />
        <select className={styles.input} value={propertyId} onChange={(e) => setPropertyId(e.target.value)} aria-label="Filter by property">
          <option value="">All properties</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          className={styles.input}
          value={type}
          onChange={(e) => setType(e.target.value as "" | "rent" | "expense")}
          aria-label="Filter by type"
        >
          <option value="">All types</option>
          <option value="rent">Rent only</option>
          <option value="expense">Expenses only</option>
        </select>
      </div>
      <div className={styles.ledgerSummary}>
        {rows.length} {rows.length === 1 ? "entry" : "entries"}
        {search ? ` matching “${query.trim()}” across all time` : ` in ${monthName(month)}`} · {money(totals.rent)} in ·{" "}
        {money(totals.expense)} out
      </div>
      {rows.length === 0 ? (
        <p className={styles.empty}>
          {search ? `Nothing matches “${query.trim()}”.` : `Nothing recorded in ${monthName(month)} yet.`}
        </p>
      ) : (
        <table className={`${styles.table} ${styles.simple}`}>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Property</th>
              <th scope="col">Details</th>
              <th scope="col" className={styles.numCol}>Amount</th>
              {!viewOnly && (
                <th scope="col" className={styles.actCol}>
                  <span className={styles.srOnly}>Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => (
              <tr key={t.id}>
                <td className={styles.nowrap} data-label="Date">{dayLabel(t.date)}</td>
                <td data-label="Property">{placeLabel(properties, units, t)}</td>
                <td data-label="Details">
                  <span className={`${styles.tag} ${t.type === "rent" ? styles.tagRent : ""}`}>
                    {t.type === "rent" ? "Rent" : t.category || "Expense"}
                  </span>{" "}
                  {t.detail}
                  {t.note && <span className={styles.subLine}>{t.note}</span>}
                  {t.spreadMonths && t.spreadMonths > 1 ? (
                    <span className={styles.subLine}>{spreadSummary(t)}</span>
                  ) : (
                    t.appliesTo && <span className={styles.subLine}>Counts toward {monthLabel(t.appliesTo)}</span>
                  )}
                  {t.attachments.length > 0 && (
                    <span className={styles.proofs}>
                      {t.attachments.map((a) => (
                        <FileLink key={a.id} url={a.url} name={a.filename} mime={a.contentType} className={styles.proof} title={a.filename}>
                          {a.filename}
                        </FileLink>
                      ))}
                    </span>
                  )}
                </td>
                <td className={`${styles.numCol} ${t.type === "rent" ? styles.pos : ""}`} data-label="Amount">
                  {t.type === "rent" ? "+" : "−"}
                  {money(t.amount)}
                </td>
                {!viewOnly && (
                  <td className={styles.actCol}>
                    <div className={styles.actions}>
                      <button type="button" className={`${styles.rowAction} ${styles.rowActionQuiet}`} onClick={() => edit(t)}>
                        Edit
                      </button>
                      <OverflowMenu
                        label={`More for the ${dayLabel(t.date)} entry`}
                        items={[
                          { label: "Edit or add proof", onSelect: () => edit(t) },
                          { label: "Delete entry", destructive: true, onSelect: () => remove(t) },
                        ]}
                      />
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rows.length > shown.length && (
        <div className={styles.moreRow}>
          <button type="button" className={styles.btn} onClick={() => setLimit((n) => n + LEDGER_PAGE)}>
            Show {Math.min(rows.length - shown.length, LEDGER_PAGE)} more
          </button>
          <span className={styles.muted}>
            {shown.length} of {rows.length}
          </span>
        </div>
      )}
    </div>
  );
}

/* ---------- Bills & deadlines ---------- */

type DueLoan = {
  loan: Loan;
  missed: string[];
  interest: number;
  principal: number;
  escrow: number;
  total: number;
};

function BillsTab(
  props: TabProps & {
    dueRecurring: Recurring[];
    dueLoans: DueLoan[];
    docAlerts: DocumentDTO[];
    depositAlerts: (Deposit & { state: ReturnType<typeof returnState> })[];
  }
) {
  const viewOnly = useViewOnly();
  const {
    month,
    todayKey,
    clock,
    properties,
    units,
    repairs,
    dueRecurring,
    dueLoans,
    docAlerts,
    depositAlerts,
    openSheet,
    confirm,
    push,
    onTransactions,
    onLoans,
    onDeposits,
  } = props;
  const [payingLoanId, setPayingLoanId] = useState("");
  const [returningId, setReturningId] = useState("");
  const [busy, setBusy] = useState(false);
  const unitsOf = (pid: string) => units.filter((u) => u.propertyId === pid);
  const keyOf = (pid: string, uid: string | null) =>
    uid ? `${pid}:${uid}` : unitsOf(pid).length ? `${pid}:whole` : pid;

  function logRecurring(r: Recurring) {
    openSheet({
      mode: "quick",
      targetKey: keyOf(r.propertyId, r.unitId),
      prefill: recurringPrefill(r, month),
      recurring: { id: r.id, month },
      context: `${r.category}${r.detail ? ` · ${r.detail}` : ""} · ${monthName(month)} ${
        r.frequency === "monthly" ? "monthly" : "yearly"
      } bill`,
    });
  }

  function addPayment(loanId: string, payment: LoanPaymentDTO, entries: unknown[]) {
    onLoans((prev) =>
      prev.map((l) =>
        l.id === loanId ? { ...l, payments: [...l.payments, payment].sort((a, b) => a.month.localeCompare(b.month)) } : l
      )
    );
    onTransactions((prev) => [...prev, ...(entries as Txn[]).map((t) => ({ ...t, attachments: [] }))]);
  }

  function logAll() {
    const count = dueRecurring.length + dueLoans.length;
    if (count === 0) return;
    const total = dueRecurring.reduce((s, r) => s + r.amount, 0) + dueLoans.reduce((s, l) => s + l.total, 0);
    confirm({
      title: `Log ${money(total)} of bills?`,
      body: `Adds ${count} ${count === 1 ? "bill" : "bills"} for ${monthName(month)} at the amounts below.${
        dueLoans.length ? " Mortgage principal comes off the loan rather than going in as an expense." : ""
      }`,
      lines: [
        ...dueRecurring.map((r) => ({ label: `${r.category}${r.detail ? ` · ${r.detail}` : ""}`, amount: money(r.amount) })),
        ...dueLoans.map((l) => ({ label: l.loan.lender, amount: money(l.total) })),
      ],
      confirmLabel: `Log ${count} bills`,
      onConfirm: async () => {
        setBusy(true);
        let failed = 0;
        for (const l of dueLoans) {
          const res = await fetch(`/api/loans/${l.loan.id}/payments`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ month }),
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok) addPayment(l.loan.id, data.payment, data.transactions);
          else failed += 1;
        }
        for (const r of dueRecurring) {
          const res = await fetch(`/api/recurring/${r.id}/log`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ month }),
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok) onTransactions((prev) => [...prev, { ...data, attachments: [] }]);
          else failed += 1;
        }
        setBusy(false);
        if (failed > 0) push(`${failed} of ${count} bills didn't log.`, "bad");
        else push(`${money(total)} of bills logged for ${monthName(month, false)}.`);
      },
    });
  }

  const nothing =
    dueRecurring.length + dueLoans.length + depositAlerts.length + docAlerts.length + repairs.length === 0;
  const payingLoan = props.loans.find((l) => l.id === payingLoanId);
  const returning = depositAlerts.find((d) => d.id === returningId) ?? null;

  return (
    <div className={styles.cardFlush}>
      {nothing && <p className={styles.empty}>Every bill is logged, no deposit is owed back, no paperwork is running out and no repair is open.</p>}

      {dueRecurring.length + dueLoans.length > 0 && (
        <div className={styles.listBlock}>
          <div className={styles.listHead}>
            <h3 className={styles.h3}>Bills due in {monthName(month, false)}</h3>
            {dueRecurring.length + dueLoans.length > 1 && !viewOnly && (
              <button type="button" className={`${styles.btn} ${styles.small}`} disabled={busy} onClick={logAll}>
                {busy ? "Logging…" : `Log all ${dueRecurring.length + dueLoans.length}`}
              </button>
            )}
          </div>
          {dueRecurring.map((r) => (
            <div key={r.id} className={styles.listRow}>
              <div className={styles.listMain}>
                <span className={styles.listTitle}>{placeLabel(properties, units, r)}</span>
                <span className={styles.listSub}>
                  {r.category}
                  {r.detail ? ` · ${r.detail}` : ""} · {r.frequency === "monthly" ? "Monthly" : "Yearly"} bill, not logged yet
                </span>
              </div>
              <span className={styles.listAmt}>{money(r.amount)}</span>
              {!viewOnly && (
                <button type="button" className={styles.rowAction} onClick={() => logRecurring(r)}>
                  Log it
                </button>
              )}
            </div>
          ))}
          {dueLoans.map(({ loan, missed, interest, principal, escrow, total }) => (
            <div key={loan.id} className={styles.listRow}>
              <div className={styles.listMain}>
                <span className={styles.listTitle}>
                  {placeLabel(properties, units, { propertyId: loan.propertyId, unitId: null })} · Mortgage
                </span>
                <span className={styles.listSub}>
                  {loan.lender}: {money(interest)} interest{escrow > 0 ? ` · ${money(escrow)} escrow` : ""} ·{" "}
                  {money(principal)} principal
                  {missed.length > 0 &&
                    ` · ${missed.length === 1 ? monthName(missed[0], false) : `${missed.length} earlier months`} not recorded yet`}
                </span>
              </div>
              <span className={styles.listAmt}>{money(total)}</span>
              {!viewOnly && (
                <button type="button" className={styles.rowAction} onClick={() => setPayingLoanId(loan.id)}>
                  Log it
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {depositAlerts.length > 0 && (
        <div className={styles.listBlock}>
          <div className={styles.listHead}>
            <h3 className={styles.h3}>Deposits to return</h3>
          </div>
          {depositAlerts.map((d) => (
            <div key={d.id} className={styles.listRow}>
              <div className={styles.listMain}>
                <span className={styles.listTitle}>
                  {d.tenantName}&apos;s deposit{" "}
                  <span className={`${styles.status} ${d.state.kind === "overdue" ? styles.s_late : styles.s_partial}`}>
                    <span className={styles.statusDot} aria-hidden="true" />
                    {returnLabel(d.state)}
                  </span>
                </span>
                <span className={styles.listSub}>
                  {placeLabel(properties, units, { propertyId: d.propertyId, unitId: null })} · moved out{" "}
                  {formatDay(d.movedOutOn)}
                  {d.returnBy ? ` · return by ${formatDay(d.returnBy)}` : ""}
                </span>
              </div>
              <span className={styles.listAmt}>{money(d.refund)}</span>
              <div className={styles.actions}>
                <Link className={`${styles.rowAction} ${styles.rowActionQuiet}`} href={`/dashboard/move-outs/${d.id}`}>
                  Statement
                </Link>
                {!viewOnly && (
                  <button type="button" className={styles.rowAction} onClick={() => setReturningId(d.id)}>
                    Mark sent
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {docAlerts.length > 0 && (
        <div className={styles.listBlock}>
          <div className={styles.listHead}>
            <h3 className={styles.h3}>Paperwork running out</h3>
          </div>
          {docAlerts.map((d) => (
            <div key={d.id} className={styles.listRow}>
              <div className={styles.listMain}>
                <span className={styles.listTitle}>
                  {d.title}{" "}
                  <span className={`${styles.status} ${expiryState(d.expiresOn, todayKey) === "expired" ? styles.s_late : styles.s_partial}`}>
                    <span className={styles.statusDot} aria-hidden="true" />
                    {expiryLabel(d.expiresOn, todayKey, formatDay)}
                  </span>
                </span>
                <span className={styles.listSub}>
                  {d.kind} · {d.ownerLabel}
                </span>
              </div>
              <div className={styles.actions}>
                <FileActions url={d.url} name={d.filename || d.title} mime={d.contentType} />
                {!viewOnly && (
                  <Link
                    className={styles.rowAction}
                    href={d.vendorId ? "/dashboard/repairs/vendors" : d.propertyId ? `/dashboard/properties/${d.propertyId}` : "/dashboard/files"}
                  >
                    Replace
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {repairs.length > 0 && (
        <div className={styles.listBlock}>
          <div className={styles.listHead}>
            <h3 className={styles.h3}>Open repairs</h3>
            <Link className={styles.linkBtn} href="/dashboard/repairs">
              All repairs
            </Link>
          </div>
          {repairs.map((r) => (
            <div key={r.id} className={styles.listRow}>
              <div className={styles.listMain}>
                <span className={styles.listTitle}>
                  {r.title}{" "}
                  <span className={`${styles.status} ${r.urgency === "urgent" ? styles.s_late : styles.s_partial}`}>
                    <span className={styles.statusDot} aria-hidden="true" />
                    {r.urgency === "urgent" ? "Urgent" : STATUS_LABEL[r.status].landlord}
                  </span>
                </span>
                <span className={styles.listSub}>
                  {[r.propertyName, r.unitName].filter(Boolean).join(" — ")} · {r.tenantName || "a tenant"} ·{" "}
                  {ago(r.createdAt, clock)}
                </span>
              </div>
              <Link className={styles.rowAction} href="/dashboard/repairs">
                {viewOnly ? "Open" : "Work it"}
              </Link>
            </div>
          ))}
        </div>
      )}

      {payingLoan && (
        <LoanPaymentDialog
          loan={payingLoan}
          month={month}
          today={todayKey}
          focusAmount
          onClose={() => setPayingLoanId("")}
          onRecorded={(payment, entries) => {
            addPayment(payingLoan.id, payment, entries);
            setPayingLoanId("");
            push(
              `Logged: ${money(payment.interest)} interest${payment.escrow > 0 ? `, ${money(payment.escrow)} escrow` : ""}, ${money(payment.principal)} off the loan.`
            );
          }}
        />
      )}
      <MarkReturnedDialog
        moveOut={returning}
        tenantName={returning?.tenantName ?? ""}
        today={todayKey}
        onClose={() => setReturningId("")}
        onDone={(m) => {
          onDeposits((prev) => prev.map((d) => (d.id === m.id ? { ...d, ...m } : d)));
          setReturningId("");
          push("Deposit marked returned.");
        }}
      />
    </div>
  );
}

/* ---------- Portfolio ---------- */

function PortfolioTab({ companies, properties, transactions, confirm, push, onCompanies, onProperties, onTransactions, onUnits, onRecurring }: TabProps) {
  const viewOnly = useViewOnly();
  const [llcName, setLlcName] = useState("");
  const [code, setCode] = useState("");
  const [joinBusy, setJoinBusy] = useState(false);
  const [prop, setProp] = useState({ name: "", address: "", rent: "", companyId: companies[0]?.id ?? "" });
  const [error, setError] = useState("");

  async function addCompany(e: FormEvent) {
    e.preventDefault();
    const name = llcName.trim();
    if (!name) return;
    setError("");
    const res = await fetch("/api/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data?.error || "Couldn't add that LLC.");
    onCompanies((prev) => [...prev, data]);
    setProp((p) => ({ ...p, companyId: p.companyId || data.id }));
    setLlcName("");
    push(`${data.name} added.`);
  }

  async function join(e: FormEvent) {
    e.preventDefault();
    const c = code.trim();
    if (!c) return;
    setError("");
    setJoinBusy(true);
    const res = await fetch("/api/invites/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: c }),
    });
    const data = await res.json().catch(() => ({}));
    setJoinBusy(false);
    if (!res.ok) return setError(data?.error || "Couldn't join with that code.");
    window.location.href = "/dashboard";
  }

  async function addProperty(e: FormEvent) {
    e.preventDefault();
    const name = prop.name.trim();
    if (!name || !prop.companyId) return;
    setError("");
    const res = await fetch("/api/properties", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        address: prop.address.trim(),
        monthlyRent: parseFloat(prop.rent) || 0,
        companyId: prop.companyId,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data?.error || "Couldn't add that property.");
    onProperties((prev) => [...prev, data]);
    setProp((p) => ({ ...p, name: "", address: "", rent: "" }));
    push(`${data.name} added.`);
  }

  function removeProperty(p: Property) {
    const count = transactions.filter((t) => t.propertyId === p.id).length;
    confirm({
      title: `Remove ${p.name}?`,
      body: count
        ? `This property has ${count} ledger ${count === 1 ? "entry" : "entries"}. Removing it deletes those entries, its units and its recurring expenses too. This can't be undone.`
        : "Its units and recurring expenses go with it. This can't be undone.",
      confirmLabel: "Remove property",
      danger: true,
      onConfirm: async () => {
        const res = await fetch(`/api/properties/${p.id}`, { method: "DELETE" });
        if (!res.ok) return push("Couldn't remove that property.", "bad");
        onProperties((prev) => prev.filter((x) => x.id !== p.id));
        onTransactions((prev) => prev.filter((t) => t.propertyId !== p.id));
        onUnits((prev) => prev.filter((u) => u.propertyId !== p.id));
        onRecurring((prev) => prev.filter((r) => r.propertyId !== p.id));
        push(`${p.name} removed.`);
      },
    });
  }

  return (
    <div className={styles.portfolio}>
      {error && (
        <p className={styles.errorBar} role="alert">
          {error}
        </p>
      )}
      <div className={styles.formGrid}>
        {!viewOnly && <form className={styles.card} onSubmit={addProperty}>
          <h3 className={styles.h3}>Add a property</h3>
          <label className={styles.field}>
            <span>Property name</span>
            <input className={styles.input} required value={prop.name} placeholder="e.g. Birchwood Ave" onChange={(e) => setProp({ ...prop, name: e.target.value })} />
          </label>
          <label className={styles.field}>
            <span>Address</span>
            <input className={styles.input} value={prop.address} placeholder="142 Birchwood Ave" onChange={(e) => setProp({ ...prop, address: e.target.value })} />
          </label>
          <div className={styles.fieldPair}>
            <label className={styles.field}>
              <span>Monthly rent ($)</span>
              <input className={styles.input} type="number" min="0" step="0.01" inputMode="decimal" value={prop.rent} placeholder="0.00" onChange={(e) => setProp({ ...prop, rent: e.target.value })} />
            </label>
            <label className={styles.field}>
              <span>Owned by</span>
              <select className={styles.input} required value={prop.companyId} onChange={(e) => setProp({ ...prop, companyId: e.target.value })}>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={!companies.length}>
            Add property
          </button>
        </form>}

        <div className={styles.stack}>
          {!viewOnly && (
            <form className={styles.card} onSubmit={addCompany}>
              <h3 className={styles.h3}>Add an LLC</h3>
              <div className={styles.inline}>
                <input className={styles.input} value={llcName} placeholder="e.g. Birchwood Holdings LLC" aria-label="LLC name" onChange={(e) => setLlcName(e.target.value)} />
                <button type="submit" className={styles.btn}>
                  Add
                </button>
              </div>
            </form>
          )}
          <form className={styles.card} onSubmit={join}>
            <h3 className={styles.h3}>Join an LLC with a code</h3>
            <div className={styles.inline}>
              <input className={styles.input} value={code} placeholder="K7P2-M9X4" aria-label="Join code" onChange={(e) => setCode(e.target.value)} />
              <button type="submit" className={styles.btn} disabled={joinBusy}>
                {joinBusy ? "Joining…" : "Join"}
              </button>
            </div>
          </form>
        </div>
      </div>

      {properties.length > 0 && (
        <div className={styles.cardFlush}>
          <table className={`${styles.table} ${styles.simple}`}>
            <thead>
              <tr>
                <th scope="col">Property</th>
                <th scope="col">LLC</th>
                <th scope="col" className={styles.actCol}>
                  <span className={styles.srOnly}>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {properties.map((p) => {
                const owner = companies.find((c) => c.id === p.companyId);
                return (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/dashboard/properties/${p.id}`} className={styles.place}>
                        {p.name}
                      </Link>
                      {p.address && <span className={styles.subLine}>{p.address}</span>}
                    </td>
                    <td data-label="LLC">{owner?.name ?? "—"}</td>
                    <td className={styles.actCol}>
                      <div className={styles.actions}>
                        <Link className={`${styles.rowAction} ${styles.rowActionQuiet}`} href={`/dashboard/properties/${p.id}`}>
                          Open
                        </Link>
                        {owner?.role === "owner" && !viewOnly && (
                          <OverflowMenu
                            label={`More for ${p.name}`}
                            items={[{ label: "Remove property", destructive: true, onSelect: () => removeProperty(p) }]}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
