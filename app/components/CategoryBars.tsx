"use client";

import styles from "./charts.module.css";

export type CategorySlice = { label: string; value: number };

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/**
 * Where the money went, ranked. This is one series measured against one
 * scale — the categories are nominal, not a second dimension — so every bar
 * takes the same hue and length alone does the comparing. Giving each
 * category its own colour would invent a meaning that isn't in the data.
 */
export default function CategoryBars({
  data,
  caption,
}: {
  data: CategorySlice[];
  caption: string;
}) {
  const ranked = data.filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
  const total = ranked.reduce((s, d) => s + d.value, 0);
  const max = ranked.length > 0 ? ranked[0].value : 0;

  return (
    <figure className={styles.chart}>
      <figcaption className={styles.head}>
        <div>
          <div className={styles.title}>Where it went</div>
          <div className={styles.sub}>{caption}</div>
        </div>
        {total > 0 && (
          <div className={styles.legend}>
            <span className={styles.legendItem}>
              <b style={{ color: "var(--ink)", fontWeight: 600 }} className="num">
                {money.format(total)}
              </b>
              total
            </span>
          </div>
        )}
      </figcaption>

      {ranked.length === 0 ? (
        <div className={styles.chartEmpty}>No expenses recorded in this period.</div>
      ) : (
        <ul className={styles.catList}>
          {ranked.map((d) => {
            const share = total > 0 ? Math.round((d.value / total) * 100) : 0;
            return (
              <li key={d.label} className={styles.catRow}>
                <span className={styles.catLabel} title={d.label}>
                  {d.label}
                </span>
                <span className={styles.catTrack}>
                  <span
                    className={styles.catFill}
                    style={{ width: max > 0 ? `${(d.value / max) * 100}%` : 0 }}
                  />
                </span>
                <span className={styles.catValue}>
                  {money.format(d.value)}
                  <span className={styles.catShare}>{share}%</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </figure>
  );
}
