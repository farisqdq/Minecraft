"use client";

import { useRef, useState } from "react";
import { THEME_LABELS, type UiTheme } from "@/lib/appearance";
import { applyToDocument } from "./AppearanceContext";
import styles from "./ModeChoice.module.css";

const ORDER: UiTheme[] = ["light", "dark", "system"];

/**
 * Light / Dark / Match my device for the tenant and owner portals (their
 * only appearance choice — the portals always have the Classic look). Applies
 * at once, saves to the login's own account, and puts the old choice back if
 * saving fails.
 */
export default function ModeChoice({
  initial,
  endpoint,
  className,
}: {
  initial: UiTheme;
  /** /api/portal/appearance or /api/owners/appearance */
  endpoint: string;
  /** The portal's own card class, so the section matches its neighbours. */
  className?: string;
}) {
  const [theme, setTheme] = useState<UiTheme>(initial);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const saved = useRef<UiTheme>(initial);

  const apply = (t: UiTheme) => applyToDocument({ layout: "classic", theme: t, accent: null });

  async function choose(t: UiTheme) {
    if (t === theme) return;
    setTheme(t);
    apply(t);
    setNote(null);
    let ok = false;
    try {
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: t }),
      });
      ok = res.ok;
    } catch {
      ok = false;
    }
    if (ok) {
      saved.current = t;
      setNote({ ok: true, text: "Saved." });
    } else {
      setTheme(saved.current);
      apply(saved.current);
      setNote({ ok: false, text: "Couldn't save that — try again." });
    }
  }

  return (
    <section className={className} aria-labelledby="mode-choice-title">
      <h2 id="mode-choice-title">Appearance</h2>
      <div className={styles.group} role="radiogroup" aria-labelledby="mode-choice-title">
        {ORDER.map((t) => (
          <label key={t} className={`${styles.option} ${theme === t ? styles.on : ""}`}>
            <input
              type="radio"
              name="portal-mode"
              value={t}
              checked={theme === t}
              onChange={() => choose(t)}
              className={styles.input}
            />
            {THEME_LABELS[t]}
          </label>
        ))}
      </div>
      <p className={`${styles.note} ${note && !note.ok ? styles.bad : ""}`} role="status" aria-live="polite">
        {note?.text ?? ""}
      </p>
    </section>
  );
}
