"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Modal from "./Modal";
import styles from "../dashboard/dashboard.module.css";
import { money } from "@/lib/money";
import { monthName } from "@/lib/notices";
import { formatDay } from "@/lib/lease";
import { DEFAULT_RETURN_DAYS, addDays, returnLabel, returnState, settle, type Deduction } from "@/lib/move-out";
import type { MoveOutDTO } from "@/lib/move-outs-db";
import type { TenantDTO } from "@/lib/tenants";
import { useViewOnly } from "./ViewOnly";

type Line = { key: number; kind: "rent" | "charge"; label: string; amount: string };

type Preview = { deposit: number; owed: number; suggestedRent: number; problem: string; receivedAfter: number };

export type MoveOutResult = {
  moveOut: MoveOutDTO;
  tenant: TenantDTO;
  /** Set when the move-out left the place empty: the day rent stopped. */
  vacantSince: string | null;
  transactions: {
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
  }[];
};

let lineKey = 0;

/**
 * Ends a tenancy: when rent stops, and where the deposit goes — to rent
 * still owed, to itemized damage, and back to the tenant.
 */
export function MoveOutDialog({
  tenant,
  today,
  onClose,
  onDone,
}: {
  tenant: TenantDTO | null;
  /** YYYY-MM-DD */
  today: string;
  onClose: () => void;
  onDone: (result: MoveOutResult) => void;
}) {
  const [movedOutOn, setMovedOutOn] = useState(today);
  const [lastRentMonth, setLastRentMonth] = useState(today.slice(0, 7));
  const [returnBy, setReturnBy] = useState(addDays(today, DEFAULT_RETURN_DAYS));
  const [address, setAddress] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // What they owe if rent stops after the chosen month. The rent line follows
  // it until someone types into it; after that, their figure stands. A ref,
  // not state: the fetch below must see this form's value, not the one left
  // over from the last tenant the dialog was opened for.
  const rentTouched = useRef(false);

  // Fresh form each time it opens for someone.
  useEffect(() => {
    rentTouched.current = false;
    if (!tenant) return;
    setMovedOutOn(today);
    setLastRentMonth(today.slice(0, 7));
    setReturnBy(addDays(today, DEFAULT_RETURN_DAYS));
    setAddress("");
    setLines([]);
    setPreview(null);
    setError("");
  }, [tenant, today]);

  useEffect(() => {
    if (!tenant || !/^\d{4}-\d{2}$/.test(lastRentMonth)) return;
    let live = true;
    fetch(`/api/tenants/${tenant.id}/move-out?through=${lastRentMonth}`)
      .then((r) => r.json())
      .then((p: Preview) => {
        if (!live || typeof p?.owed !== "number") return;
        setPreview(p);
        if (rentTouched.current) return;
        setLines((prev) => {
          const others = prev.filter((l) => l.kind !== "rent");
          return p.suggestedRent > 0
            ? [{ key: ++lineKey, kind: "rent", label: "Unpaid rent", amount: String(p.suggestedRent) }, ...others]
            : others;
        });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [tenant, lastRentMonth]);

  const deposit = preview?.deposit ?? tenant?.deposit ?? 0;
  const owed = preview?.owed ?? 0;
  const deductions: Deduction[] = lines
    .filter((l) => l.amount.trim() !== "" && Number(l.amount) > 0)
    .map((l) => ({ kind: l.kind, label: l.label.trim() || (l.kind === "rent" ? "Unpaid rent" : ""), amount: Number(l.amount) }));
  const result = settle(deposit, owed, deductions);
  const first = tenant?.name.split(" ")[0] ?? "them";

  function update(key: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!tenant) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/tenants/${tenant.id}/move-out`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        movedOutOn,
        lastRentMonth,
        deductions: lines.map(({ kind, label, amount }) => ({ kind, label, amount })),
        returnBy: deposit > 0 ? returnBy : "",
        forwardingAddress: address,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data?.error || "Couldn't record that move-out.");
      return;
    }
    onDone(data as MoveOutResult);
  }

  return (
    <Modal
      open={Boolean(tenant)}
      title={tenant ? `${tenant.name} is moving out` : "Move out"}
      subtitle="Rent stops after the month you pick. Anything kept from the deposit goes into the books as rental income; the rest is owed back."
      onClose={onClose}
    >
      {tenant && (
        <form onSubmit={submit}>
          {error && <div className={styles.errorBar} style={{ marginTop: 0, marginBottom: 14 }}>{error}</div>}
          <div className={`${styles.fieldGrid} ${styles.modalGrid}`}>
            <div className={`${styles.field} ${styles.wide}`}>
              <label htmlFor="mo-date">Moved out on</label>
              <input
                id="mo-date"
                type="date"
                required
                max={today}
                value={movedOutOn}
                onChange={(e) => {
                  setMovedOutOn(e.target.value);
                  if (e.target.value) setReturnBy(addDays(e.target.value, DEFAULT_RETURN_DAYS));
                }}
              />
            </div>
            <div className={`${styles.field} ${styles.wide}`}>
              <label htmlFor="mo-last">Last month of rent</label>
              <input
                id="mo-last"
                type="month"
                required
                max={today.slice(0, 7)}
                value={lastRentMonth}
                onChange={(e) => setLastRentMonth(e.target.value)}
              />
            </div>
          </div>

          <div className={styles.moSummary}>
            <div>
              <span className={styles.figureLabel}>Deposit held</span>
              <span className={`${styles.figureValue} num`}>{money(deposit)}</span>
            </div>
            <div>
              <span className={styles.figureLabel}>Rent owed through {lastRentMonth ? monthName(lastRentMonth) : "then"}</span>
              <span className={`${styles.figureValue} num ${owed > 0 ? styles.neg : ""}`}>
                {preview ? money(owed) : "…"}
              </span>
            </div>
          </div>
          {preview?.problem && <p className={styles.loanMissed}>{preview.problem}</p>}
          {preview && preview.receivedAfter > 0 && (
            <p className={styles.loanMissed}>
              {money(preview.receivedAfter)} of rent came in at this place after {monthName(lastRentMonth)}. It isn&apos;t
              counted above, because it might be the next tenant&apos;s. If it was {first}&apos;s, make the last month
              of rent later so it counts — otherwise the deposit could collect it twice.
            </p>
          )}

          {deposit > 0 && (
            <>
              <h3 className={styles.moHeading}>Kept from the deposit</h3>
              {lines.length === 0 && (
                <p className={styles.helpText} style={{ marginTop: 0 }}>
                  Nothing — the whole deposit goes back to {first}.
                </p>
              )}
              <ul className={styles.moLines}>
                {lines.map((l) => (
                  <li key={l.key}>
                    {l.kind === "rent" ? (
                      <span className={styles.moRentLabel}>Unpaid rent</span>
                    ) : (
                      <input
                        type="text"
                        aria-label="What it's for"
                        placeholder="What it's for, e.g. carpet cleaning"
                        value={l.label}
                        onChange={(e) => update(l.key, { label: e.target.value })}
                      />
                    )}
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      aria-label={`${l.kind === "rent" ? "Unpaid rent" : l.label || "Deduction"} amount`}
                      className="num"
                      value={l.amount}
                      onChange={(e) => {
                        if (l.kind === "rent") rentTouched.current = true;
                        update(l.key, { amount: e.target.value });
                      }}
                    />
                    <button
                      type="button"
                      className={styles.chargeDel}
                      aria-label="Remove this line"
                      onClick={() => {
                        if (l.kind === "rent") rentTouched.current = true;
                        setLines((prev) => prev.filter((x) => x.key !== l.key));
                      }}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.small}`}
                  onClick={() => setLines((prev) => [...prev, { key: ++lineKey, kind: "charge", label: "", amount: "" }])}
                >
                  + Damage or cleaning
                </button>
                {owed > 0 && !lines.some((l) => l.kind === "rent") && (
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.small}`}
                    onClick={() =>
                      setLines((prev) => [
                        { key: ++lineKey, kind: "rent", label: "Unpaid rent", amount: String(preview?.suggestedRent ?? "") },
                        ...prev,
                      ])
                    }
                  >
                    + Unpaid rent
                  </button>
                )}
              </div>

              <div className={styles.moResult}>
                {result.ok ? (
                  <>
                    <span>
                      Back to {first}
                      {result.value.kept > 0 && (
                        <span className={styles.note} style={{ display: "block" }}>
                          {money(deposit)} less {money(result.value.kept)} kept
                        </span>
                      )}
                    </span>
                    <b className="num">{money(result.value.refund)}</b>
                  </>
                ) : (
                  <span className={styles.loanMissed}>{result.error}</span>
                )}
              </div>
              {result.ok && result.value.stillOwed > 0 && (
                <p className={styles.helpText}>
                  {first} would still owe {money(result.value.stillOwed)} after the deposit. It stays on their balance.
                </p>
              )}

              <div className={`${styles.fieldGrid} ${styles.modalGrid}`} style={{ marginTop: 14 }}>
                <div className={`${styles.field} ${styles.wide}`}>
                  <label htmlFor="mo-return">Return it by</label>
                  <input
                    id="mo-return"
                    type="date"
                    min={movedOutOn}
                    value={returnBy}
                    onChange={(e) => setReturnBy(e.target.value)}
                  />
                </div>
                <div className={`${styles.field} ${styles.wide}`}>
                  <label htmlFor="mo-address">Forwarding address</label>
                  <input
                    id="mo-address"
                    type="text"
                    placeholder="Where the cheque and the list go"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                </div>
              </div>
              <p className={styles.helpText}>
                States set the deadline — usually 14 to 45 days — and most require the itemized list with it. Check
                yours. Until it&apos;s marked returned, it waits under Needs attention.
              </p>
            </>
          )}

          <div className={styles.formFoot}>
            <button type="button" className={`${styles.btn} ${styles.quiet}`} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={busy || !result.ok || !preview}>
              {busy ? "Recording…" : "Record move-out"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/** A past tenant's move-out on their card: where the deposit stands, and what to do next. */
export function MoveOutSummary({
  moveOut,
  today,
  onMarkReturned,
  onUndo,
}: {
  moveOut: MoveOutDTO;
  today: string;
  onMarkReturned: () => void;
  onUndo: () => void;
}) {
  const viewOnly = useViewOnly();
  const state = returnState(moveOut, today);
  const kept = Math.round((moveOut.deposit - moveOut.refund) * 100) / 100;
  return (
    <div className={styles.moCard}>
      <div className={styles.moCardLine}>
        Moved out {formatDay(moveOut.movedOutOn)} · rent through {monthName(moveOut.lastRentMonth)}
      </div>
      {moveOut.deposit > 0 && (
        <div className={styles.moCardLine}>
          {state.kind === "returned" ? (
            <>
              {money(moveOut.refund)} of the deposit returned {formatDay(state.on)}
              {moveOut.returnNote ? ` · ${moveOut.returnNote}` : ""}
            </>
          ) : (
            <>
              <b className="num">{money(moveOut.refund)}</b> to return
              {moveOut.returnBy ? ` by ${formatDay(moveOut.returnBy)}` : ""}{" "}
              <span className={state.kind === "overdue" ? styles.neg : styles.moDue}>({returnLabel(state)})</span>
            </>
          )}
          {kept > 0 && <span className={styles.note}> · {money(kept)} kept</span>}
        </div>
      )}
      <div className={styles.moCardActions}>
        <Link href={`/dashboard/move-outs/${moveOut.id}`} className={styles.portalLink}>
          Itemized statement
        </Link>
        {moveOut.deposit > 0 && !viewOnly && (
          <button type="button" className={styles.portalLink} onClick={onMarkReturned}>
            {state.kind === "returned" ? "Change" : "Mark returned"}
          </button>
        )}
        {!viewOnly && (
          <button type="button" className={styles.portalLink} onClick={onUndo}>
            Undo move-out
          </button>
        )}
      </div>
    </div>
  );
}

/** Records when and how the deposit went back. */
export function MarkReturnedDialog({
  moveOut,
  tenantName,
  today,
  onClose,
  onDone,
}: {
  moveOut: MoveOutDTO | null;
  tenantName: string;
  today: string;
  onClose: () => void;
  onDone: (m: MoveOutDTO) => void;
}) {
  const [on, setOn] = useState(today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!moveOut) return;
    setOn(moveOut.returnedOn ?? today);
    setNote(moveOut.returnNote);
    setError("");
  }, [moveOut, today]);

  async function save(returnedOn: string | null) {
    if (!moveOut) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/tenants/${moveOut.tenantId}/move-out`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ returnedOn, returnNote: note }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data?.error || "Couldn't save that.");
      return;
    }
    onDone(data as MoveOutDTO);
  }

  return (
    <Modal
      open={Boolean(moveOut)}
      title={`${tenantName}’s deposit`}
      subtitle={moveOut ? `${money(moveOut.refund)} owed back, with the itemized list.` : undefined}
      narrow
      onClose={onClose}
    >
      {moveOut && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save(on);
          }}
        >
          {error && <div className={styles.errorBar} style={{ marginTop: 0, marginBottom: 14 }}>{error}</div>}
          <div className={`${styles.fieldGrid} ${styles.modalGrid}`}>
            <div className={`${styles.field} ${styles.wide}`}>
              <label htmlFor="mr-on">Sent on</label>
              <input
                id="mr-on"
                type="date"
                required
                min={moveOut.movedOutOn}
                value={on}
                onChange={(e) => setOn(e.target.value)}
              />
            </div>
            <div className={`${styles.field} ${styles.wide}`}>
              <label htmlFor="mr-note">How</label>
              <input
                id="mr-note"
                type="text"
                placeholder="Check #1042, Zelle…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>
          <div className={styles.formFoot}>
            {moveOut.returnedOn && (
              <button
                type="button"
                className={`${styles.btn} ${styles.quiet}`}
                style={{ marginRight: "auto" }}
                disabled={busy}
                onClick={() => save(null)}
              >
                Not returned yet
              </button>
            )}
            <button type="button" className={`${styles.btn} ${styles.quiet}`} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={busy}>
              {busy ? "Saving…" : "Mark returned"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
