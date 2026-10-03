"use client";

import { useEffect, useState, type FormEvent } from "react";
import Modal from "./Modal";
import styles from "../dashboard/dashboard.module.css";
import { money } from "@/lib/money";
import { formatDay, leaseRange } from "@/lib/lease";
import type { RentChangeDTO } from "@/lib/rent";
import { changeSummary, monthShort, noticeBy, NOTICE_DAYS, raiseOptions, renewalDefaults } from "@/lib/renewal";
import type { RenewalDTO } from "@/lib/renewals-db";
import type { TenantDTO } from "@/lib/tenants";

export type RenewResult = { renewal: RenewalDTO; rentChanges: RentChangeDTO[]; monthlyRent: number };

/**
 * Renews a lease: a new end date, and the rent from a month that hasn't
 * started. The new rent is written into the rent history from that month,
 * so it's charged from then and not a month before — however long it is
 * before anyone opens the app again.
 */
export function RenewDialog({
  tenant,
  currentRent,
  place,
  today,
  onClose,
  onDone,
}: {
  tenant: TenantDTO | null;
  /** What the place rents for this month. */
  currentRent: number;
  place: string;
  /** YYYY-MM-DD */
  today: string;
  onClose: () => void;
  onDone: (result: RenewResult) => void;
}) {
  const [newEnd, setNewEnd] = useState("");
  const [rentFrom, setRentFrom] = useState("");
  const [rent, setRent] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Each opening starts from this tenant's lease, not the last one's.
  useEffect(() => {
    if (!tenant) return;
    const d = renewalDefaults({ leaseEnd: tenant.leaseEnd, today });
    setNewEnd(d.newEnd);
    setRentFrom(d.rentFrom);
    setRent(String(currentRent));
    setNote("");
    setError("");
  }, [tenant, today, currentRent]);

  if (!tenant) return <Modal open={false} title="Renew lease" onClose={onClose}>{null}</Modal>;

  const first = tenant.name.trim().split(/\s+/)[0] || tenant.name;
  const amount = Number(rent);
  const validRent = Number.isFinite(amount) && amount > 0;
  const raise = validRent && amount > currentRent;
  const deadline = rentFrom ? noticeBy(rentFrom) : "";
  const late = raise && deadline !== "" && deadline < today;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!tenant) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/tenants/${tenant.id}/renew`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newEnd, newRent: amount, rentFrom, note }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Couldn't renew the lease. Try again.");
        return;
      }
      onDone(data as RenewResult);
    } catch {
      setError("Couldn't reach the server. Nothing was changed — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title={`Renew ${tenant.name}’s lease`}
      subtitle={`${place} · ${tenant.leaseEnd ? `lease ${leaseRange(tenant.leaseStart, tenant.leaseEnd)}` : "no lease end on file"} · ${money(currentRent)} a month now`}
      narrow
      onClose={onClose}
    >
      <form onSubmit={submit}>
        {error && <div className={styles.errorBar} style={{ marginTop: 0, marginBottom: 14 }}>{error}</div>}
        <div className={`${styles.fieldGrid} ${styles.modalGrid}`}>
          <div className={`${styles.field} ${styles.wide}`}>
            <label htmlFor="rn-end">Renewed lease ends</label>
            <input
              id="rn-end"
              type="date"
              required
              min={tenant.leaseEnd && tenant.leaseEnd > today ? tenant.leaseEnd : today}
              value={newEnd}
              onChange={(e) => setNewEnd(e.target.value)}
            />
          </div>
          <div className={`${styles.field} ${styles.wide}`}>
            <label htmlFor="rn-from">New rent starts with</label>
            <input
              id="rn-from"
              type="month"
              required
              min={today.slice(0, 7)}
              max={newEnd ? newEnd.slice(0, 7) : undefined}
              value={rentFrom}
              onChange={(e) => setRentFrom(e.target.value)}
            />
          </div>
          <div className={`${styles.field} ${styles.wide}`}>
            <label htmlFor="rn-rent">Monthly rent</label>
            <input
              id="rn-rent"
              type="number"
              inputMode="decimal"
              min="1"
              step="0.01"
              required
              className="num"
              value={rent}
              onChange={(e) => setRent(e.target.value)}
            />
            {currentRent > 0 && (
              <div className={styles.renewChips}>
                {raiseOptions(currentRent).map((o) => (
                  <button
                    key={o.label}
                    type="button"
                    className={`${styles.renewChip} ${amount === o.amount ? styles.renewChipOn : ""}`}
                    aria-pressed={amount === o.amount}
                    onClick={() => setRent(String(o.amount))}
                  >
                    {o.label}
                    {o.amount !== currentRent && <span className="num"> {money(o.amount)}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className={styles.renewSummary}>
          {validRent ? (
            <>
              <strong className="num">{changeSummary(currentRent, amount)}</strong>
              {amount !== currentRent && rentFrom && <span>From the {monthShort(rentFrom)} rent.</span>}
              {raise && deadline && !late && (
                <span>
                  Give {first} written notice by <b>{formatDay(deadline)}</b> — {NOTICE_DAYS} days before it starts.
                </span>
              )}
              {late && (
                <span className={styles.renewWarn}>
                  That&apos;s less than {NOTICE_DAYS} days&apos; notice before the {monthShort(rentFrom)} rent. Many
                  leases and local rules require at least that much written notice of an increase — consider starting
                  it a month later.
                </span>
              )}
            </>
          ) : (
            <span>Enter the monthly rent.</span>
          )}
        </div>

        <div className={styles.field} style={{ marginTop: 14 }}>
          <label htmlFor="rn-note">A line for the renewal notice (optional)</label>
          <textarea
            id="rn-note"
            rows={2}
            maxLength={500}
            className={styles.renewNote}
            placeholder={`e.g. Thanks for a great year, ${first}.`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div className={styles.formFoot}>
          <button type="button" className={styles.btn} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={busy || !validRent}>
            {busy ? "Renewing…" : "Renew lease"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
