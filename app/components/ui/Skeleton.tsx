import styles from "./Skeleton.module.css";

/**
 * Placeholder shapes while something loads. The shimmer stops for people who
 * asked for reduced motion. Announced once as "Loading" to screen readers.
 *
 *   <Skeleton variant="line" width="40%" />
 *   <Skeleton variant="box" height={116} />
 *   <Skeleton variant="rows" rows={6} />
 */
export default function Skeleton({
  variant = "line",
  width,
  height,
  rows = 5,
  label = "Loading",
}: {
  variant?: "line" | "box" | "rows";
  width?: number | string;
  height?: number | string;
  /** For variant="rows": how many table rows to fake. */
  rows?: number;
  label?: string;
}) {
  if (variant === "rows") {
    return (
      <div className={styles.table} role="status" aria-label={label}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className={styles.row}>
            <span className={styles.bone} style={{ width: "28%" }} />
            <span className={styles.bone} style={{ width: `${18 + ((i * 7) % 16)}%` }} />
            <span className={`${styles.bone} ${styles.end}`} style={{ width: "12%" }} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <span
      role="status"
      aria-label={label}
      className={`${styles.bone} ${variant === "box" ? styles.box : styles.line}`}
      style={{ width, height }}
    />
  );
}
