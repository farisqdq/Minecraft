import type { ReactNode } from "react";
import styles from "./StatusBadge.module.css";

/**
 * The one status badge. Colour follows meaning, the same everywhere:
 *   paid    green   — settled, done, active
 *   partial amber   — some but not all; needs a look soon
 *   late    red     — overdue, urgent, failed
 *   vacant  gray    — empty unit, nothing expected
 *   ended   muted   — lease ended, archived, moved out
 *   neutral gray    — anything informational (a category, "New")
 *   info    accent  — scheduled, in progress
 */
export type Status = "paid" | "partial" | "late" | "vacant" | "ended" | "neutral" | "info";

const DEFAULT_LABEL: Record<Status, string> = {
  paid: "Paid",
  partial: "Partial",
  late: "Late",
  vacant: "Vacant",
  ended: "Lease ended",
  neutral: "",
  info: "",
};

export default function StatusBadge({
  status,
  children,
  dot = true,
  className = "",
  title,
}: {
  status: Status;
  /** A custom label; defaults to the status's own word. */
  children?: ReactNode;
  dot?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <span className={`${styles.badge} ${styles[status]} ${className}`} title={title}>
      {dot && <span className={styles.dot} aria-hidden="true" />}
      {children ?? DEFAULT_LABEL[status]}
    </span>
  );
}
