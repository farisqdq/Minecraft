"use client";

import { useCallback, useState } from "react";
import styles from "./overlay.module.css";

export type Toast = { id: number; message: string; tone: "good" | "bad" | "plain" };

let nextId = 1;

/** Short-lived confirmations, so a successful save isn't silent. */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (message: string, tone: Toast["tone"] = "good") => {
      const id = nextId++;
      setToasts((prev) => [...prev, { id, message, tone }]);
      window.setTimeout(() => dismiss(id), tone === "bad" ? 7000 : 4000);
    },
    [dismiss]
  );

  return { toasts, push, dismiss };
}

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div className={styles.toastStack} role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`${styles.toast} ${t.tone === "good" ? styles.good : ""} ${t.tone === "bad" ? styles.bad : ""}`}>
          <span className={styles.toastDot} aria-hidden="true" />
          <span className={styles.toastText}>{t.message}</span>
          <button type="button" className={styles.toastClose} onClick={() => onDismiss(t.id)} aria-label="Dismiss">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
