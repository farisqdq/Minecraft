"use client";

import { useEffect, useState } from "react";
import { money } from "@/lib/money";
import { monthName } from "@/lib/notices";
import type { Statement } from "@/lib/balance";
import { ruleSummary, type ChargeRule } from "@/lib/charge-rules";
import styles from "../dashboard/dashboard.module.css";

type Charge = {
  id: string;
  month: string;
  kind: string;
  label: string;
  amount: number;
  automatic: boolean;
};

type Result = {
  statement: Statement;
  problem: string;
  startMonth: string;
  openingBalance: number;
  startPinned: boolean;
  charges: Charge[];
  rules: (ChargeRule & { dueDay: number })[];
};

const EMPTY_CHARGE = { kind: "fee" as "fee" | "credit", label: "", amount: "", month: "" };

const EMPTY_RULE = {
  kind: "monthly" as "monthly" | "late",
  label: "",
  amount: "",
  percent: false,
  graceDays: "5",
};

/**
 * A tenant's account, month by month, with the two controls that make it
 * trustworthy: where the books start, and anything owed that isn't rent.
 *
 * Loaded when opened rather than with the page — a statement is a handful of
 * queries per tenant and most visits never open one.
 */
export default function StatementPanel({
  tenantId,
  tenantName,
  currentMonth,
  onBalance,
}: {
  tenantId: string;
  tenantName: string;
  currentMonth: string;
  /** Lets the card behind update when a charge changes the number. */
  onBalance?: (balance: number, behindSince: string) => void;
}) {
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [charge, setCharge] = useState({ ...EMPTY_CHARGE, month: currentMonth });
  const [opening, setOpening] = useState("");
  const [from, setFrom] = useState("");
  const [showRules, setShowRules] = useState(false);
  const [rule, setRule] = useState(EMPTY_RULE);

  function apply(next: Result) {
    setData(next);
    setOpening(next.openingBalance ? String(next.openingBalance) : "");
    setFrom(next.startPinned ? next.startMonth : "");
    onBalance?.(next.statement.balance, next.statement.behindSince);
  }

  useEffect(() => {
    let live = true;
    setData(null);
    setError("");
    fetch(`/api/tenants/${tenantId}/statement`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load"))))
      .then((d) => {
        if (live) apply(d);
      })
      .catch(() => live && setError("Couldn't load the statement."));
    return () => {
      live = false;
    };
    // Only when the tenant changes: apply() closes over onBalance, which
    // callers write inline, and depending on it would refetch every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function send(url: string, init: RequestInit, onDone?: () => void) {
    setBusy(true);
    setError("");
    const res = await fetch(url, init);
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(body?.error || "That didn't work.");
      return;
    }
    apply(body);
    onDone?.();
  }

  if (error && !data) return <div className={styles.errorBar}>{error}</div>;
  if (!data) return <p className={styles.helpText}>Working it out…</p>;

  const { statement } = data;
  const owed = statement.balance;

  return (
    <div className={styles.statement}>
      <div className={styles.statementHead}>
        <div>
          <div className={styles.statementLabel}>
            {owed > 0.005 ? "Owes" : owed < -0.005 ? "In credit" : "Balance"}
          </div>
          <div className={`${styles.statementFigure} num ${owed > 0.005 ? styles.neg : styles.pos}`}>
            {money(Math.abs(owed))}
          </div>
          {statement.behindSince && (
            <div className={styles.statementSince}>
              behind since {monthName(statement.behindSince)}
            </div>
          )}
        </div>
        <button
          type="button"
          className={`${styles.btn} ${styles.small}`}
          onClick={() => setShowSettings((v) => !v)}
        >
          {showSettings ? "Done" : "Where the books start"}
        </button>
      </div>

      {data.problem && <div className={styles.errorBar}>{data.problem}</div>}
      {error && <div className={styles.errorBar}>{error}</div>}

      {showSettings && (
        <div className={styles.statementSettings}>
          <p className={styles.helpText} style={{ marginTop: 0 }}>
            The books start {data.startPinned ? "where you set them" : `at ${monthName(data.startMonth)}`}
            {data.startPinned ? "" : ", the first month money came in"}. Nothing before that is
            counted — a lease older than this ledger would otherwise invent years of arrears.
          </p>
          <div className={`${styles.fieldGrid} ${styles.modalGrid}`}>
            <div className={styles.field}>
              <label htmlFor={`bal-from-${tenantId}`}>Start from</label>
              <input
                id={`bal-from-${tenantId}`}
                type="month"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor={`bal-open-${tenantId}`}>Owed on that day ($)</label>
              <input
                id={`bal-open-${tenantId}`}
                type="number"
                step="0.01"
                placeholder="0.00"
                value={opening}
                onChange={(e) => setOpening(e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label>&nbsp;</label>
              <button
                type="button"
                className={`${styles.btn} ${styles.small} ${styles.primary}`}
                disabled={busy}
                onClick={() =>
                  send(`/api/tenants/${tenantId}/statement`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      balanceFrom: from,
                      openingBalance: Number(opening) || 0,
                    }),
                  })
                }
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={styles.ledgerWrap}>
        <table className={`${styles.ledger} ${styles.statementTable}`}>
          <thead>
            <tr>
              <th>Month</th>
              <th style={{ textAlign: "right" }}>Rent</th>
              <th style={{ textAlign: "right" }}>Other</th>
              <th style={{ textAlign: "right" }}>Paid</th>
              <th style={{ textAlign: "right" }}>Balance</th>
            </tr>
          </thead>
          <tbody>
            {statement.rows.map((r) => (
              <tr key={r.month}>
                <td>{monthName(r.month)}</td>
                <td className="num" style={{ textAlign: "right" }}>
                  {r.rent ? money(r.rent) : "—"}
                </td>
                <td className="num" style={{ textAlign: "right" }}>
                  {r.fees || r.credits
                    ? `${r.fees ? money(r.fees) : ""}${r.fees && r.credits ? " / " : ""}${
                        r.credits ? `−${money(r.credits)}` : ""
                      }`
                    : "—"}
                </td>
                <td className="num" style={{ textAlign: "right" }}>
                  {r.paid ? money(r.paid) : "—"}
                </td>
                <td
                  className={`num ${r.balance > 0.005 ? styles.neg : r.balance < -0.005 ? styles.pos : ""}`}
                  style={{ textAlign: "right" }}
                >
                  {r.balance < 0 ? "−" : ""}
                  {money(Math.abs(r.balance))}
                </td>
              </tr>
            ))}
            {statement.rows.length === 0 && (
              <tr>
                <td colSpan={5} className={styles.helpText}>
                  Nothing to show yet — no rent has been recorded for this place.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className={styles.chargeRow}>
        <select
          aria-label="Charge or credit"
          value={charge.kind}
          onChange={(e) => setCharge((c) => ({ ...c, kind: e.target.value as "fee" | "credit" }))}
        >
          <option value="fee">Charge</option>
          <option value="credit">Credit</option>
        </select>
        <input
          type="text"
          aria-label="What for"
          placeholder={charge.kind === "fee" ? "Late fee, lot fee…" : "Goodwill, overpayment…"}
          value={charge.label}
          onChange={(e) => setCharge((c) => ({ ...c, label: e.target.value }))}
        />
        <input
          type="month"
          aria-label="Which month"
          value={charge.month}
          onChange={(e) => setCharge((c) => ({ ...c, month: e.target.value }))}
        />
        <input
          type="number"
          step="0.01"
          min="0"
          aria-label="Amount"
          placeholder="0.00"
          value={charge.amount}
          onChange={(e) => setCharge((c) => ({ ...c, amount: e.target.value }))}
        />
        <button
          type="button"
          className={`${styles.btn} ${styles.small} ${styles.primary}`}
          disabled={busy || !charge.label.trim() || !(Number(charge.amount) > 0)}
          onClick={() =>
            send(
              `/api/tenants/${tenantId}/charges`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...charge, amount: Number(charge.amount) }),
              },
              () => setCharge({ ...EMPTY_CHARGE, month: currentMonth })
            )
          }
        >
          Add
        </button>
      </div>

      {data.charges.length > 0 && (
        <ul className={styles.chargeList}>
          {data.charges.map((c) => (
            <li key={c.id}>
              <span className={styles.chargeWhat}>
                {c.label}
                <span className={styles.chargeWhen}>
                  {monthName(c.month)} · {c.kind === "credit" ? "credit" : "charge"}
                  {c.automatic && " · added by a rule"}
                </span>
              </span>
              <span className={`num ${c.kind === "credit" ? styles.pos : styles.neg}`}>
                {c.kind === "credit" ? "−" : ""}
                {money(c.amount)}
              </span>
              <button
                type="button"
                className={styles.chargeDel}
                aria-label={`Delete ${c.label}`}
                title="Delete"
                disabled={busy}
                onClick={() =>
                  send(`/api/tenants/${tenantId}/charges?charge=${encodeURIComponent(c.id)}`, {
                    method: "DELETE",
                  })
                }
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.ruleBlock}>
        <div className={styles.ruleHead}>
          <h4>What bills itself</h4>
          <button
            type="button"
            className={`${styles.btn} ${styles.small}`}
            onClick={() => setShowRules((v) => !v)}
          >
            {showRules ? "Done" : data.rules.length ? "Change" : "Set one up"}
          </button>
        </div>

        {data.rules.length === 0 ? (
          <p className={styles.helpText} style={{ marginTop: 0 }}>
            Nothing yet. A rule saves typing the same lot fee in every month, or adds a late
            fee on its own when rent is still owed after the grace period.
          </p>
        ) : (
          <ul className={styles.ruleList}>
            {data.rules.map((r) => (
              <li key={r.id} className={r.active ? undefined : styles.ruleOff}>
                <span className={styles.chargeWhat}>
                  {r.label}
                  <span className={styles.chargeWhen}>
                    {ruleSummary(r, r.dueDay)}
                    {r.active ? "" : " · off"}
                  </span>
                </span>
                <button
                  type="button"
                  className={styles.portalLink}
                  disabled={busy}
                  onClick={() =>
                    send(`/api/tenants/${tenantId}/rules`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ rule: r.id, active: !r.active }),
                    })
                  }
                >
                  {r.active ? "Turn off" : "Turn on"}
                </button>
                <button
                  type="button"
                  className={styles.chargeDel}
                  aria-label={`Delete the ${r.label} rule`}
                  title="Delete the rule"
                  disabled={busy}
                  onClick={() =>
                    send(`/api/tenants/${tenantId}/rules?rule=${encodeURIComponent(r.id)}`, {
                      method: "DELETE",
                    })
                  }
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        {showRules && (
          <div className={styles.ruleForm}>
            <div className={styles.chargeRow}>
              <select
                aria-label="When it applies"
                value={rule.kind}
                onChange={(e) =>
                  setRule((r) => ({ ...r, kind: e.target.value as "monthly" | "late" }))
                }
              >
                <option value="monthly">Every month</option>
                <option value="late">When rent is late</option>
              </select>
              <input
                type="text"
                aria-label="What the rule is for"
                placeholder={rule.kind === "monthly" ? "Lot fee, pet rent…" : "Late fee"}
                value={rule.label}
                onChange={(e) => setRule((r) => ({ ...r, label: e.target.value }))}
              />
              <select
                aria-label="Flat amount or a percentage"
                value={rule.percent ? "percent" : "flat"}
                onChange={(e) => setRule((r) => ({ ...r, percent: e.target.value === "percent" }))}
              >
                <option value="flat">$</option>
                <option value="percent">% of rent</option>
              </select>
              <input
                type="number"
                step="0.01"
                min="0"
                aria-label="How much"
                placeholder={rule.percent ? "5" : "50.00"}
                value={rule.amount}
                onChange={(e) => setRule((r) => ({ ...r, amount: e.target.value }))}
              />
              <button
                type="button"
                className={`${styles.btn} ${styles.small} ${styles.primary}`}
                disabled={busy || !rule.label.trim() || !(Number(rule.amount) > 0)}
                onClick={() =>
                  send(
                    `/api/tenants/${tenantId}/rules`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        ...rule,
                        amount: Number(rule.amount),
                        graceDays: Number(rule.graceDays) || 0,
                      }),
                    },
                    () => setRule(EMPTY_RULE)
                  )
                }
              >
                Add
              </button>
            </div>

            {rule.kind === "late" && (
              <div className={styles.graceRow}>
                <label htmlFor={`grace-${tenantId}`}>Days after rent is due</label>
                <input
                  id={`grace-${tenantId}`}
                  type="number"
                  min="0"
                  max="28"
                  value={rule.graceDays}
                  onChange={(e) => setRule((r) => ({ ...r, graceDays: e.target.value }))}
                />
                <span className={styles.helpText}>
                  Nothing is charged before then, and nothing at all if they&apos;ve paid.
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <p className={styles.helpText}>
        Rent comes from the rent history and isn&apos;t listed above — only what you&apos;ve added
        on top of it. {tenantName} sees this balance on their portal.
      </p>
    </div>
  );
}
