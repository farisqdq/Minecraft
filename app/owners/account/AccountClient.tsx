"use client";

import { useState } from "react";
import { signOutTo } from "../../components/sign-out";
import styles from "../owners.module.css";

/** The two things an owner can change: the monthly email, and every session at once. */
export default function OwnerAccountClient({ monthlyEmail: initial, emailReady }: { monthlyEmail: boolean; emailReady: boolean }) {
  const [monthlyEmail, setMonthlyEmail] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [ending, setEnding] = useState(false);

  async function toggle(next: boolean) {
    setSaving(true);
    setError("");
    const res = await fetch("/api/owners/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monthlyEmail: next }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(data?.error || "Couldn't save that.");
      return;
    }
    setMonthlyEmail(Boolean(data.monthlyEmail));
  }

  async function signOutEverywhere() {
    setEnding(true);
    await fetch("/api/owners/sign-out-everywhere", { method: "POST" }).catch(() => undefined);
    await signOutTo("/owners/login");
  }

  return (
    <>
      <section className={styles.card}>
        <h2>Monthly email</h2>
        {error && <div className={styles.error}>{error}</div>}
        <label className={styles.toggleRow}>
          <input type="checkbox" checked={monthlyEmail} disabled={saving} onChange={(e) => toggle(e.target.checked)} />
          <span>
            Email me when a month&apos;s statement is ready
            <span className={styles.rowSub}>
              Goes out on the 2nd, with each property&apos;s rent, expenses and net for the month just ended, and a link to
              the full statement.
              {!emailReady && " This site can't send email at the moment, so nothing will arrive until it can."}
            </span>
          </span>
        </label>
      </section>

      <section className={styles.card}>
        <h2>Sign out everywhere</h2>
        <p className={styles.empty}>
          Ends every session for this login — every phone and laptop, this one included. Use it if you signed in
          somewhere you shouldn&apos;t have stayed signed in.
        </p>
        <div className={styles.controls} style={{ marginTop: 12 }}>
          <button type="button" className={styles.btn} disabled={ending} onClick={signOutEverywhere}>
            {ending ? "Signing out…" : "Sign out everywhere"}
          </button>
        </div>
      </section>
    </>
  );
}
