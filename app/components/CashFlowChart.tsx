"use client";

import { useState } from "react";
import styles from "./charts.module.css";

export type CashFlowPoint = { month: string; rent: number; expense: number };

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const NICE_STEPS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/** Rounds a value up to a friendly axis maximum, without leaving half the plot empty. */
function niceCeil(value: number) {
  if (value <= 0) return 0;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const scaled = value / magnitude;
  const step = NICE_STEPS.find((s) => scaled <= s + 1e-9) ?? 10;
  return step * magnitude;
}

function monthParts(key: string) {
  const [y, m] = key.split("-").map(Number);
  const date = new Date(y, m - 1, 1);
  return {
    long: date.toLocaleDateString("en-US", { month: "short" }),
    short: date.toLocaleDateString("en-US", { month: "narrow" }),
    full: date.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    isJanuary: m === 1,
    year: String(y),
  };
}

/**
 * Twelve months of money as diverging columns: rent above the zero line,
 * expenses below it. Polarity is carried by *position*, so the chart still
 * reads with the colour taken away — the two series only need to be told
 * apart by which side of the baseline they sit on.
 *
 * Both halves share one scale, so a $500 repair is exactly as tall as $500
 * of rent. Hovering swaps the numbers in the readout above the plot rather
 * than floating a tooltip, which keeps marks unobscured on a phone.
 */
export default function CashFlowChart({ data }: { data: CashFlowPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const totalRent = data.reduce((s, d) => s + d.rent, 0);
  const totalExpense = data.reduce((s, d) => s + d.expense, 0);

  if (data.length === 0 || (totalRent === 0 && totalExpense === 0)) {
    return (
      <figure className={styles.chart}>
        <figcaption className={styles.head}>
          <div>
            <div className={styles.title}>Cash flow</div>
            <div className={styles.sub}>Last 12 months</div>
          </div>
        </figcaption>
        <div className={styles.chartEmpty}>
          Record a rent payment or an expense and this fills in month by month.
        </div>
      </figure>
    );
  }

  const topMax = niceCeil(Math.max(...data.map((d) => d.rent)));
  const bottomMax = niceCeil(Math.max(...data.map((d) => d.expense)));
  const span = topMax + bottomMax || 1;
  const zeroPct = (topMax / span) * 100;

  // Gridlines at the axis ends and their midpoints — four hairlines at most,
  // which is enough to read a bar's height without fencing in the data.
  const ticks: { value: number; pct: number; strong: boolean }[] = [];
  if (topMax > 0) {
    ticks.push({ value: topMax, pct: 0, strong: false });
    ticks.push({ value: topMax / 2, pct: zeroPct / 2, strong: false });
  }
  if (bottomMax > 0) {
    ticks.push({ value: -bottomMax / 2, pct: zeroPct + (100 - zeroPct) / 2, strong: false });
    ticks.push({ value: -bottomMax, pct: 100, strong: false });
  }

  const shown = hover === null ? null : data[hover];
  const readoutRent = shown ? shown.rent : totalRent;
  const readoutExpense = shown ? shown.expense : totalExpense;
  const readoutNet = readoutRent - readoutExpense;

  const first = monthParts(data[0].month).full;
  const last = monthParts(data[data.length - 1].month).full;

  return (
    <figure className={styles.chart}>
      <figcaption className={styles.head}>
        <div>
          <div className={styles.title}>Cash flow</div>
          <div className={styles.sub}>
            {first} – {last}
          </div>
        </div>
        <div className={styles.legend}>
          <span className={styles.legendItem}>
            <i className={styles.swatch} style={{ background: "var(--accent)" }} />
            Rent in
          </span>
          <span className={styles.legendItem}>
            <i className={styles.swatch} style={{ background: "var(--expense)" }} />
            Money out
          </span>
        </div>
      </figcaption>

      <div className={styles.readout} aria-live="polite">
        <span className={styles.readoutMonth}>{shown ? monthParts(shown.month).full : "12-month total"}</span>
        <span>
          Rent<b className="num">{money.format(readoutRent)}</b>
        </span>
        <span>
          Out<b className="num">{money.format(readoutExpense)}</b>
        </span>
        <span>
          Net
          <b className="num" style={{ color: readoutNet >= 0 ? "var(--accent)" : "var(--expense)" }}>
            {readoutNet < 0 ? "−" : ""}
            {money.format(Math.abs(readoutNet))}
          </b>
        </span>
      </div>

      <div className={styles.plotWrap}>
        <div className={styles.gutter} aria-hidden="true">
          {ticks.map((t) => (
            <span key={t.pct} className={styles.tick} style={{ top: `${t.pct}%` }}>
              {t.value < 0 ? "−" : ""}
              {money.format(Math.abs(t.value))}
            </span>
          ))}
          <span className={styles.tick} style={{ top: `${zeroPct}%` }}>
            $0
          </span>
        </div>

        <div
          className={styles.plot}
          style={{ height: 176 }}
          role="img"
          aria-label={`Cash flow from ${first} to ${last}. Rent collected ${money.format(
            totalRent
          )}, money out ${money.format(totalExpense)}, net ${money.format(totalRent - totalExpense)}.`}
        >
          {ticks.map((t) => (
            <span key={`g${t.pct}`} className={styles.gridline} style={{ top: `${t.pct}%` }} />
          ))}
          <span className={styles.zeroline} style={{ top: `${zeroPct}%` }} />

          <div className={styles.cols} aria-hidden="true" onMouseLeave={() => setHover(null)}>
            {data.map((d, i) => (
              <div
                key={d.month}
                className={`${styles.col} ${hover === i ? styles.hot : ""}`}
                onMouseEnter={() => setHover(i)}
              >
                <div className={styles.upCell} style={{ height: `${zeroPct}%` }}>
                  <span
                    className={styles.barUp}
                    style={{
                      height: topMax > 0 ? `${(d.rent / topMax) * 100}%` : 0,
                      minHeight: d.rent > 0 ? 2 : 0,
                    }}
                  />
                </div>
                <div className={styles.downCell} style={{ height: `${100 - zeroPct}%` }}>
                  <span
                    className={styles.barDown}
                    style={{
                      height: bottomMax > 0 ? `${(d.expense / bottomMax) * 100}%` : 0,
                      minHeight: d.expense > 0 ? 2 : 0,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.xaxis} aria-hidden="true">
        {data.map((d) => {
          const p = monthParts(d.month);
          return (
            <span key={d.month} className={`${styles.xlabel} ${p.isJanuary ? styles.year : ""}`}>
              <span className={styles.xlong}>{p.isJanuary ? p.year : p.long}</span>
              <span className={styles.xshort}>{p.isJanuary ? p.year.slice(2) : p.short}</span>
            </span>
          );
        })}
      </div>

      <button type="button" className={styles.tableToggle} onClick={() => setShowTable((v) => !v)}>
        {showTable ? "Hide the numbers" : "Show the numbers"}
      </button>

      {showTable && (
        <div className={styles.dataTableWrap}>
          <table className={styles.dataTable}>
            <thead>
              <tr>
                <th>Month</th>
                <th>Rent in</th>
                <th>Money out</th>
                <th>Net</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.month}>
                  <td>{monthParts(d.month).full}</td>
                  <td className="num">{money.format(d.rent)}</td>
                  <td className="num">{money.format(d.expense)}</td>
                  <td className="num">
                    {d.rent - d.expense < 0 ? "−" : ""}
                    {money.format(Math.abs(d.rent - d.expense))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  );
}
