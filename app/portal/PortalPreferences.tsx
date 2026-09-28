"use client";

import { useState } from "react";
import PushSetup from "../components/PushSetup";
import styles from "./portal.module.css";

/**
 * How the tenant wants to be reminded. Their own say: the landlord can send
 * reminders, but which channels reach this phone is theirs to decide.
 */
export default function PortalPreferences({
  initial,
  email,
}: {
  initial: { emailReminders: boolean; pushReminders: boolean; phone: string };
  /** Where email reminders go, for the label. */
  email: string;
}) {
  const [prefs, setPrefs] = useState(initial);
  const [phone, setPhone] = useState(initial.phone);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function update(patch: Partial<{ emailReminders: boolean; pushReminders: boolean; phone: string }>) {
    // Flip the switch at once; put it back if the save fails.
    const before = prefs;
    setPrefs((p) => ({ ...p, ...patch }));
    setBusy(true);
    setNote("");
    const res = await fetch("/api/portal/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setPrefs(before);
      setNote(data?.error || "Couldn't save that.");
      return;
    }
    setPrefs({ emailReminders: data.emailReminders, pushReminders: data.pushReminders, phone: data.phone });
    setPhone(data.phone);
    setNote("Saved.");
  }

  return (
    <section className={styles.card} id="reminders">
      <h2>Reminders</h2>
      <p className={styles.hint} style={{ marginTop: 0 }}>
        Rent due, rent late, and updates on your repair requests. Turn either off whenever you like.
      </p>
      <label className={styles.prefRow}>
        <input
          type="checkbox"
          checked={prefs.emailReminders}
          disabled={busy}
          onChange={(e) => update({ emailReminders: e.target.checked })}
        />
        <span>
          Email me{email ? ` at ${email}` : ""}
        </span>
      </label>
      <label className={styles.prefRow}>
        <input
          type="checkbox"
          checked={prefs.pushReminders}
          disabled={busy}
          onChange={(e) => update({ pushReminders: e.target.checked })}
        />
        <span>Notify my phone (once notifications are on below)</span>
      </label>
      <form
        className={styles.prefPhone}
        onSubmit={(e) => {
          e.preventDefault();
          void update({ phone });
        }}
      >
        <div className={styles.field}>
          <label htmlFor="pref-phone">Your phone number</label>
          <input id="pref-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 010-4477" />
        </div>
        <button type="submit" className={styles.btnQuiet} disabled={busy || phone === prefs.phone}>
          Save number
        </button>
      </form>
      {note && <p className={styles.hint}>{note}</p>}
      <div className={styles.prefPush}>
        <PushSetup audience="tenant" />
      </div>
    </section>
  );
}
