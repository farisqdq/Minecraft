"use client";

import { useMemo, useState } from "react";
import Modal from "./Modal";
import ConfirmDialog, { type ConfirmRequest } from "./ConfirmDialog";
import styles from "../dashboard/dashboard.module.css";
import { money, moneyRound } from "@/lib/money";
import { monthName } from "@/lib/notices";
import { formatDay, ordinal } from "@/lib/lease";
import {
  currentBalance,
  dueDateOf,
  missedMonths,
  monthlyEscrow,
  nextUnpaidMonth,
  payoff,
  suggestPayment,
  totalMonthly,
  yearTotals,
} from "@/lib/loans";
import type { LoanDTO, LoanPaymentDTO } from "@/lib/loans-db";

/** A ledger entry a payment wrote, in the shape the parent page keeps. */
export type LoanLedgerEntry = {
  id: string;
  unitId: string | null;
  type: "rent" | "expense";
  date: string;
  amount: number;
  detail: string;
  note: string;
  category: string;
  proofCount: number;
  loanPaymentId: string | null;
};

/** A recurring bill filed as mortgage interest, which a loan would double. */
export type MortgageBill = { id: string; amount: number; detail: string; active: boolean };

const EMPTY_LOAN = {
  id: "",
  lender: "",
  balance: "",
  balanceAsOf: "",
  rate: "",
  payment: "",
  escrowTax: "",
  escrowInsurance: "",
  dueDay: "1",
  note: "",
};

const EMPTY_PAYMENT = {
  loanId: "",
  month: "",
  date: "",
  principal: "",
  interest: "",
  escrowTax: "",
  escrowInsurance: "",
};

const field = (n: number) => (n ? String(n) : "");
const num = (s: string) => (s.trim() === "" ? 0 : Number(s));

/** "29 yrs 3 mo" — how far off a payoff date is. */
function span(months: number) {
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m} mo`;
  return m === 0 ? `${y} yrs` : `${y} yrs ${m} mo`;
}

function shortMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The mortgages on one property: what's owed, when it's paid off, and each
 * payment split into the three kinds of money it really is.
 */
export default function LoansPanel({
  propertyId,
  initial,
  today,
  canDelete,
  mortgageBills,
  onPauseBill,
  onEntriesAdded,
  onEntriesRemoved,
  onToast,
}: {
  propertyId: string;
  initial: LoanDTO[];
  /** YYYY-MM-DD, from the parent, so "this month" agrees with the rest of the page. */
  today: string;
  canDelete: boolean;
  mortgageBills: MortgageBill[];
  onPauseBill: (id: string) => Promise<void>;
  onEntriesAdded: (entries: LoanLedgerEntry[]) => void;
  onEntriesRemoved: (ids: string[]) => void;
  onToast: (message: string, tone?: "bad") => void;
}) {
  const [loans, setLoans] = useState(initial);
  const [loanForm, setLoanForm] = useState(EMPTY_LOAN);
  const [loanOpen, setLoanOpen] = useState(false);
  const [payForm, setPayForm] = useState(EMPTY_PAYMENT);
  const [historyFor, setHistoryFor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null);

  const thisMonth = today.slice(0, 7);
  const year = Number(today.slice(0, 4));

  const activeLoans = loans.filter((l) => l.active);
  const owedTotal = activeLoans.reduce((sum, l) => sum + currentBalance(l.balance, l.payments), 0);
  const liveBills = mortgageBills.filter((b) => b.active);

  const editingLoan = loans.find((l) => l.id === loanForm.id);
  const startLocked = Boolean(editingLoan && editingLoan.payments.length > 0);
  const payingLoan = loans.find((l) => l.id === payForm.loanId);
  const historyLoan = loans.find((l) => l.id === historyFor);

  function openAdd() {
    setError("");
    setLoanForm({ ...EMPTY_LOAN, balanceAsOf: thisMonth });
    setLoanOpen(true);
  }

  function openEdit(l: LoanDTO) {
    setError("");
    setLoanForm({
      id: l.id,
      lender: l.lender,
      balance: String(l.balance),
      balanceAsOf: l.balanceAsOf,
      rate: String(l.rate),
      payment: String(l.payment),
      escrowTax: field(l.escrowTax),
      escrowInsurance: field(l.escrowInsurance),
      dueDay: String(l.dueDay),
      note: l.note,
    });
    setLoanOpen(true);
  }

  async function saveLoan(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { id, ...fields } = loanForm;
    const res = await fetch(id ? `/api/loans/${id}` : `/api/properties/${propertyId}/loans`, {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data?.error || "Couldn't save that loan.");
      return;
    }
    setLoans((prev) => (id ? prev.map((l) => (l.id === id ? data : l)) : [...prev, data]));
    setLoanOpen(false);
    onToast(id ? "Loan updated." : `${data.lender} added.`);
  }

  async function setActive(l: LoanDTO, active: boolean) {
    const res = await fetch(`/api/loans/${l.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      onToast(data?.error || "Couldn't change that loan.", "bad");
      return;
    }
    setLoans((prev) => prev.map((x) => (x.id === l.id ? data : x)));
    setLoanOpen(false);
    onToast(active ? `${l.lender} reopened.` : `${l.lender} closed — it won't ask for payments now.`);
  }

  function removeLoan(l: LoanDTO) {
    const n = l.payments.length;
    setConfirming({
      title: `Remove ${l.lender}?`,
      body:
        n > 0
          ? `Its record and the history of ${n} ${n === 1 ? "payment" : "payments"} go. The interest and escrow those payments put in the ledger stay — that money was really paid. To stop it asking for payments but keep the history, close it instead.`
          : "Nothing has been recorded against it, so nothing else changes.",
      confirmLabel: "Remove loan",
      danger: true,
      onConfirm: async () => {
        const res = await fetch(`/api/loans/${l.id}`, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        setConfirming(null);
        if (!res.ok) {
          onToast(data?.error || "Couldn't remove that loan.", "bad");
          return;
        }
        setLoans((prev) => prev.filter((x) => x.id !== l.id));
        setLoanOpen(false);
        onToast(`${l.lender} removed.`);
      },
    });
  }

  /** Prefills the payment form with the split worked out for `month`. */
  function fillPayment(l: LoanDTO, month: string, keepDate = false) {
    const s = suggestPayment(l, l.payments, month);
    setPayForm((f) => ({
      loanId: l.id,
      month,
      date: keepDate && f.date ? f.date : dueDateOf(month, l.dueDay),
      principal: field(s.principal),
      interest: field(s.interest),
      escrowTax: field(s.escrowTax),
      escrowInsurance: field(s.escrowInsurance),
    }));
  }

  function openPayment(l: LoanDTO) {
    setError("");
    // The oldest gap first: a forgotten August is the one to fill in.
    const missed = missedMonths(l, l.payments, thisMonth, l.active);
    fillPayment(l, missed[0] ?? nextUnpaidMonth(l, l.payments));
  }

  async function savePayment(e: React.FormEvent) {
    e.preventDefault();
    if (!payingLoan) return;
    setBusy(true);
    setError("");
    const { loanId, ...fields } = payForm;
    const res = await fetch(`/api/loans/${loanId}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data?.error || "Couldn't record that payment.");
      return;
    }
    const payment = data.payment as LoanPaymentDTO;
    setLoans((prev) =>
      prev.map((l) =>
        l.id === loanId
          ? { ...l, payments: [...l.payments, payment].sort((a, b) => a.month.localeCompare(b.month)) }
          : l
      )
    );
    onEntriesAdded(data.transactions);
    setPayForm(EMPTY_PAYMENT);
    onToast(
      `${monthName(payment.month)} recorded: ${money(payment.interest)} interest, ${money(payment.principal)} off the balance.`
    );
  }

  function undoPayment(l: LoanDTO, p: LoanPaymentDTO) {
    setConfirming({
      title: `Undo the ${monthName(p.month)} payment?`,
      body: `${money(p.interest)} of interest${
        p.escrow > 0 ? ` and ${money(p.escrow)} of escrow` : ""
      } come out of the ledger, and ${money(p.principal)} goes back on the balance.`,
      confirmLabel: "Undo payment",
      danger: true,
      onConfirm: async () => {
        const res = await fetch(`/api/loans/${l.id}/payments/${p.id}`, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        setConfirming(null);
        if (!res.ok) {
          onToast(data?.error || "Couldn't undo that payment.", "bad");
          return;
        }
        setLoans((prev) =>
          prev.map((x) => (x.id === l.id ? { ...x, payments: x.payments.filter((y) => y.id !== p.id) } : x))
        );
        onEntriesRemoved(data.transactionIds ?? []);
        onToast(`${monthName(p.month)} payment undone.`);
      },
    });
  }

  const payTotal =
    num(payForm.principal) + num(payForm.interest) + num(payForm.escrowTax) + num(payForm.escrowInsurance);
  const payMonths = useMemo(() => {
    if (!payingLoan) return [];
    // Every month from the start of the books to a year ahead that hasn't
    // been recorded — enough to catch up or pay ahead, nothing to scroll.
    const recorded = new Set(payingLoan.payments.map((p) => p.month));
    const out: string[] = [];
    let m = payingLoan.balanceAsOf;
    const [ty, tm] = thisMonth.split("-").map(Number);
    const limit = `${ty + 1}-${String(tm).padStart(2, "0")}`;
    for (let i = 0; i < 600 && m <= limit; i++) {
      if (!recorded.has(m)) out.push(m);
      const [y, mo] = m.split("-").map(Number);
      m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
    }
    return out;
  }, [payingLoan, thisMonth]);

  return (
    <>
      {loans.length === 0 ? (
        <>
          {liveBills.length > 0 && (
            <div className={styles.loanNotice}>
              <p>
                You log {liveBills.length === 1 ? "a" : ""} {liveBills.map((b) => money(b.amount)).join(" and ")}{" "}
                mortgage {liveBills.length === 1 ? "payment" : "payments"} as a recurring bill filed under Mortgage
                Interest. If that includes principal or escrow, your interest is overstated and your profit understated —
                add the loan to split it properly.
              </p>
            </div>
          )}
          <div className={styles.ledgerWrap}>
            <div className={styles.emptyState}>No mortgage on file for this property.</div>
          </div>
        </>
      ) : (
        <>
          {activeLoans.length > 0 && liveBills.length > 0 && (
            <div className={styles.loanNotice}>
              <p>
                {liveBills.length === 1
                  ? `A recurring ${money(liveBills[0].amount)} bill is still filed under Mortgage Interest. `
                  : `${liveBills.length} recurring bills are still filed under Mortgage Interest. `}
                With the loan here it would count each payment twice — pause{" "}
                {liveBills.length === 1 ? "it" : "them"} and log payments from the loan instead.
              </p>
              <button
                type="button"
                className={`${styles.btn} ${styles.small}`}
                onClick={async () => {
                  for (const b of liveBills) await onPauseBill(b.id);
                }}
              >
                {liveBills.length === 1 ? "Pause it" : "Pause them"}
              </button>
            </div>
          )}
          <div className={styles.loanGrid}>
            {loans.map((l) => {
              const owed = currentBalance(l.balance, l.payments);
              const next = nextUnpaidMonth(l, l.payments);
              const upcoming = suggestPayment(l, l.payments, next);
              const end = payoff(owed, l.rate, l.payment, next);
              const ytd = yearTotals(l.payments, year);
              const missed = missedMonths(l, l.payments, thisMonth, l.active).filter((m) => m < thisMonth);
              const paidOff = owed <= 0;
              const splitTotal = upcoming.interest + upcoming.principal + upcoming.escrowTax + upcoming.escrowInsurance;
              const pct = (n: number) => `${splitTotal > 0 ? (n / splitTotal) * 100 : 0}%`;
              return (
                <article key={l.id} className={`${styles.tenantCard} ${l.active ? "" : styles.pastTenant}`}>
                  <div className={styles.tenantHead}>
                    <div className={styles.tenantName}>
                      <span className={styles.name}>{l.lender}</span>
                      <span
                        className={`${styles.pill} ${
                          paidOff ? styles.paid : !l.active ? styles.vacant : missed.length ? styles.owed : styles.paid
                        }`}
                      >
                        {paidOff
                          ? "Paid off"
                          : !l.active
                            ? "Closed"
                            : missed.length
                              ? `${missed.length} not recorded`
                              : "Up to date"}
                      </span>
                    </div>
                    <div className={styles.addr}>
                      {l.rate}% · due on the {ordinal(l.dueDay)} · {money(totalMonthly(l))} a month
                      {monthlyEscrow(l) > 0 ? ` with escrow` : ""}
                    </div>
                  </div>

                  <div className={styles.loanBalance}>
                    <span className={`${styles.balanceFigure} num`}>{money(owed)}</span>
                    <span className={styles.balanceWord}>
                      {paidOff
                        ? "nothing left to pay"
                        : end.month
                          ? `owed · paid off ${shortMonth(end.month)}, ${span(end.payments)} from now`
                          : "owed"}
                    </span>
                  </div>

                  {!paidOff && l.active && (
                    <div>
                      <div
                        className={styles.loanSplit}
                        role="img"
                        aria-label={`${monthName(next)} payment: ${money(upcoming.interest)} interest, ${money(
                          upcoming.principal
                        )} principal, ${money(upcoming.escrowTax + upcoming.escrowInsurance)} escrow`}
                      >
                        <span className={styles.splitInterest} style={{ width: pct(upcoming.interest) }} />
                        <span
                          className={styles.splitEscrow}
                          style={{ width: pct(upcoming.escrowTax + upcoming.escrowInsurance) }}
                        />
                        <span className={styles.splitPrincipal} style={{ width: pct(upcoming.principal) }} />
                      </div>
                      <div className={styles.splitLegend}>
                        <span>
                          <i className={styles.splitInterest} />
                          Interest <b className="num">{money(upcoming.interest)}</b>
                        </span>
                        {upcoming.escrowTax + upcoming.escrowInsurance > 0 && (
                          <span>
                            <i className={styles.splitEscrow} />
                            Escrow <b className="num">{money(upcoming.escrowTax + upcoming.escrowInsurance)}</b>
                          </span>
                        )}
                        <span>
                          <i className={styles.splitPrincipal} />
                          Principal <b className="num">{money(upcoming.principal)}</b>
                        </span>
                      </div>
                      <div className={styles.note}>How the {monthName(next)} payment divides.</div>
                    </div>
                  )}

                  <div className={styles.loanFacts}>
                    <div className={styles.figure}>
                      <span className={styles.figureLabel}>Interest in {year}</span>
                      <span className={`${styles.figureValue} num`}>{money(ytd.interest)}</span>
                    </div>
                    <div className={styles.figure}>
                      <span className={styles.figureLabel}>Principal in {year}</span>
                      <span className={`${styles.figureValue} num`}>{money(ytd.principal)}</span>
                    </div>
                    {!paidOff && end.month && (
                      <>
                        <div className={styles.figure}>
                          <span className={styles.figureLabel}>Interest still to come</span>
                          <span className={`${styles.figureValue} num`}>{moneyRound(end.interest)}</span>
                        </div>
                        <div className={styles.figure}>
                          <span className={styles.figureLabel}>Escrow in {year}</span>
                          <span className={`${styles.figureValue} num`}>{money(ytd.escrow)}</span>
                        </div>
                      </>
                    )}
                  </div>

                  {missed.length > 0 && (
                    <div className={styles.loanMissed}>
                      {missed.length === 1
                        ? `${monthName(missed[0])} isn't recorded yet.`
                        : `${missed.slice(0, 3).map(shortMonth).join(", ")}${
                            missed.length > 3 ? ` and ${missed.length - 3} more` : ""
                          } aren't recorded yet.`}
                    </div>
                  )}

                  {l.note && <div className={styles.note}>{l.note}</div>}

                  <div className={styles.loanActions}>
                    {l.active && !paidOff && (
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.small} ${styles.primary}`}
                        onClick={() => openPayment(l)}
                      >
                        Record a payment
                      </button>
                    )}
                    {l.payments.length > 0 && (
                      <button type="button" className={`${styles.btn} ${styles.small}`} onClick={() => setHistoryFor(l.id)}>
                        History ({l.payments.length})
                      </button>
                    )}
                    <button type="button" className={styles.portalLink} onClick={() => openEdit(l)}>
                      Edit
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}

      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button type="button" className={`${styles.btn} ${styles.small}`} onClick={openAdd}>
          + Add a mortgage
        </button>
        {activeLoans.length > 1 && (
          <span className={styles.note} style={{ marginTop: 0 }}>
            {money(owedTotal)} owed across {activeLoans.length} loans
          </span>
        )}
      </div>

      <Modal
        open={loanOpen}
        title={loanForm.id ? `Edit ${editingLoan?.lender ?? "loan"}` : "Add a mortgage"}
        subtitle={
          loanForm.id
            ? "A new rate or escrow amount applies from the next payment you record; recorded ones keep their split."
            : "Copy these from your latest mortgage statement. The balance is what you owe going into the next payment."
        }
        onClose={() => setLoanOpen(false)}
      >
        <form onSubmit={saveLoan}>
          {error && <div className={styles.errorBar} style={{ marginTop: 0, marginBottom: 14 }}>{error}</div>}
          <div className={`${styles.fieldGrid} ${styles.modalGrid}`}>
            <div className={`${styles.field} ${styles.span4}`}>
              <label htmlFor="loan-lender">Lender</label>
              <input
                id="loan-lender"
                type="text"
                required
                placeholder="e.g. Chase mortgage"
                value={loanForm.lender}
                onChange={(e) => setLoanForm((f) => ({ ...f, lender: e.target.value }))}
              />
            </div>
            <div className={`${styles.field} ${styles.wide}`}>
              <label htmlFor="loan-balance">Principal balance ($)</label>
              <input
                id="loan-balance"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                required
                disabled={startLocked}
                value={loanForm.balance}
                onChange={(e) => setLoanForm((f) => ({ ...f, balance: e.target.value }))}
              />
            </div>
            <div className={`${styles.field} ${styles.wide}`}>
              <label htmlFor="loan-asof">Before the payment for</label>
              <input
                id="loan-asof"
                type="month"
                required
                disabled={startLocked}
                value={loanForm.balanceAsOf}
                onChange={(e) => setLoanForm((f) => ({ ...f, balanceAsOf: e.target.value }))}
              />
            </div>
            {startLocked && (
              <p className={`${styles.helpText} ${styles.span4}`} style={{ margin: 0 }}>
                The starting balance is fixed now that payments are recorded against it.
              </p>
            )}
            <div className={`${styles.field} ${styles.wide}`}>
              <label htmlFor="loan-rate">Interest rate (%)</label>
              <input
                id="loan-rate"
                type="number"
                inputMode="decimal"
                min="0"
                max="30"
                step="0.001"
                required
                placeholder="6.25"
                value={loanForm.rate}
                onChange={(e) => setLoanForm((f) => ({ ...f, rate: e.target.value }))}
              />
            </div>
            <div className={`${styles.field} ${styles.wide}`}>
              <label htmlFor="loan-payment">Principal &amp; interest ($/mo)</label>
              <input
                id="loan-payment"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                required
                value={loanForm.payment}
                onChange={(e) => setLoanForm((f) => ({ ...f, payment: e.target.value }))}
              />
            </div>
            <div className={`${styles.field} ${styles.wide}`}>
              <label htmlFor="loan-etax">Escrow for property tax ($/mo)</label>
              <input
                id="loan-etax"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                placeholder="0"
                value={loanForm.escrowTax}
                onChange={(e) => setLoanForm((f) => ({ ...f, escrowTax: e.target.value }))}
              />
            </div>
            <div className={`${styles.field} ${styles.wide}`}>
              <label htmlFor="loan-eins">Escrow for insurance ($/mo)</label>
              <input
                id="loan-eins"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                placeholder="0"
                value={loanForm.escrowInsurance}
                onChange={(e) => setLoanForm((f) => ({ ...f, escrowInsurance: e.target.value }))}
              />
            </div>
            <div className={`${styles.field} ${styles.wide}`}>
              <label htmlFor="loan-due">Due on day</label>
              <input
                id="loan-due"
                type="number"
                min="1"
                max="31"
                required
                value={loanForm.dueDay}
                onChange={(e) => setLoanForm((f) => ({ ...f, dueDay: e.target.value }))}
              />
            </div>
            <div className={`${styles.field} ${styles.wide}`}>
              <label htmlFor="loan-note">Note</label>
              <input
                id="loan-note"
                type="text"
                placeholder="Loan number, servicer phone…"
                value={loanForm.note}
                onChange={(e) => setLoanForm((f) => ({ ...f, note: e.target.value }))}
              />
            </div>
          </div>
          <div className={styles.formFoot}>
            {editingLoan && (
              <>
                {canDelete && (
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.quiet} ${styles.danger}`}
                    onClick={() => removeLoan(editingLoan)}
                  >
                    Remove
                  </button>
                )}
                <button
                  type="button"
                  className={`${styles.btn} ${styles.quiet}`}
                  style={{ marginRight: "auto" }}
                  onClick={() => setActive(editingLoan, !editingLoan.active)}
                >
                  {editingLoan.active ? "Close loan" : "Reopen"}
                </button>
              </>
            )}
            <button type="button" className={`${styles.btn} ${styles.quiet}`} onClick={() => setLoanOpen(false)}>
              Cancel
            </button>
            <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={busy}>
              {busy ? "Saving…" : loanForm.id ? "Save" : "Add mortgage"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(payingLoan)}
        title={payingLoan ? `Record a payment · ${payingLoan.lender}` : "Record a payment"}
        subtitle="Worked out from the balance. If your statement splits it differently, type its figures — the lender's are exact to the day."
        onClose={() => setPayForm(EMPTY_PAYMENT)}
      >
        {payingLoan && (
          <form onSubmit={savePayment}>
            {error && <div className={styles.errorBar} style={{ marginTop: 0, marginBottom: 14 }}>{error}</div>}
            <div className={`${styles.fieldGrid} ${styles.modalGrid}`}>
              <div className={`${styles.field} ${styles.wide}`}>
                <label htmlFor="pay-month">Payment for</label>
                <select
                  id="pay-month"
                  value={payForm.month}
                  onChange={(e) => fillPayment(payingLoan, e.target.value)}
                >
                  {payMonths.map((m) => (
                    <option key={m} value={m}>
                      {monthName(m)}
                    </option>
                  ))}
                </select>
              </div>
              <div className={`${styles.field} ${styles.wide}`}>
                <label htmlFor="pay-date">Paid on</label>
                <input
                  id="pay-date"
                  type="date"
                  required
                  value={payForm.date}
                  onChange={(e) => setPayForm((f) => ({ ...f, date: e.target.value }))}
                />
              </div>
              <div className={`${styles.field} ${styles.wide}`}>
                <label htmlFor="pay-interest">Interest ($)</label>
                <input
                  id="pay-interest"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={payForm.interest}
                  onChange={(e) => setPayForm((f) => ({ ...f, interest: e.target.value }))}
                />
              </div>
              <div className={`${styles.field} ${styles.wide}`}>
                <label htmlFor="pay-principal">Principal ($)</label>
                <input
                  id="pay-principal"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={payForm.principal}
                  onChange={(e) => setPayForm((f) => ({ ...f, principal: e.target.value }))}
                />
              </div>
              <div className={`${styles.field} ${styles.wide}`}>
                <label htmlFor="pay-etax">Escrow, property tax ($)</label>
                <input
                  id="pay-etax"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={payForm.escrowTax}
                  onChange={(e) => setPayForm((f) => ({ ...f, escrowTax: e.target.value }))}
                />
              </div>
              <div className={`${styles.field} ${styles.wide}`}>
                <label htmlFor="pay-eins">Escrow, insurance ($)</label>
                <input
                  id="pay-eins"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={payForm.escrowInsurance}
                  onChange={(e) => setPayForm((f) => ({ ...f, escrowInsurance: e.target.value }))}
                />
              </div>
            </div>
            <p className={styles.helpText}>
              <b className="num">{money(Math.round(payTotal * 100) / 100)}</b> in all. Interest and escrow go into the
              ledger as expenses; the {money(num(payForm.principal))} of principal comes off the balance and isn&apos;t
              an expense. Paying extra principal? Add it to the principal figure.
            </p>
            <div className={styles.formFoot}>
              <button type="button" className={`${styles.btn} ${styles.quiet}`} onClick={() => setPayForm(EMPTY_PAYMENT)}>
                Cancel
              </button>
              <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={busy}>
                {busy ? "Recording…" : "Record payment"}
              </button>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={Boolean(historyLoan)}
        title={historyLoan ? `${historyLoan.lender} · payments` : "Payments"}
        subtitle="Newest first. Undoing a payment takes its interest and escrow out of the ledger and puts the principal back on the balance."
        onClose={() => setHistoryFor("")}
      >
        {historyLoan && (
          <ul className={styles.loanHistory}>
            {historyLoan.payments
              .map((p) => ({
                p,
                after: currentBalance(historyLoan.balance, historyLoan.payments.filter((x) => x.month <= p.month)),
              }))
              .reverse()
              .map(({ p, after }) => (
                <li key={p.id}>
                  <div className={styles.loanHistoryHead}>
                    <span className={styles.loanHistoryMonth}>{monthName(p.month)}</span>
                    <span className={styles.note} style={{ marginTop: 0 }}>
                      paid {formatDay(p.date)}
                    </span>
                    <button type="button" className={styles.portalLink} onClick={() => undoPayment(historyLoan, p)}>
                      Undo
                    </button>
                  </div>
                  <div className={styles.loanHistoryFigures}>
                    <span>
                      <i className={styles.splitInterest} />
                      <b className="num">{money(p.interest)}</b> interest
                    </span>
                    {p.escrow > 0 && (
                      <span>
                        <i className={styles.splitEscrow} />
                        <b className="num">{money(p.escrow)}</b> escrow
                      </span>
                    )}
                    <span>
                      <i className={styles.splitPrincipal} />
                      <b className="num">{money(p.principal)}</b> principal
                    </span>
                    <span className={styles.loanHistoryLeft}>
                      <b className="num">{money(after)}</b> left
                    </span>
                  </div>
                </li>
              ))}
          </ul>
        )}
      </Modal>

      <ConfirmDialog request={confirming} onCancel={() => setConfirming(null)} />
    </>
  );
}
