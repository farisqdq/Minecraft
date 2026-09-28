"use client";

import { useState } from "react";
import {
  DEFAULT_POLICY,
  parsePolicy,
  policySentence,
  type LateFeePolicyDTO,
} from "@/lib/late-fee-policy";
import styles from "../dashboard/dashboard.module.css";

type Draft = {
  enabled: boolean;
  graceDays: string;
  percent: string;
  dailyAmount: string;
  capPercent: string;
};

const toDraft = (p: LateFeePolicyDTO): Draft => ({
  enabled: p.enabled,
  graceDays: String(p.graceDays),
  percent: String(p.percent),
  dailyAmount: String(p.dailyAmount),
  capPercent: String(p.capPercent),
});

/**
 * The LLC's late-fee policy: one form, and the same policy read back in a
 * sentence as it's typed, because "7, 5, 12" only means something once it
 * says "$70, then $5 a day, up to $120".
 *
 * Saving changes nothing on the books by itself. Each tenant picks the new
 * numbers up the next time their statement is worked out, which the daily
 * reminder run does for everyone.
 */
export default function LateFeePanel({
  companyId,
  initial,
  canEdit,
}: {
  companyId: string;
  /** The saved policy, or null when the LLC never saved one. */
  initial: LateFeePolicyDTO | null;
  /** Owners save; members read. */
  canEdit: boolean;
}) {
  const [saved, setSaved] = useState<LateFeePolicyDTO>(initial ?? DEFAULT_POLICY);
  const [draft, setDraft] = useState<Draft>(toDraft(initial ?? DEFAULT_POLICY));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  // The draft as the server would read it, so the sentence and the Save
  // button agree with what a save would actually store.
  const preview = parsePolicy(
    {
      enabled: draft.enabled,
      graceDays: draft.graceDays === "" ? saved.graceDays : Number(draft.graceDays),
      percent: draft.percent === "" ? 0 : Number(draft.percent),
      dailyAmount: draft.dailyAmount === "" ? 0 : Number(draft.dailyAmount),
      capPercent: draft.capPercent === "" ? 0 : Number(draft.capPercent),
    },
    saved
  );
  const dirty = JSON.stringify(preview) !== JSON.stringify(saved);
  const nothingToCharge = preview.enabled && !(preview.percent > 0) && !(preview.dailyAmount > 0);

  function set(patch: Partial<Draft>) {
    setNote("");
    setDraft((d) => ({ ...d, ...patch }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!canEdit || busy) return;
    setBusy(true);
    setError("");
    setNote("");
    const res = await fetch(`/api/companies/${companyId}/late-fees`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(preview),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data?.error || "Couldn't save that.");
      return;
    }
    setSaved(data);
    setDraft(toDraft(data));
    setNote(
      data.enabled
        ? "Saved. Tenants on the LLC's policy pick this up from today; nothing already charged changes."
        : "Saved. No late fees are charged automatically for this LLC."
    );
  }

  const id = (name: string) => `late-fees-${name}-${companyId}`;

  return (
    <form className={styles.contactForm} onSubmit={save} aria-label="Late fees">
      <div className={styles.contactHead}>
        <strong>Late fees</strong>
        <span className={styles.helpText} style={{ margin: 0 }}>
          Applies to every tenant of this LLC unless their account says otherwise. Each fee is an
          ordinary charge on the tenant&apos;s account that you can see and delete.
        </span>
      </div>

      <label className={styles.checkboxField} htmlFor={id("enabled")}>
        <input
          id={id("enabled")}
          type="checkbox"
          checked={draft.enabled}
          disabled={!canEdit}
          onChange={(e) => set({ enabled: e.target.checked })}
        />
        Charge late fees automatically
      </label>

      <div className={styles.fieldGrid}>
        <div className={styles.field}>
          <label htmlFor={id("grace")}>Days after the due day</label>
          <input
            id={id("grace")}
            type="number"
            inputMode="numeric"
            min="0"
            max="28"
            step="1"
            value={draft.graceDays}
            disabled={!canEdit}
            onChange={(e) => set({ graceDays: e.target.value })}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor={id("percent")}>One-time fee (% of rent)</label>
          <input
            id={id("percent")}
            type="number"
            inputMode="decimal"
            min="0"
            max="100"
            step="0.5"
            value={draft.percent}
            disabled={!canEdit}
            onChange={(e) => set({ percent: e.target.value })}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor={id("daily")}>Then, each day ($)</label>
          <input
            id={id("daily")}
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={draft.dailyAmount}
            disabled={!canEdit}
            onChange={(e) => set({ dailyAmount: e.target.value })}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor={id("cap")}>Most per month (% of rent)</label>
          <input
            id={id("cap")}
            type="number"
            inputMode="decimal"
            min="0"
            max="100"
            step="0.5"
            placeholder="0 = no limit"
            value={draft.capPercent}
            disabled={!canEdit}
            onChange={(e) => set({ capPercent: e.target.value })}
          />
        </div>
      </div>

      <p className={styles.helpText} style={{ margin: 0 }} aria-live="polite" data-testid="late-fee-sentence">
        {nothingToCharge
          ? "Enter a one-time fee or a daily amount, or switch late fees off."
          : policySentence(preview)}
      </p>

      {error && <div className={styles.errorBar}>{error}</div>}

      {canEdit ? (
        <div className={styles.contactFields} style={{ gridTemplateColumns: "auto 1fr", alignItems: "center" }}>
          <button
            type="submit"
            className={`${styles.btn} ${styles.small} ${styles.primary}`}
            disabled={busy || !dirty || nothingToCharge}
          >
            {busy ? "Saving…" : "Save"}
          </button>
          {note && (
            <span className={styles.helpText} style={{ margin: 0 }}>
              {note}
            </span>
          )}
        </div>
      ) : (
        <span className={styles.helpText} style={{ margin: 0 }}>
          Only an owner of this LLC can change it.
        </span>
      )}
    </form>
  );
}
