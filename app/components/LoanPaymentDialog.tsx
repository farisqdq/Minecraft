"use client";

/**
 * "Record a payment" on a mortgage: the month, the day it was paid, and the
 * split between interest, principal and escrow, worked out from the balance
 * and editable to match the lender's statement.
 *
 * Used by the property page's loan card and by the overview's "Log it" on a
 * mortgage due this month. "Log it" used to record the suggested split
 * straight away; it opens this instead, prefilled with the same split and
 * month, so the lender's own figures can go in before anything is written.
 */

import { useMemo, useRef, useState } from "react";
import Modal from "./Modal";
import styles from "../dashboard/dashboard.module.css";
import { money } from "@/lib/money";
import { monthName } from "@/lib/notices";
import { dueDateOf, suggestPayment } from "@/lib/loans";
import type { LoanDTO, LoanPaymentDTO } from "@/lib/loans-db";

const field = (n: number) => (n ? String(n) : "");
const num = (s: string) => (s.trim() === "" ? 0 : Number(s));

function formFor(l: LoanDTO, month: string, date?: string) {
  const s = suggestPayment(l, l.payments, month);
  return {
    month,
    date: date || dueDateOf(month, l.dueDay),
    principal: field(s.principal),
    interest: field(s.interest),
    escrowTax: field(s.escrowTax),
    escrowInsurance: field(s.escrowInsurance),
  };
}

export default function LoanPaymentDialog({
  loan,
  month,
  today,
  onClose,
  onRecorded,
  focusAmount = false,
}: {
  loan: LoanDTO;
  /** The month the payment is for, to start with. */
  month: string;
  /** YYYY-MM-DD, for how far ahead the month list runs. */
  today: string;
  onClose: () => void;
  /** Saved: the payment, and the ledger entries it wrote (interest, escrow). */
  onRecorded: (payment: LoanPaymentDTO, transactions: unknown[]) => void;
  /** Land in the interest figure with it selected, as a quick "Log it" does. */
  focusAmount?: boolean;
}) {
  const [form, setForm] = useState(() => formFor(loan, month));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const firstAmount = useRef<HTMLInputElement>(null);
  const thisMonth = today.slice(0, 7);

  const total = num(form.principal) + num(form.interest) + num(form.escrowTax) + num(form.escrowInsurance);
  const months = useMemo(() => {
    // Every month from the start of the books to a year ahead that hasn't
    // been recorded — enough to catch up or pay ahead, nothing to scroll.
    const recorded = new Set(loan.payments.map((p) => p.month));
    const out: string[] = [];
    let m = loan.balanceAsOf;
    const [ty, tm] = thisMonth.split("-").map(Number);
    const limit = `${ty + 1}-${String(tm).padStart(2, "0")}`;
    for (let i = 0; i < 600 && m <= limit; i++) {
      if (!recorded.has(m)) out.push(m);
      const [y, mo] = m.split("-").map(Number);
      m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
    }
    if (!out.includes(form.month)) out.push(form.month);
    return out.sort();
  }, [loan, thisMonth, form.month]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/loans/${loan.id}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res || !res.ok) {
      setError(data?.error || "Couldn't record that payment.");
      return;
    }
    onRecorded(data.payment as LoanPaymentDTO, (data.transactions as unknown[]) ?? []);
  }

  return (
    <Modal
      open
      title={`Record a payment · ${loan.lender}`}
      subtitle="Worked out from the balance. If your statement splits it differently, type its figures — the lender's are exact to the day."
      onClose={onClose}
      initialFocus={focusAmount ? firstAmount : undefined}
    >
      <form onSubmit={save} data-loan-payment="">
        {error && <div className={styles.errorBar} style={{ marginTop: 0, marginBottom: 14 }}>{error}</div>}
        <div className={`${styles.fieldGrid} ${styles.modalGrid}`}>
          <div className={`${styles.field} ${styles.wide}`}>
            <label htmlFor="pay-month">Payment for</label>
            <select
              id="pay-month"
              value={form.month}
              onChange={(e) => setForm(formFor(loan, e.target.value))}
            >
              {months.map((m) => (
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
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            />
          </div>
          <div className={`${styles.field} ${styles.wide}`}>
            <label htmlFor="pay-interest">Interest ($)</label>
            <input
              id="pay-interest"
              ref={firstAmount}
              type="number"
              inputMode="decimal"
              enterKeyHint="done"
              min="0"
              step="0.01"
              value={form.interest}
              onChange={(e) => setForm((f) => ({ ...f, interest: e.target.value }))}
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
              value={form.principal}
              onChange={(e) => setForm((f) => ({ ...f, principal: e.target.value }))}
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
              value={form.escrowTax}
              onChange={(e) => setForm((f) => ({ ...f, escrowTax: e.target.value }))}
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
              value={form.escrowInsurance}
              onChange={(e) => setForm((f) => ({ ...f, escrowInsurance: e.target.value }))}
            />
          </div>
        </div>
        <p className={styles.helpText}>
          <b className="num">{money(Math.round(total * 100) / 100)}</b> in all. Interest and escrow go into the
          ledger as expenses; the {money(num(form.principal))} of principal comes off the balance and isn&apos;t
          an expense. Paying extra principal? Add it to the principal figure.
        </p>
        <div className={`${styles.formFoot} ${styles.stickyFoot}`}>
          <button type="button" className={`${styles.btn} ${styles.quiet}`} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={busy}>
            {busy ? "Recording…" : "Record payment"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
