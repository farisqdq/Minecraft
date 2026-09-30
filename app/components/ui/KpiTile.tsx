import type { ReactNode } from "react";
import { moneyTone } from "@/lib/money-tone";
import styles from "./KpiTile.module.css";

/**
 * One headline figure. Every tile in a row is the same height whatever it
 * carries, so a row of them reads as a set.
 *
 * `value` is shown in ink — a total is not good or bad. Only the optional
 * delta is coloured, by its sign (or pass `deltaTone` when "up" is bad, as
 * with expenses: deltaTone="inverse").
 */
export default function KpiTile({
  label,
  value,
  delta,
  deltaValue,
  deltaTone = "normal",
  hint,
  footer,
  href,
}: {
  label: ReactNode;
  value: ReactNode;
  /** The delta as text, e.g. "+$3,318 vs avg". */
  delta?: ReactNode;
  /** The signed number behind the delta; decides its colour. */
  deltaValue?: number;
  deltaTone?: "normal" | "inverse" | "neutral";
  hint?: ReactNode;
  /** A sparkline or small chart under the figure. */
  footer?: ReactNode;
  href?: string;
}) {
  let tone = deltaValue === undefined || deltaTone === "neutral" ? "zero" : moneyTone(deltaValue);
  if (deltaTone === "inverse" && tone !== "zero") tone = tone === "pos" ? "neg" : "pos";
  const body = (
    <>
      <div className={styles.label}>{label}</div>
      <div className={`${styles.value} num`}>{value}</div>
      {(delta || hint) && (
        <div className={styles.meta}>
          {delta && <span className={`${styles.delta} ${styles[tone]}`}>{delta}</span>}
          {hint && <span className={styles.hint}>{hint}</span>}
        </div>
      )}
      {footer && <div className={styles.footer}>{footer}</div>}
    </>
  );
  return href ? (
    <a href={href} className={`${styles.tile} ${styles.link}`}>
      {body}
    </a>
  ) : (
    <div className={styles.tile}>{body}</div>
  );
}

/** A row of KPI tiles that wraps to two columns, then one, as space runs out. */
export function KpiRow({ children }: { children: ReactNode }) {
  return <div className={styles.row}>{children}</div>;
}
