"use client";

import { useMemo, useState } from "react";
import Modal from "./Modal";
import ConfirmDialog, { type ConfirmRequest } from "./ConfirmDialog";
import styles from "../dashboard/dashboard.module.css";
import r from "./returns.module.css";
import { money, moneyRound, signedMoney } from "@/lib/money";
import { moneyTone, toneClass } from "@/lib/money-tone";
import { monthLabel } from "@/lib/rent-month";
import {
  MISSING_LABEL,
  VALUATION_SOURCES,
  computeReturns,
  percent,
  type Purchase,
  type ReturnsEntry,
  type ReturnsLoan,
  type Valuation,
} from "@/lib/returns";
import { useViewOnly } from "./ViewOnly";

/** "Apr 12, 2019" */
export function dayLabel(day: string) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "a list, of things and words" */
function listWords(words: string[]) {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** "Nov 2025" */
function shortMonth(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

/** "−$1,200", but plain "$0" when there's nothing to take away. */
const less = (n: number) => (n === 0 ? money(0) : `\u2212${money(n)}`);

const blank = (n: number | null) => (n === null ? "" : String(n));

/**
 * What a property has earned as an investment: what it's worth, what's
 * owed on it, what it makes, and what the owner's money has made. See
 * lib/returns for every definition. Recomputes from the page's live ledger
 * and loans, so recording rent here changes the cap rate without a reload.
 */
export default function ReturnsPanel({
  propertyId,
  initialPurchase,
  initialValuations,
  entries,
  loans,
  today,
  onToast,
}: {
  propertyId: string;
  initialPurchase: Purchase;
  initialValuations: Valuation[];
  entries: ReturnsEntry[];
  loans: ReturnsLoan[];
  /** YYYY-MM-DD */
  today: string;
  onToast: (message: string, tone?: "bad") => void;
}) {
  const viewOnly = useViewOnly();
  const [purchase, setPurchase] = useState(initialPurchase);
  const [valuations, setValuations] = useState(initialValuations);
  const [editingPurchase, setEditingPurchase] = useState(false);
  const [purchaseForm, setPurchaseForm] = useState({ purchasePrice: "", purchasedOn: "", cashInvested: "" });
  const [valForm, setValForm] = useState<{ id: string; value: string; asOf: string; source: string; note: string } | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null);

  const ret = useMemo(
    () => computeReturns({ ...purchase, valuations, entries, loans, today }),
    [purchase, valuations, entries, loans, today]
  );
  const newestFirst = useMemo(
    () => [...valuations].sort((a, b) => b.asOf.localeCompare(a.asOf)),
    [valuations]
  );
  const hasPurchase = purchase.purchasePrice !== null || purchase.purchasedOn !== null || purchase.cashInvested !== null;
  const windowLabel = `${shortMonth(ret.window.from)} – ${shortMonth(ret.window.to)}`;
  const rateNote = ret.annualNoi === null ? "Needs three months on the books" : ret.annualized ? `Annualized from ${ret.monthsInWindow} months` : "Last 12 months";

  function openPurchase() {
    setPurchaseForm({
      purchasePrice: blank(purchase.purchasePrice),
      purchasedOn: purchase.purchasedOn ?? "",
      cashInvested: blank(purchase.cashInvested),
    });
    setError("");
    setEditingPurchase(true);
  }

  async function savePurchase(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch(`/api/properties/${propertyId}/purchase`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(purchaseForm),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data?.error || "Couldn't save that.");
      return;
    }
    setPurchase(data);
    setEditingPurchase(false);
    onToast("Purchase details saved.");
  }

  function openValuation(v?: Valuation) {
    setValForm(
      v
        ? { id: v.id, value: String(v.value), asOf: v.asOf, source: v.source, note: v.note }
        : { id: "", value: "", asOf: today, source: "", note: "" }
    );
    setError("");
  }

  async function saveValuation(e: React.FormEvent) {
    e.preventDefault();
    if (!valForm) return;
    setBusy(true);
    setError("");
    const { id, ...fields } = valForm;
    const res = await fetch(id ? `/api/valuations/${id}` : `/api/properties/${propertyId}/valuations`, {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data?.error || "Couldn't save that.");
      return;
    }
    setValuations((prev) => (id ? prev.map((v) => (v.id === id ? data : v)) : [...prev, data]));
    setValForm(null);
    onToast(id ? "Value updated." : `Valued at ${moneyRound(data.value)} on ${dayLabel(data.asOf)}.`);
  }

  function removeValuation(v: Valuation) {
    setConfirming({
      title: `Remove the ${moneyRound(v.value)} value from ${dayLabel(v.asOf)}?`,
      body: "Only the figure goes; nothing in the ledger changes.",
      confirmLabel: "Remove",
      danger: true,
      onConfirm: async () => {
        const res = await fetch(`/api/valuations/${v.id}`, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        setConfirming(null);
        if (!res.ok) {
          onToast(data?.error || "Couldn't remove that.", "bad");
          return;
        }
        setValuations((prev) => prev.filter((x) => x.id !== v.id));
        setValForm(null);
        onToast("Value removed.");
      },
    });
  }

  const owedPct = ret.value && ret.value > 0 ? Math.min(100, (ret.debt / ret.value) * 100) : 0;
  const missingWords = ret.missing.map((m) => MISSING_LABEL[m]);

  return (
    <>
      <div className={r.stats}>
        <div className={r.stat}>
          <span className={r.statLabel}>Value</span>
          <span className={r.statValue}>{ret.value === null ? "—" : moneyRound(ret.value)}</span>
          <span className={r.statSub}>
            {ret.valueFrom === "valuation" && ret.valueAsOf
              ? `As of ${dayLabel(ret.valueAsOf)}`
              : ret.valueFrom === "purchase"
                ? "Purchase price — no valuation yet"
                : "Not entered"}
          </span>
        </div>
        <div className={r.stat}>
          <span className={r.statLabel}>Equity</span>
          <span className={`${r.statValue} ${ret.equity === null ? "" : toneClass(r, moneyTone(ret.equity))}`}>
            {ret.equity === null ? "—" : signedMoney(Math.round(ret.equity))}
          </span>
          <span className={r.statSub}>
            {ret.debt > 0 ? `${moneyRound(ret.debt)} owed${ret.ltv !== null ? ` · ${percent(ret.ltv, 0)} LTV` : ""}` : "Nothing owed"}
          </span>
          {ret.value !== null && ret.value > 0 && (
            <div className={r.equityBar} aria-hidden="true">
              <span className={r.owed} style={{ width: `${owedPct}%` }} />
              <span className={r.owned} style={{ width: `${100 - owedPct}%` }} />
            </div>
          )}
        </div>
        <div className={r.stat}>
          <span className={r.statLabel}>Cap rate</span>
          <span className={r.statValue}>{percent(ret.capRate)}</span>
          <span className={r.statSub}>{ret.capRate === null && ret.value === null ? "Needs a value" : rateNote}</span>
        </div>
        <div className={r.stat}>
          <span className={r.statLabel}>Cash-on-cash</span>
          <span className={`${r.statValue} ${ret.cashOnCash === null ? "" : toneClass(r, moneyTone(ret.cashOnCash * 100))}`}>
            {percent(ret.cashOnCash)}
          </span>
          <span className={r.statSub}>
            {ret.cashOnCash !== null
              ? rateNote
              : purchase.cashInvested === null
                ? "Needs the cash you put in"
                : purchase.cashInvested === 0
                  ? "No cash in — nothing to divide by"
                  : rateNote}
          </span>
        </div>
        <div className={r.stat}>
          <span className={r.statLabel}>Total return</span>
          <span className={`${r.statValue} ${ret.totalReturn === null ? "" : toneClass(r, moneyTone(ret.totalReturn))}`}>
            {ret.totalReturn === null ? "—" : signedMoney(Math.round(ret.totalReturn))}
          </span>
          <span className={r.statSub}>
            {ret.totalReturn === null
              ? "Needs a value and the cash you put in"
              : ret.irr !== null
                ? `${percent(ret.irr)} a year (IRR)`
                : ret.totalReturnPct !== null
                  ? `${percent(ret.totalReturnPct)} on the cash in`
                  : "Since the books began"}
          </span>
        </div>
      </div>

      <div className={r.columns}>
        <div className={r.card}>
          <div className={r.cardHead}>
            <h3>Rent to cash flow</h3>
            <span>{windowLabel}</span>
          </div>
          <ul className={r.steps}>
            <li>
              <span>Rent</span>
              <span>{money(ret.income)}</span>
            </li>
            <li className={r.minus}>
              <span>Operating expenses</span>
              <span>{less(ret.operating)}</span>
            </li>
            <li className={r.total}>
              <span>Net operating income</span>
              <span className={toneClass(r, moneyTone(ret.noi))}>{signedMoney(ret.noi)}</span>
            </li>
            <li className={r.minus}>
              <span>Mortgage interest</span>
              <span>{less(ret.interest)}</span>
            </li>
            <li className={r.minus}>
              <span>Principal</span>
              <span>{less(ret.principal)}</span>
            </li>
            <li className={r.total}>
              <span>Cash flow</span>
              <span className={toneClass(r, moneyTone(ret.cashFlow))}>{signedMoney(ret.cashFlow)}</span>
            </li>
          </ul>
          {ret.annualized && ret.annualNoi !== null && ret.annualCashFlow !== null && (
            <p className={r.caveat}>
              Owned {ret.monthsInWindow} of these months. Over a full year that&apos;s about {moneyRound(ret.annualNoi)} of
              net operating income and {signedMoney(Math.round(ret.annualCashFlow))} of cash flow — what the rates use.
            </p>
          )}
        </div>

        <div className={r.card}>
          <div className={r.cardHead}>
            <h3>Purchase</h3>
            {!viewOnly && (
              <button type="button" className={styles.portalLink} onClick={openPurchase}>
                {hasPurchase ? "Edit" : "Add"}
              </button>
            )}
          </div>
          <dl className={r.facts}>
            <dt>Paid</dt>
            <dd>{purchase.purchasePrice === null ? "—" : money(purchase.purchasePrice)}</dd>
            <dt>Bought</dt>
            <dd>{purchase.purchasedOn ? dayLabel(purchase.purchasedOn) : "—"}</dd>
            <dt>Cash in</dt>
            <dd>{purchase.cashInvested === null ? "—" : money(purchase.cashInvested)}</dd>
            {ret.appreciation !== null && (
              <>
                <dt>Since bought</dt>
                <dd className={toneClass(r, moneyTone(ret.appreciation))}>
                  {signedMoney(Math.round(ret.appreciation))}
                  {ret.appreciationRate !== null ? ` · ${percent(ret.appreciationRate)}/yr` : ""}
                </dd>
              </>
            )}
            {ret.since && (
              <>
                <dt>Cash flow since {monthLabel(ret.booksStartLate && ret.booksFrom ? ret.booksFrom : ret.since)}</dt>
                <dd className={toneClass(r, moneyTone(ret.cashFlowToDate))}>{signedMoney(ret.cashFlowToDate)}</dd>
                <dt>Principal paid down</dt>
                <dd>{money(ret.principalToDate)}</dd>
              </>
            )}
          </dl>

          <div className={r.cardHead} style={{ marginTop: 16 }}>
            <h3>What it&apos;s worth</h3>
            {!viewOnly && (
              <button type="button" className={styles.portalLink} onClick={() => openValuation()}>
                + Update value
              </button>
            )}
          </div>
          {newestFirst.length === 0 ? (
            <p className={r.caveat} style={{ marginTop: 0 }}>
              No valuation yet{purchase.purchasePrice !== null ? ", so the purchase price stands in for it" : ""}. An
              appraisal, a broker&apos;s opinion or an online estimate all do — note which.
            </p>
          ) : (
            <ul className={r.valuations}>
              {newestFirst.map((v, i) => {
                const prev = newestFirst[i + 1]?.value ?? (i === newestFirst.length - 1 ? purchase.purchasePrice : null);
                const change = prev !== null && prev !== undefined ? v.value - prev : null;
                return (
                  <li key={v.id}>
                    <div className={r.valMain}>
                      <span className={r.valAmount}>{moneyRound(v.value)}</span>
                      <small>
                        {dayLabel(v.asOf)}
                        {v.source ? ` · ${v.source}` : ""}
                        {v.note ? ` · ${v.note}` : ""}
                      </small>
                    </div>
                    {change !== null && (
                      <span className={`${r.valChange} ${toneClass(r, moneyTone(change))}`}>
                        {change > 0 ? "+" : ""}
                        {signedMoney(Math.round(change))}
                      </span>
                    )}
                    {!viewOnly && (
                      <button type="button" className={styles.portalLink} onClick={() => openValuation(v)}>
                        Edit
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {missingWords.length > 0 && !viewOnly && (
        <div className={r.missing}>
          <p>
            Add the {listWords(missingWords)} to see{" "}
            {ret.missing.includes("cash") ? "what your own money is earning" : "the whole picture"}.
          </p>
          {ret.missing.some((m) => m !== "value") ? (
            <button type="button" className={`${styles.btn} ${styles.small}`} onClick={openPurchase}>
              Add purchase details
            </button>
          ) : (
            <button type="button" className={`${styles.btn} ${styles.small}`} onClick={() => openValuation()}>
              Update value
            </button>
          )}
        </div>
      )}

      {ret.booksStartLate && ret.since && purchase.purchasedOn && (
        <p className={r.caveat}>
          Bought in {monthLabel(purchase.purchasedOn.slice(0, 7))}, but the ledger here starts{" "}
          {ret.booksFrom ? `in ${monthLabel(ret.booksFrom)}` : "later"}. Cash flow from before then isn&apos;t counted, so the total return and IRR run low.
        </p>
      )}
      <p className={r.caveat}>
        Debt is only the mortgages entered above. Total return is cash flow since the books began plus equity over the
        cash put in — what selling today would come to, before selling costs and tax.
      </p>

      <Modal
        open={editingPurchase}
        title="Purchase details"
        subtitle="Leave anything you don't know blank — the figures that need it will say so."
        onClose={() => setEditingPurchase(false)}
      >
        <form onSubmit={savePurchase}>
          {error && <div className={styles.errorBar} style={{ marginTop: 0, marginBottom: 14 }}>{error}</div>}
          <div className={`${styles.fieldGrid} ${styles.modalGrid}`}>
            <div className={`${styles.field} ${styles.wide}`}>
              <label htmlFor="purchase-price">Purchase price ($)</label>
              <input
                id="purchase-price"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={purchaseForm.purchasePrice}
                onChange={(e) => setPurchaseForm((f) => ({ ...f, purchasePrice: e.target.value }))}
              />
            </div>
            <div className={`${styles.field} ${styles.wide}`}>
              <label htmlFor="purchase-date">Bought on</label>
              <input
                id="purchase-date"
                type="date"
                max={today}
                value={purchaseForm.purchasedOn}
                onChange={(e) => setPurchaseForm((f) => ({ ...f, purchasedOn: e.target.value }))}
              />
            </div>
            <div className={`${styles.field} ${styles.span4}`}>
              <label htmlFor="purchase-cash">Cash you put in ($)</label>
              <input
                id="purchase-cash"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={purchaseForm.cashInvested}
                onChange={(e) => setPurchaseForm((f) => ({ ...f, cashInvested: e.target.value }))}
              />
            </div>
          </div>
          <p className={styles.helpText}>
            Cash in is your own money: the down payment, closing costs, and any work done before the first tenant —
            not what the mortgage paid for.
            {Number(purchaseForm.purchasePrice) > 0 && Number(purchaseForm.cashInvested) > 0 && (
              <>
                {" "}
                That&apos;s {percent(Number(purchaseForm.cashInvested) / Number(purchaseForm.purchasePrice), 0)} of the
                price.
              </>
            )}
          </p>
          <div className={styles.formFoot}>
            <button type="button" className={`${styles.btn} ${styles.quiet}`} onClick={() => setEditingPurchase(false)}>
              Cancel
            </button>
            <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={valForm !== null}
        title={valForm?.id ? "Edit value" : "What's it worth?"}
        subtitle="The latest value is what equity and the cap rate are worked out on. Older ones stay as its history."
        onClose={() => setValForm(null)}
      >
        {valForm && (
          <form onSubmit={saveValuation}>
            {error && <div className={styles.errorBar} style={{ marginTop: 0, marginBottom: 14 }}>{error}</div>}
            <div className={`${styles.fieldGrid} ${styles.modalGrid}`}>
              <div className={`${styles.field} ${styles.wide}`}>
                <label htmlFor="val-value">Value ($)</label>
                <input
                  id="val-value"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  required
                  autoFocus
                  value={valForm.value}
                  onChange={(e) => setValForm((f) => f && { ...f, value: e.target.value })}
                />
              </div>
              <div className={`${styles.field} ${styles.wide}`}>
                <label htmlFor="val-date">As of</label>
                <input
                  id="val-date"
                  type="date"
                  required
                  max={today}
                  value={valForm.asOf}
                  onChange={(e) => setValForm((f) => f && { ...f, asOf: e.target.value })}
                />
              </div>
              <div className={`${styles.field} ${styles.span4}`}>
                <label htmlFor="val-source">Where it&apos;s from</label>
                <input
                  id="val-source"
                  type="text"
                  list="val-sources"
                  maxLength={80}
                  placeholder="Appraisal, online estimate…"
                  value={valForm.source}
                  onChange={(e) => setValForm((f) => f && { ...f, source: e.target.value })}
                />
                <datalist id="val-sources">
                  {VALUATION_SOURCES.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>
              <div className={`${styles.field} ${styles.span4}`}>
                <label htmlFor="val-note">Note</label>
                <input
                  id="val-note"
                  type="text"
                  maxLength={500}
                  placeholder="For the refinance, after the new roof…"
                  value={valForm.note}
                  onChange={(e) => setValForm((f) => f && { ...f, note: e.target.value })}
                />
              </div>
            </div>
            <div className={styles.formFoot}>
              {valForm.id && (
                <button
                  type="button"
                  className={`${styles.btn} ${styles.quiet} ${styles.danger}`}
                  style={{ marginRight: "auto" }}
                  onClick={() => {
                    const v = valuations.find((x) => x.id === valForm.id);
                    if (v) removeValuation(v);
                  }}
                >
                  Remove
                </button>
              )}
              <button type="button" className={`${styles.btn} ${styles.quiet}`} onClick={() => setValForm(null)}>
                Cancel
              </button>
              <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={busy}>
                {busy ? "Saving…" : valForm.id ? "Save" : "Add"}
              </button>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog request={confirming} onCancel={() => setConfirming(null)} />
    </>
  );
}
