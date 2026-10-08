"use client";

/**
 * The "+ Record" sheet: one rent payment or one expense, with proof.
 *
 * Shared by the overview and the calendar so that every way of recording
 * money there — the + Record button, editing a ledger row, and the quick
 * "Mark paid" / "Part paid" / "Log it" buttons — goes through the same form
 * with the same fields: amount, date, who paid (or who was paid), category,
 * note, Attach proof (photo, file or Scan) and, on rent, "Waive late fee".
 *
 * A quick button opens it in "quick" mode: the type and the place are fixed
 * (it records exactly what the button used to), the rest is prefilled from
 * lib/quick-record.ts, the amount has focus with its text selected, and
 * Enter records it. So the common case is still two taps, and a short
 * payment, a cheque number or a receipt photo no longer means recording it
 * wrong and fixing it afterwards.
 *
 * A recurring bill is logged through /api/recurring/:id/log, as "Log it"
 * always was, so it stays linked to its template and counts for its month.
 */

import { useRef, useState } from "react";
import AppliesToField from "./AppliesToField";
import Modal from "./Modal";
import ProofPicker, { releasePending, uploadProof, type PendingProof, type ProofDTO } from "./ProofPicker";
import WaiveLateFeeField from "./WaiveLateFeeField";
import styles from "../dashboard/dashboard.module.css";
import { EXPENSE_CATEGORIES } from "@/lib/categories";
import { formatDay } from "@/lib/lease";
import { proofCountLabel, proofScanTitle } from "@/lib/attachments-ui";
import { entryLabels, monthBounds, type EntryPrefill } from "@/lib/quick-record";

export type EntryTarget = { key: string; propertyId: string; unitId: string | null; label: string };

export type EntryDraft = {
  /** "quick" fixes the type and place; "edit" corrects an existing entry. */
  mode: "new" | "edit" | "quick";
  targetKey: string;
  prefill: EntryPrefill;
  /** The entry being corrected, in "edit" mode. */
  editingId?: string;
  /** Proof already on the entry being edited, so the four-file cap covers it. */
  existingProof?: number;
  /** Log this recurring bill for this month, rather than a plain entry. */
  recurring?: { id: string; month: string };
  /** One line saying what a quick entry is for: "Sam Lee · Maple St — Unit 1 · September 2026". */
  context?: string;
};

/** A saved ledger entry as the API returns it. */
export type SavedEntry = {
  id: string;
  propertyId: string;
  unitId: string | null;
  type: "rent" | "expense";
  date: string;
  amount: number;
  detail: string;
  note: string;
  category: string;
  recurringExpenseId: string | null;
  loanPaymentId: string | null;
  /** Rent only: the month it counts toward, when not the month of `date`. */
  appliesTo?: string | null;
};

const STORAGE_HINT =
  "Proof uploads need file storage. In Vercel, open this project's Storage tab, add Blob, then redeploy.";

export default function RecordEntrySheet({
  open,
  draft,
  targets,
  storageReady,
  onClose,
  onSaved,
  onProof,
}: {
  open: boolean;
  draft: EntryDraft;
  targets: EntryTarget[];
  storageReady: boolean;
  onClose: () => void;
  /**
   * The entry is on the books (created or corrected). `waive` is what was
   * sent for "Waive late fee" (null when the box wasn't touched), so the page
   * can reload the fees it shows. Called before proof uploads start.
   */
  onSaved: (r: { entry: SavedEntry; created: boolean; waive: boolean | null }) => void;
  /** One proof file landed on an entry. */
  onProof: (entryId: string, proof: ProofDTO) => void;
}) {
  const quick = draft.mode === "quick";
  const [editingId, setEditingId] = useState(draft.editingId ?? "");
  const [type, setType] = useState(draft.prefill.type);
  const [targetKey, setTargetKey] = useState(draft.targetKey);
  const [date, setDate] = useState(draft.prefill.date);
  const [amount, setAmount] = useState(draft.prefill.amount);
  const [detail, setDetail] = useState(draft.prefill.detail);
  const [note, setNote] = useState(draft.prefill.note);
  const [category, setCategory] = useState(draft.prefill.category);
  // "" follows the date: rent counts toward the month it's dated in until
  // someone picks another. A "Mark paid" for a month arrives already set.
  const [appliesTo, setAppliesTo] = useState(draft.prefill.appliesTo ?? "");
  const [waive, setWaive] = useState<boolean | null>(null);
  const [pending, setPending] = useState<PendingProof[]>([]);
  const [existing, setExisting] = useState(draft.existingProof ?? 0);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [proofError, setProofError] = useState("");
  const amountRef = useRef<HTMLInputElement>(null);

  const isRent = type === "rent";
  const editing = Boolean(editingId);
  const target = targets.find((t) => t.key === targetKey) ?? (quick ? null : targets[0] ?? null);
  const labels = entryLabels(type, { editing, recurring: Boolean(draft.recurring) });
  const bounds = draft.recurring ? monthBounds(draft.recurring.month) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const amt = parseFloat(amount);
    if (!target) {
      setError("That property isn't in view any more.");
      return;
    }
    if (!date || !(amt > 0)) {
      setError("Enter an amount above zero and a date.");
      return;
    }
    if (type === "expense" && !category) {
      setError("Pick a category for this expense.");
      return;
    }
    setError("");
    setSaving(true);

    const fields = {
      date,
      amount: amt,
      detail,
      note,
      category: type === "expense" ? category : undefined,
      appliesTo: type === "rent" ? appliesTo || null : undefined,
    };
    let res: Response;
    try {
      res =
        draft.recurring && !editing
          ? await fetch(`/api/recurring/${draft.recurring.id}/log`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ month: draft.recurring.month, ...fields }),
            })
          : await fetch(editing ? `/api/transactions/${editingId}` : "/api/transactions", {
              method: editing ? "PATCH" : "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                propertyId: target.propertyId,
                unitId: target.unitId,
                type,
                ...fields,
                // Only once the box was touched, so an edit can't un-waive by accident.
                waiveLateFee: isRent && waive !== null ? waive : undefined,
              }),
            });
    } catch {
      setSaving(false);
      setError("Couldn't reach the server — check your connection and try again.");
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSaving(false);
      setError(data?.error || (editing ? "Couldn't save those changes." : "Couldn't record that."));
      return;
    }
    const entry: SavedEntry = {
      ...data,
      detail: data.detail ?? "",
      note: data.note ?? "",
      category: data.category ?? "",
      recurringExpenseId: data.recurringExpenseId ?? null,
      loanPaymentId: data.loanPaymentId ?? null,
      appliesTo: data.appliesTo ?? null,
    };
    const sentWaive = isRent ? waive : null;
    setWaive(null);
    onSaved({ entry, created: !editing, waive: sentWaive });

    // Proof goes up once the entry exists, one file at a time (a weak phone
    // signal copes better). If one fails the entry is still saved: the sheet
    // stays open as an edit of it, holding the files that didn't make it.
    let sent = 0;
    if (pending.length > 0) {
      setUploading(true);
      setProofError("");
      for (let i = 0; i < pending.length; i++) {
        const result = await uploadProof(entry.id, pending[i].file);
        if (!result.ok) {
          setPending(pending.slice(i));
          setExisting((n) => n + sent);
          setProofError(`${sent > 0 ? `${proofCountLabel(sent)} attached, but ` : ""}${result.error}`);
          setEditingId(entry.id);
          setUploading(false);
          setSaving(false);
          return;
        }
        sent += 1;
        releasePending([pending[i]]);
        onProof(entry.id, result.attachment);
      }
      setPending([]);
      setUploading(false);
    }
    setSaving(false);
    onClose();
  }

  return (
    <Modal
      open={open}
      title={labels.title}
      subtitle={
        editing
          ? "Correct any of it. Proof already attached to this entry stays put."
          : quick
            ? draft.context
            : "Rent that came in, or money that went out on a repair or bill."
      }
      onClose={onClose}
      initialFocus={quick ? amountRef : undefined}
    >
      <div className={`${styles.formCard} ${styles.formBare}`}>
        {!quick && (
          <div className={styles.typeToggle}>
            <button
              type="button"
              className={type === "rent" ? `${styles.active} ${styles.rent}` : ""}
              onClick={() => setType("rent")}
            >
              Rent payment
            </button>
            <button
              type="button"
              className={type === "expense" ? `${styles.active} ${styles.expense}` : ""}
              onClick={() => setType("expense")}
            >
              Repair / expense
            </button>
          </div>
        )}
        <form onSubmit={submit} data-record-sheet={quick ? "quick" : draft.mode}>
          <div className={`${styles.fieldGrid} ${styles.modalGrid}`}>
            {quick ? (
              <div className={`${styles.field} ${styles.wide}`}>
                <span className={styles.quickFor}>{isRent ? "Rent" : "Expense"} for</span>
                <span className={styles.quickTarget}>{target?.label ?? "—"}</span>
              </div>
            ) : (
              <div className={`${styles.field} ${styles.wide}`}>
                <label htmlFor="f-property">Property</label>
                <select
                  id="f-property"
                  required
                  value={target?.key ?? ""}
                  onChange={(e) => setTargetKey(e.target.value)}
                >
                  {targets.length === 0 && <option value="">Add a property first</option>}
                  {targets.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className={styles.field}>
              <label htmlFor="f-amount">Amount ($)</label>
              <input
                id="f-amount"
                ref={amountRef}
                type="number"
                inputMode="decimal"
                enterKeyHint="done"
                min="0"
                step="0.01"
                placeholder="0.00"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="f-date">Date</label>
              <input
                id="f-date"
                type="date"
                required
                min={bounds?.min}
                max={bounds?.max}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            {isRent && !draft.recurring && (
              <AppliesToField
                id="f-applies"
                className={`${styles.field} ${styles.wide}`}
                date={date}
                value={appliesTo}
                onChange={setAppliesTo}
              />
            )}
            {!isRent && (
              <div className={`${styles.field} ${styles.wide}`}>
                <label htmlFor="f-category">Category</label>
                <select id="f-category" required value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">Choose one</option>
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className={`${styles.field} ${styles.wide}`}>
              <label htmlFor="f-detail">{labels.detail}</label>
              <input
                id="f-detail"
                type="text"
                placeholder={isRent ? "e.g. J. Alvarez" : "e.g. Smith Plumbing"}
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
              />
            </div>
            <div className={`${styles.field} ${styles.span4}`}>
              <label htmlFor="f-note">Note (optional)</label>
              <input
                id="f-note"
                type="text"
                placeholder={isRent ? "e.g. September rent, check #1042" : "e.g. Invoice #123, paid by card"}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            {isRent && target && (
              <WaiveLateFeeField
                className={styles.span4}
                propertyId={target.propertyId}
                unitId={target.unitId}
                // The fee waived is the chosen month's, as the server applies it.
                date={appliesTo ? `${appliesTo}-01` : date}
                value={waive}
                onChange={setWaive}
              />
            )}
            <div className={`${styles.field} ${styles.span4}`}>
              {storageReady ? (
                <ProofPicker
                  value={pending}
                  onChange={setPending}
                  existing={existing}
                  disabled={saving}
                  label={labels.proof}
                  scanTitle={proofScanTitle(type, date ? formatDay(date) : "")}
                />
              ) : (
                <span className={styles.proofWarn}>{STORAGE_HINT}</span>
              )}
              {proofError && <span className={styles.proofWarn}>{proofError}</span>}
            </div>
          </div>
          {error && <div className={styles.errorBar}>{error}</div>}
          <div className={`${styles.formFoot} ${styles.stickyFoot}`}>
            <button type="button" className={styles.btn} onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className={`${styles.btn} ${styles.accent}`}
              disabled={saving || (!quick && targets.length === 0)}
            >
              {saving
                ? uploading
                  ? "Uploading proof…"
                  : "Saving…"
                : labels.submit}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}

