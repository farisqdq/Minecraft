"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../../portal.module.css";

/**
 * The tenant's sign-off. Typing their name is the signature, and the note
 * is where "the bathroom tile was already cracked" goes — kept with the
 * report for good, and sent to the landlord as a message.
 */
export default function Acknowledge({ inspectionId, tenantName }: { inspectionId: string; tenantName: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch(`/api/portal/inspections/${inspectionId}/acknowledge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, comment }),
    }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    setBusy(false);
    if (!res || !res.ok) {
      setError(data?.error || "Couldn't save that — check your connection and try again.");
      return;
    }
    router.refresh();
  }

  return (
    <section className={styles.card} aria-label="Acknowledge">
      <h2>Does this match what you see?</h2>
      <p className={styles.factLabel} style={{ marginBottom: 14, fontSize: 13.5, lineHeight: 1.5 }}>
        Go through each room. If something is different — a mark that&apos;s missing, a scratch that was already
        there — write it below; it&apos;s kept with this report for good and protects you at move-out. Once you
        acknowledge, nobody can change the report, including your landlord.
      </p>
      <form onSubmit={submit}>
        {error && <div className={styles.formError}>{error}</div>}
        <div className={styles.field}>
          <label htmlFor="ack-comment">Anything you see differently (optional)</label>
          <textarea
            id="ack-comment"
            rows={3}
            maxLength={2000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="e.g. The bedroom carpet already had a stain by the closet."
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="ack-name">Type your full name to sign</label>
          <input
            id="ack-name"
            type="text"
            autoComplete="name"
            maxLength={120}
            required
            placeholder={tenantName}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className={styles.formFoot}>
          <button type="submit" className={styles.btnPrimary} disabled={busy || name.trim().length < 2}>
            {busy ? "Saving…" : "Acknowledge"}
          </button>
        </div>
      </form>
    </section>
  );
}
