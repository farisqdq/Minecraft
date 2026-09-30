"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import AppShell from "../../../components/AppShell";
import { useAppearance } from "../../../components/appearance/AppearanceContext";
import {
  ACCENTS,
  LAYOUTS,
  LAYOUT_DEFAULT_ACCENT,
  LAYOUT_LABELS,
  THEMES,
  THEME_LABELS,
  type Appearance,
  type UiAccent,
  type UiLayout,
  type UiTheme,
} from "@/lib/appearance";
import LayoutPreview from "./LayoutPreview";
import styles from "./appearance.module.css";

const ACCENT_NAMES: Record<UiAccent, string> = {
  indigo: "Indigo",
  blue: "Blue",
  green: "Green",
  violet: "Violet",
  orange: "Orange",
  rose: "Rose",
};

type Status = { kind: "idle" } | { kind: "saved"; at: number } | { kind: "error"; message: string };

function SunIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
    </svg>
  );
}
function DeviceIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}
const MODE_ICON: Record<UiTheme, () => ReactNode> = { light: SunIcon, dark: MoonIcon, system: DeviceIcon };
const MODE_ORDER: UiTheme[] = ["light", "dark", "system"];

/**
 * Settings > Appearance. Every choice applies the moment it's made — the
 * page itself re-renders in the chosen layout — and is saved to this
 * person's account only; nobody else's view changes.
 */
export default function AppearanceClient({ openRepairs, userLabel }: { openRepairs: number; userLabel: string }) {
  const { appearance, update } = useAppearance();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  async function choose(patch: Partial<Appearance>) {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setStatus({ kind: "idle" });
    const ok = await update(patch);
    if (ok) {
      setStatus({ kind: "saved", at: Date.now() });
      hideTimer.current = setTimeout(() => setStatus({ kind: "idle" }), 2400);
    } else {
      setStatus({ kind: "error", message: "Couldn't save that — your previous choice is back. Check your connection and try again." });
    }
  }

  const layoutDefault = (l: UiLayout) => (l === "classic" ? null : LAYOUT_DEFAULT_ACCENT[l]);
  const defaultName = (l: UiLayout) => {
    const d = layoutDefault(l);
    return d ? ACCENT_NAMES[d] : "Green";
  };

  return (
    <AppShell openRepairs={openRepairs} userLabel={userLabel} title="Appearance" back={{ href: "/dashboard/settings", label: "Settings" }}>
      <p className={styles.intro}>
        How Rent Roll looks for you. Changes apply straight away and are saved to your account — other people on your
        team keep their own.
      </p>

      <div className={styles.status} role="status" aria-live="polite">
        {status.kind === "saved" && (
          <span key={status.at} className={styles.saved}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
            Saved
          </span>
        )}
      </div>
      {status.kind === "error" && (
        <p className={styles.error} role="alert">
          {status.message}
        </p>
      )}

      <section className={styles.section} aria-labelledby="ap-layout">
        <h2 id="ap-layout" className={styles.sectionTitle}>
          Layout
        </h2>
        <p className={styles.sectionHint}>The frame and the Overview. Every other page works the same in each.</p>
        <div className={styles.layouts} role="radiogroup" aria-labelledby="ap-layout">
          {LAYOUTS.map((l) => {
            const on = appearance.layout === l;
            return (
              <label key={l} className={`${styles.layoutCard} ${on ? styles.on : ""}`}>
                <input
                  type="radio"
                  name="layout"
                  value={l}
                  checked={on}
                  onChange={() => choose({ layout: l })}
                  className={styles.srOnly}
                />
                <LayoutPreview layout={l} theme={appearance.theme} accent={appearance.accent ?? layoutDefault(l)} />
                <span className={styles.layoutText}>
                  <span className={styles.layoutName}>
                    {LAYOUT_LABELS[l].name}
                    {on && <span className={styles.current}>Current</span>}
                  </span>
                  <span className={styles.layoutBlurb}>{LAYOUT_LABELS[l].blurb}</span>
                </span>
              </label>
            );
          })}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="ap-mode">
        <h2 id="ap-mode" className={styles.sectionTitle}>
          Mode
        </h2>
        <div className={styles.modes} role="radiogroup" aria-labelledby="ap-mode">
          {MODE_ORDER.filter((t) => (THEMES as readonly string[]).includes(t)).map((t) => {
            const on = appearance.theme === t;
            const Icon = MODE_ICON[t];
            return (
              <label key={t} className={`${styles.modeCard} ${on ? styles.on : ""}`}>
                <input
                  type="radio"
                  name="mode"
                  value={t}
                  checked={on}
                  onChange={() => choose({ theme: t })}
                  className={styles.srOnly}
                />
                <Icon />
                <span>{THEME_LABELS[t]}</span>
              </label>
            );
          })}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="ap-accent">
        <h2 id="ap-accent" className={styles.sectionTitle}>
          Accent
        </h2>
        <p className={styles.sectionHint}>Buttons, links and highlights.</p>
        <div className={styles.accents} role="radiogroup" aria-labelledby="ap-accent">
          <label className={`${styles.accent} ${appearance.accent === null ? styles.on : ""}`}>
            <input
              type="radio"
              name="accent"
              value=""
              checked={appearance.accent === null}
              onChange={() => choose({ accent: null })}
              className={styles.srOnly}
              aria-label={`Default for this layout (${defaultName(appearance.layout)})`}
            />
            <span
              className={styles.swatch}
              style={{ background: `var(--pal-${layoutDefault(appearance.layout) ?? "classic"})` }}
              aria-hidden="true"
            />
            <span className={styles.accentName}>Default</span>
          </label>
          {ACCENTS.map((a) => {
            const on = appearance.accent === a;
            return (
              <label key={a} className={`${styles.accent} ${on ? styles.on : ""}`}>
                <input
                  type="radio"
                  name="accent"
                  value={a}
                  checked={on}
                  onChange={() => choose({ accent: a })}
                  className={styles.srOnly}
                  aria-label={ACCENT_NAMES[a]}
                />
                <span className={styles.swatch} style={{ background: `var(--pal-${a})` }} aria-hidden="true" />
                <span className={styles.accentName} aria-hidden="true">
                  {ACCENT_NAMES[a]}
                </span>
              </label>
            );
          })}
        </div>
      </section>
    </AppShell>
  );
}
