"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import styles from "./overlay.module.css";

/**
 * A dialog that behaves the way people expect one to: Escape and a click on
 * the scrim close it, the page behind stops scrolling, and focus moves in on
 * open and back to whatever opened it on close.
 */
export default function Modal({
  open,
  title,
  subtitle,
  onClose,
  narrow = false,
  children,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  narrow?: boolean;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;

    restoreTo.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);

    // Prefer the first real control so a phone keyboard lands somewhere useful.
    const first = panel.current?.querySelector<HTMLElement>(
      "input:not([type=hidden]), select, textarea, button"
    );
    (first ?? panel.current)?.focus();

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      restoreTo.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={styles.scrim}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        className={`${styles.panel} ${narrow ? styles.narrow : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className={styles.panelHead}>
          <div>
            <h2 id={titleId} className={styles.panelTitle}>
              {title}
            </h2>
            {subtitle && <p className={styles.panelSub}>{subtitle}</p>}
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
