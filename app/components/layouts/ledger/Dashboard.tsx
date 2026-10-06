"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "../../AppShell";
import RecordEntrySheet, { type EntryDraft, type SavedEntry } from "../../RecordEntrySheet";
import ConfirmDialog, { type ConfirmRequest } from "../../ConfirmDialog";
import OverflowMenu, { type MenuItem } from "../../ui/OverflowMenu";
import { Toasts, useToasts } from "../../Toasts";
import { useLivePulse } from "../../useLivePulse";
import { useNow } from "../../useNow";
import { IconAlert, IconChevronLeft, IconChevronRight, IconPlus, IconX } from "../../icons";
import type { DashboardProps } from "../dashboard-props";
import { money, moneyRound, signedMoney } from "@/lib/money";
import { moneyTone } from "@/lib/money-tone";
import { chasedRecently, remindedAgo } from "@/lib/notices";
import { dateFromISO, isoDay, smsHref, telHref } from "@/lib/lease";
import { bulkSummary, owedLine, rentPrefill } from "@/lib/quick-record";
import {
  collectionOf,
  groupByCompany,
  matchesFilter,
  monthRange,
  occupancy,
  periodTotals,
  rentIndex,
  rentRollRows,
  rowCounts,
  buildTargets,
  type RentRow,
  type RowFilter,
  type RowStatus,
} from "@/lib/layouts/ledger-rentroll";
import { monthName } from "@/lib/layouts/ledger-format";
import LedgerMore, { type MoreTab } from "./LedgerMore";
import styles from "./ledger-dashboard.module.css";

type Txn = DashboardProps["initialTransactions"][number];
type Tenant = DashboardProps["initialTenants"][number];
type Row = RentRow<Tenant>;

const STATUS_TEXT: Record<RowStatus, string> = {
  paid: "Paid",
  partial: "Partial",
  late: "Late",
  due: "Due",
  vacant: "Vacant",
  ended: "Lease ended",
  norent: "No rent set",
};

/** Today if we're looking at the current month, otherwise the 1st of the one on screen. */
function defaultDateFor(month: string, today: string) {
  return today.startsWith(month) ? today : `${month}-01`;
}

/**
 * The Ledger layout's Overview (Mercury-like): one big collected number for
 * the month, an amber strip of what needs a look, then one table of every
 * rentable place grouped by LLC. Charts, the ledger, bills and deadlines, and
 * portfolio setup sit in tabs beneath it. Every figure comes from the same
 * rules as the Classic overview (lib/layouts/ledger-rentroll.ts), and every
 * action goes through the same sheets and endpoints.
 */
export default function LedgerDashboard(props: DashboardProps) {
  const {
    openRepairs,
    initialRepairs,
    expiringDocs,
    initialChases,
    lateFees = {},
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

  const router = useRouter();
  // Server date first so the first client render matches the HTML; the real
  // local date straight after.
  const [todayKey, setTodayKey] = useState(serverToday);
  useEffect(() => {
    const local = isoDay(new Date());
    if (local !== serverToday) setTodayKey(local);
  }, [serverToday]);
  const now = useMemo(() => dateFromISO(todayKey), [todayKey]);
  const clock = useNow(serverNow);
  const thisMonth = todayKey.slice(0, 7);

  // Repairs and the nav count come from the server; re-render on a change.
  useLivePulse("/api/requests/pulse", () => router.refresh());

  const [companies, setCompanies] = useState(initialCompanies);
  const [properties, setProperties] = useState(initialProperties);
  const [units, setUnits] = useState(initialUnits);
  const [recurring, setRecurring] = useState(initialRecurring);
  const [loans, setLoans] = useState(initialLoans);
  const [deposits, setDeposits] = useState(initialDeposits);
  const [transactions, setTransactions] = useState<Txn[]>(initialTransactions);
  const rentChanges = initialRentChanges;
  const tenants = initialTenants;

  const [month, setMonth] = useState(serverToday.slice(0, 7));
  const [filter, setFilter] = useState<RowFilter>("all");
  const [moreTab, setMoreTab] = useState<MoreTab>("cash");

  const [recording, setRecording] = useState(false);
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const [draftSeq, setDraftSeq] = useState(0);
  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [chases, setChases] = useState(initialChases);
  const [chasing, setChasing] = useState("");
  const { toasts, push, dismiss } = useToasts();

  const tableRef = useRef<HTMLElement>(null);
  const moreRef = useRef<HTMLElement>(null);

  const months = useMemo(() => monthRange(transactions, thisMonth), [transactions, thisMonth]);
  const monthIndex = months.indexOf(month);

  const index = useMemo(() => rentIndex(transactions), [transactions]);
  const targets = useMemo(() => buildTargets(properties, units), [properties, units]);

  const rows: Row[] = useMemo(
    () =>
      rentRollRows({
        properties,
        units,
        tenants,
        transactions,
        rentChanges,
        lateFees,
        month,
        now,
        index,
      }),
    [properties, units, tenants, transactions, rentChanges, lateFees, month, now, index]
  );

  const collection = useMemo(() => collectionOf(rows), [rows]);
  const counts = useMemo(() => rowCounts(rows), [rows]);
  const totals = useMemo(() => periodTotals(transactions, month), [transactions, month]);
  const occ = useMemo(() => occupancy(properties, units), [properties, units]);
  const pct = collection.expected > 0 ? Math.min(100, Math.round((collection.collected / collection.expected) * 100)) : 0;
  const expiredLeases = rows.filter((r) => r.lease === "expired").length;
  const endingLeases = rows.filter((r) => r.lease === "ending").length;

  const shown = rows.filter((r) => matchesFilter(r, filter));
  const groups = groupByCompany(shown, companies);
  // Group headers always show the whole LLC's month, not just the filtered rows.
  const groupTotals = useMemo(
    () => new Map(groupByCompany(rows, companies).map((g) => [g.company.id, g])),
    [rows, companies]
  );
  const owedShown = shown.filter((r) => r.balance > 0.005);

  // The bills-and-deadlines count, for the strip's second link.
  const [, monthNum] = month.split("-").map(Number);
  const billsDue = useMemo(() => {
    const logged = new Set(
      transactions.filter((t) => t.recurringExpenseId && t.date.startsWith(month)).map((t) => t.recurringExpenseId)
    );
    return recurring.filter(
      (r) => r.active && (r.frequency === "monthly" || r.month === monthNum) && !logged.has(r.id)
    ).length;
  }, [recurring, transactions, month, monthNum]);

  function propertyHref(r: Row) {
    return r.tenant
      ? `/dashboard/properties/${r.target.propertyId}#tenant-${r.tenant.id}`
      : `/dashboard/properties/${r.target.propertyId}`;
  }

  /* ---------- The record sheet, opened exactly as Classic opens it ---------- */

  function showSheet(next: EntryDraft) {
    setDraft(next);
    setDraftSeq((n) => n + 1);
    setRecording(true);
  }

  /** "Record payment": a blank rent entry, dated in the month on screen. */
  function openRecord() {
    showSheet({
      mode: "new",
      targetKey: targets[0]?.key ?? "",
      prefill: {
        type: "rent",
        amount: "",
        date: defaultDateFor(month, todayKey),
        detail: "",
        note: "",
        category: "",
      },
    });
  }

  /** A row's "Record": the rent form filled with what's owed, as Classic's Mark paid. */
  function quickRent(r: Row) {
    showSheet({
      mode: "quick",
      targetKey: r.target.key,
      prefill: rentPrefill({
        month,
        today: todayKey,
        expected: r.due,
        paid: r.paid,
        fees: r.fees,
        tenantName: r.tenant?.name,
      }),
      context: `${r.tenant ? `${r.tenant.name} · ` : ""}${monthName(month)} · ${owedLine({
        expected: r.due,
        paid: r.paid,
        fees: r.fees,
      })}`,
    });
  }

  function entrySaved({ entry, created, waive }: { entry: SavedEntry; created: boolean; waive: boolean | null }) {
    setTransactions((prev) =>
      prev.some((t) => t.id === entry.id)
        ? prev.map((t) => (t.id === entry.id ? { ...t, ...entry, attachments: t.attachments } : t))
        : [...prev, { ...entry, attachments: [] }]
    );
    const where = targets.find((t) => t.propertyId === entry.propertyId && t.unitId === entry.unitId)?.label ?? "";
    const waived = waive === null ? "" : waive ? " Late fee waived for the month." : " Late fees apply again from today.";
    push(
      created
        ? entry.recurringExpenseId
          ? `${money(entry.amount)} ${entry.category || "bill"} logged${where ? ` for ${where}` : ""}.`
          : `${entry.type === "rent" ? "Rent" : "Expense"} of ${money(entry.amount)} recorded${
              entry.type === "rent" && entry.detail ? ` for ${entry.detail}` : where ? ` for ${where}` : ""
            }.${waived}`
        : `Entry updated — ${money(entry.amount)}.${waived}`
    );
    if (waive !== null) router.refresh();
  }

  function proofLanded(entryId: string, proof: { id: string; transactionId: string; url: string; filename: string; contentType: string }) {
    setTransactions((prev) =>
      prev.map((t) => (t.id === entryId ? { ...t, attachments: [...(t.attachments ?? []), proof] } : t))
    );
  }

  /* ---------- Reminders and the bulk record, as on Classic ---------- */

  async function remind(r: Row) {
    const tenant = r.tenant;
    if (!tenant) return;
    setChasing(tenant.id);
    const res = await fetch(`/api/tenants/${tenant.id}/notices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "rent", month, expected: r.due, paid: r.paid }),
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

  function recordAll(list: Row[]) {
    if (list.length === 0) return;
    const summary = bulkSummary(list.map((r) => ({ name: r.tenant?.name ?? r.target.label, owed: r.balance })));
    setConfirming({
      title: `Record ${money(summary.total)} of rent?`,
      body: `One entry per tenant, dated in ${monthName(month)}, for the full amount each still owes. To change an amount, add proof or waive a fee, use that row's Record instead.`,
      lines: summary.lines.map((l) => ({ label: l.name, amount: money(l.owed) })),
      confirmLabel: `Record ${list.length} payments`,
      onConfirm: async () => {
        setBulkBusy(true);
        let done = 0;
        let failed = 0;
        for (const r of list) {
          const res = await fetch("/api/transactions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              propertyId: r.target.propertyId,
              unitId: r.target.unitId,
              type: "rent",
              date: defaultDateFor(month, todayKey),
              amount: r.balance,
              detail: r.tenant?.name ?? "",
              note: `${monthName(month)} rent`,
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok) {
            done += 1;
            setTransactions((prev) => [...prev, { ...data, attachments: [] }]);
          } else failed += 1;
        }
        setBulkBusy(false);
        if (failed > 0) push(`Recorded ${done}; ${failed} didn't save. Check the ledger.`, "bad");
        else push(`${money(summary.total)} recorded across ${done} ${done === 1 ? "tenant" : "tenants"}.`);
      },
    });
  }

  function review() {
    setFilter("review");
    tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function toBills() {
    setMoreTab("bills");
    moreRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ---------- Row pieces ---------- */

  function primaryAction(r: Row) {
    if (r.balance > 0.005) {
      return (
        <button type="button" className={styles.rowAction} onClick={() => quickRent(r)}>
          Record
        </button>
      );
    }
    if (r.status === "vacant") {
      return (
        <Link className={styles.rowAction} href={`/dashboard/properties/${r.target.propertyId}`}>
          Add tenant
        </Link>
      );
    }
    if (r.lease === "expired" || r.lease === "ending") {
      return (
        <Link className={styles.rowAction} href={propertyHref(r)}>
          Renew
        </Link>
      );
    }
    return (
      <Link className={`${styles.rowAction} ${styles.rowActionQuiet}`} href={propertyHref(r)}>
        View
      </Link>
    );
  }

  function rowMenu(r: Row): MenuItem[] {
    const items: MenuItem[] = [];
    const t = r.tenant;
    if (r.balance > 0.005 && t) {
      const chase = chases[t.id];
      const recent = chase?.month === month && chasedRecently(chase.at);
      items.push({
        label: chasing === t.id ? "Sending…" : recent ? `Reminded ${remindedAgo(chase.at, clock)}` : "Send a reminder",
        disabled: chasing === t.id,
        onSelect: () => void remind(r),
      });
    }
    if (t?.phone) {
      items.push({ label: `Call ${t.name}`, href: telHref(t.phone) });
      items.push({ label: `Text ${t.name}`, href: smsHref(t.phone) });
    }
    if (r.status !== "vacant" && r.balance <= 0.005) {
      items.push({ label: "Record a payment", onSelect: () => quickRent(r) });
    }
    items.push({ label: "Open property", href: propertyHref(r) });
    return items;
  }

  const stop = (e: MouseEvent) => e.stopPropagation();

  const pills: { key: RowFilter; label: string; n: number }[] = [
    { key: "all", label: "All", n: counts.all },
    { key: "late", label: "Late", n: counts.late },
    { key: "vacant", label: "Vacant", n: counts.vacant },
    { key: "paid", label: "Paid", n: counts.paid },
  ];

  const strip: string[] = [];
  if (counts.late) strip.push(`${counts.late} late`);
  if (counts.owed) strip.push(`${counts.owed} unpaid`);
  if (counts.vacant) strip.push(`${counts.vacant} vacant`);
  if (endingLeases) strip.push(`${endingLeases} ${endingLeases === 1 ? "lease" : "leases"} ending`);
  if (expiredLeases) strip.push(`${expiredLeases} ${expiredLeases === 1 ? "lease" : "leases"} ended`);

  const hasData = companies.length > 0;

  return (
    <AppShell title="Overview" userLabel={userLabel} openRepairs={openRepairs}>
      {!hasData ? (
        <section className={styles.card}>
          <h2 className={styles.h2}>Start with an LLC</h2>
          <p className={styles.muted}>
            Properties live under the company that owns them. Add your first LLC below, then its properties.
          </p>
        </section>
      ) : (
        <>
          {/* ---------- Hero ---------- */}
          <section className={styles.hero} aria-label={`${monthName(month)} rent`}>
            <div className={styles.heroTop}>
              <div className={styles.monthSwitch} role="group" aria-label="Month">
                <button
                  type="button"
                  className={styles.monthArrow}
                  aria-label="Previous month"
                  disabled={monthIndex <= 0}
                  onClick={() => setMonth(months[monthIndex - 1])}
                >
                  <IconChevronLeft size={18} />
                </button>
                <span className={styles.monthLabel}>{monthName(month)}</span>
                <button
                  type="button"
                  className={styles.monthArrow}
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
              <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={openRecord}>
                <IconPlus size={16} /> Record payment
              </button>
            </div>

            <div className={styles.heroBody}>
              <div className={styles.heroMain}>
                <div className={styles.heroLabel}>Rent collected</div>
                <div className={styles.heroFigure}>
                  <span className={styles.heroBig}>{moneyRound(collection.collected)}</span>
                  <span className={styles.heroOf}>of {moneyRound(collection.expected)} collected</span>
                </div>
                <div
                  className={styles.progress}
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={pct}
                  aria-label={`${pct}% of ${monthName(month)} rent collected`}
                >
                  <span
                    className={collection.expected > 0 && collection.collected >= collection.expected ? styles.progressDone : undefined}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className={styles.heroCounts}>
                  <span>
                    <span className={`${styles.dot} ${styles.dotPaid}`} />
                    {collection.paidCount} of {collection.dueCount} paid in full
                  </span>
                  <span>
                    <span className={`${styles.dot} ${styles.dotLate}`} />
                    {counts.late} late
                  </span>
                  <span>
                    <span className={`${styles.dot} ${styles.dotVacant}`} />
                    {counts.vacant} vacant
                  </span>
                  <span className={styles.heroPct}>
                    {pct}% · {moneyRound(collection.outstanding)} outstanding
                  </span>
                </div>
              </div>

              <dl className={styles.heroStats}>
                <div>
                  <dt>Net</dt>
                  <dd className={styles[moneyTone(totals.net)]}>{signedMoney(Math.round(totals.net))}</dd>
                </div>
                <div>
                  <dt>Expenses</dt>
                  <dd>{moneyRound(totals.expense)}</dd>
                </div>
                <div>
                  <dt>Occupancy</dt>
                  <dd>
                    {occ.pct}%<span className={styles.statSub}>
                      {occ.occupied} of {occ.total} units
                    </span>
                  </dd>
                </div>
              </dl>
            </div>
          </section>

          {/* ---------- Amber strip ---------- */}
          {(strip.length > 0 || billsDue > 0) && (
            <section className={styles.alert} aria-label="Needs attention">
              <IconAlert size={18} className={styles.alertIcon} />
              <p className={styles.alertText}>
                {strip.join(" · ")}
                {billsDue > 0 && (
                  <>
                    {strip.length > 0 ? " · " : ""}
                    <button type="button" className={styles.alertLink} onClick={toBills}>
                      {billsDue} {billsDue === 1 ? "bill" : "bills"} to log
                    </button>
                  </>
                )}
              </p>
              {counts.review > 0 && (
                <button type="button" className={styles.alertBtn} onClick={review}>
                  Review {counts.review} {counts.review === 1 ? "item" : "items"}
                </button>
              )}
            </section>
          )}

          {/* ---------- The one table ---------- */}
          <section ref={tableRef} id="rent-roll" className={styles.tableCard} aria-label="Rent roll">
            <div className={styles.toolbar}>
              <h2 className={styles.h2}>Rent roll</h2>
              <div className={styles.pills} role="group" aria-label="Show">
                {pills.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    className={`${styles.pill} ${filter === p.key ? styles.pillOn : ""}`}
                    aria-pressed={filter === p.key}
                    onClick={() => setFilter(p.key)}
                  >
                    {p.label} <span className={styles.pillN}>{p.n}</span>
                  </button>
                ))}
                {filter === "review" && (
                  <button
                    type="button"
                    className={`${styles.pill} ${styles.pillOn} ${styles.pillReview}`}
                    aria-pressed="true"
                    onClick={() => setFilter("all")}
                    aria-label="Needs review — show all"
                  >
                    Needs review <span className={styles.pillN}>{counts.review}</span>
                    <IconX size={14} />
                  </button>
                )}
              </div>
              {owedShown.length > 1 && (filter === "late" || filter === "review") && (
                <button
                  type="button"
                  className={`${styles.btn} ${styles.small}`}
                  disabled={bulkBusy}
                  onClick={() => recordAll(owedShown)}
                >
                  {bulkBusy ? "Recording…" : `Record all ${owedShown.length}`}
                </button>
              )}
            </div>

            {groups.length === 0 ? (
              <p className={styles.empty}>
                {filter === "all" ? "No properties yet — add one under Portfolio below." : "Nothing here this month."}
              </p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Property · tenant</th>
                    <th scope="col" className={styles.numCol}>Rent</th>
                    <th scope="col" className={styles.numCol}>Paid</th>
                    <th scope="col" className={styles.numCol}>Balance</th>
                    <th scope="col">Status</th>
                    <th scope="col" className={styles.actCol}>
                      <span className={styles.srOnly}>Actions</span>
                    </th>
                  </tr>
                </thead>
                {groups.map((g) => {
                  const whole = groupTotals.get(g.company.id) ?? g;
                  return (
                    <tbody key={g.company.id}>
                      <tr className={styles.groupRow}>
                        <th scope="rowgroup" colSpan={6}>
                          <span className={styles.groupName}>{g.company.name}</span>
                          <span className={styles.groupSum}>
                            {money(whole.collected)} <span className={styles.muted}>of {money(whole.expected)}</span>
                          </span>
                        </th>
                      </tr>
                      {g.rows.map((r) => (
                        <tr
                          key={r.target.key}
                          className={styles.row}
                          onClick={() => router.push(propertyHref(r))}
                        >
                          <td className={styles.placeCell}>
                            <Link href={propertyHref(r)} className={styles.place} onClick={stop}>
                              {r.target.label}
                            </Link>
                            <span className={styles.tenant}>
                              {r.tenant ? r.tenant.name : r.status === "vacant" ? "No tenant" : "—"}
                              {r.leaseLabel && r.lease !== "ok" && r.lease !== "none" ? ` · ${r.leaseLabel}` : ""}
                            </span>
                          </td>
                          <td className={styles.numCol} data-label="Rent">
                            {r.due > 0 ? money(r.due) : <span className={styles.muted}>—</span>}
                          </td>
                          <td className={styles.numCol} data-label="Paid">
                            <span className={r.paid > 0 ? undefined : styles.muted}>{money(r.paid)}</span>
                          </td>
                          <td className={styles.numCol} data-label="Balance">
                            <span className={r.balance > 0.005 ? styles.neg : styles.muted}>{money(r.balance)}</span>
                            {r.fees > 0.005 && <span className={styles.feeNote}>incl. {money(r.fees)} fees</span>}
                          </td>
                          <td className={styles.statusCell}>
                            <span className={`${styles.status} ${styles[`s_${r.status}`]}`}>
                              <span className={styles.statusDot} aria-hidden="true" />
                              {STATUS_TEXT[r.status]}
                              {r.status === "late" && r.late > 0 && (
                                <span className={styles.statusSub}>{r.late}d</span>
                              )}
                            </span>
                          </td>
                          <td className={styles.actCol} onClick={stop}>
                            <div className={styles.actions}>
                              {primaryAction(r)}
                              <OverflowMenu label={`More for ${r.target.label}`} items={rowMenu(r)} />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  );
                })}
              </table>
            )}
          </section>
        </>
      )}

      <section ref={moreRef} className={styles.moreSection} aria-label="More">
        <LedgerMore
          tab={moreTab}
          onTab={setMoreTab}
          month={month}
          todayKey={todayKey}
          clock={clock}
          storageReady={storageReady}
          companies={companies}
          properties={properties}
          units={units}
          targets={targets}
          recurring={recurring}
          loans={loans}
          deposits={deposits}
          transactions={transactions}
          repairs={initialRepairs}
          expiringDocs={expiringDocs}
          onTransactions={setTransactions}
          onCompanies={setCompanies}
          onProperties={setProperties}
          onUnits={setUnits}
          onRecurring={setRecurring}
          onLoans={setLoans}
          onDeposits={setDeposits}
          openSheet={showSheet}
          confirm={setConfirming}
          push={push}
        />
      </section>

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
      <ConfirmDialog request={confirming} onCancel={() => setConfirming(null)} />
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </AppShell>
  );
}
