import { redirect } from "next/navigation";
import { requireOwnerSession } from "@/lib/owner-access";
import { moneyRound } from "@/lib/money";
import { computeReturns, percent, portfolioReturns, type PropertyReturns } from "@/lib/returns";
import { returnsDataFor } from "@/lib/returns-db";
import OwnerShell from "../OwnerShell";
import styles from "../owners.module.css";

export const dynamic = "force-dynamic";

const whole = (n: number) => `${n < 0 ? "−" : ""}${moneyRound(Math.abs(n))}`;
const dash = <span className={styles.muted}>—</span>;

function dayLabel(day: string) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/**
 * Each property as an investment (a31), for the owners and investors given
 * a login to it: what it's worth, what's owed, what it earns, and what the
 * cash put in has made. The same arithmetic as the landlord's Returns page
 * (lib/returns), over the owner's properties only. Valuation notes stay
 * with the team; where a value came from is shown.
 */
export default async function OwnerReturns() {
  const me = await requireOwnerSession();
  if (!me) redirect("/owners/login");

  const data = await returnsDataFor({ id: { in: me.propertyIds } });
  const today = new Date().toISOString().slice(0, 10);
  const rows = me.properties.flatMap((p) => {
    const d = data.get(p.id);
    if (!d) return [];
    const latest = d.valuations[0] ?? null;
    return [{ property: p, cashInvested: d.cashInvested, source: latest?.source ?? "", returns: computeReturns({ ...d, today }) }];
  });
  const total = portfolioReturns(rows);
  const anyIncomplete = rows.some((r) => r.returns.missing.length > 0);

  const Figures = ({ r, cash }: { r: PropertyReturns; cash: number | null }) => (
    <div className={styles.tiles}>
      <div className={styles.tile}>
        <div className={styles.tileLabel}>Value</div>
        <div className={styles.tileValue}>{r.value === null ? "—" : moneyRound(r.value)}</div>
        <div className={styles.tileNote}>
          {r.valueFrom === "valuation" && r.valueAsOf ? `As of ${dayLabel(r.valueAsOf)}` : r.valueFrom === "purchase" ? "Purchase price" : "Not recorded"}
        </div>
      </div>
      <div className={styles.tile}>
        <div className={styles.tileLabel}>Equity</div>
        <div className={`${styles.tileValue} ${r.equity !== null && r.equity < 0 ? styles.neg : ""}`}>
          {r.equity === null ? "—" : whole(r.equity)}
        </div>
        <div className={styles.tileNote}>{r.debt > 0 ? `${moneyRound(r.debt)} owed` : "Nothing owed"}</div>
      </div>
      <div className={styles.tile}>
        <div className={styles.tileLabel}>Cap rate</div>
        <div className={styles.tileValue}>{percent(r.capRate)}</div>
        <div className={styles.tileNote}>{r.annualNoi === null ? "Not enough history" : `${moneyRound(r.annualNoi)} NOI a year`}</div>
      </div>
      <div className={styles.tile}>
        <div className={styles.tileLabel}>Cash-on-cash</div>
        <div className={`${styles.tileValue} ${r.cashOnCash !== null && r.cashOnCash < 0 ? styles.neg : ""}`}>{percent(r.cashOnCash)}</div>
        <div className={styles.tileNote}>
          {r.annualCashFlow === null ? "Not enough history" : `${whole(r.annualCashFlow)} cash flow a year`}
          {cash ? ` on ${moneyRound(cash)}` : ""}
        </div>
      </div>
      <div className={styles.tile}>
        <div className={styles.tileLabel}>Total return</div>
        <div className={`${styles.tileValue} ${r.totalReturn !== null && r.totalReturn < 0 ? styles.neg : ""}`}>
          {r.totalReturn === null ? "—" : whole(r.totalReturn)}
        </div>
        <div className={styles.tileNote}>
          {r.irr !== null ? `${percent(r.irr)} a year (IRR)` : r.totalReturnPct !== null ? `${percent(r.totalReturnPct)} on the cash in` : "Needs purchase details"}
        </div>
      </div>
    </div>
  );

  return (
    <OwnerShell who={me.name}>
      <div className={styles.head}>
        <h1>Returns</h1>
        <p>What each property is worth, what&apos;s owed on it, and what it earns — on its own and on the cash put in.</p>
      </div>

      {rows.length > 1 && (
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h2>All properties together</h2>
            <span className={styles.sub}>{rows.length} properties</span>
          </div>
          <div className={styles.tiles}>
            <div className={styles.tile}>
              <div className={styles.tileLabel}>Value</div>
              <div className={styles.tileValue}>{total.valued > 0 ? moneyRound(total.value) : "—"}</div>
              <div className={styles.tileNote}>{total.valued < total.properties ? `${total.properties - total.valued} without a value` : " "}</div>
            </div>
            <div className={styles.tile}>
              <div className={styles.tileLabel}>Equity</div>
              <div className={styles.tileValue}>{total.valued > 0 ? whole(total.equity) : "—"}</div>
              <div className={styles.tileNote}>{total.ltv !== null ? `${percent(total.ltv, 0)} loan-to-value` : " "}</div>
            </div>
            <div className={styles.tile}>
              <div className={styles.tileLabel}>Cap rate</div>
              <div className={styles.tileValue}>{percent(total.capRate)}</div>
              <div className={styles.tileNote}>{moneyRound(total.annualNoi)} NOI a year</div>
            </div>
            <div className={styles.tile}>
              <div className={styles.tileLabel}>Cash-on-cash</div>
              <div className={styles.tileValue}>{percent(total.cashOnCash)}</div>
              <div className={styles.tileNote}>{whole(total.annualCashFlow)} cash flow a year</div>
            </div>
          </div>
        </section>
      )}

      {rows.map(({ property, returns: r, cashInvested, source }) => (
        <section key={property.id} className={styles.card}>
          <div className={styles.cardHead}>
            <h2>{property.name}</h2>
            <span className={styles.sub}>{source ? `Value: ${source}` : r.annualized ? `Owned ${r.monthsInWindow} months` : "Last 12 months"}</span>
          </div>
          <Figures r={r} cash={cashInvested} />
          {r.booksStartLate && r.totalReturn !== null && (
            <p className={styles.tileNote} style={{ marginTop: 10 }}>
              The books here start after the purchase, so cash flow from before then isn&apos;t counted and the total
              return runs low.
            </p>
          )}
        </section>
      ))}

      <p className={styles.note}>
        Net operating income is rent less operating expenses, leaving out mortgage interest and principal. Cap rate
        is that over the value; cash-on-cash is what was left after the mortgage over the cash put in. Total return is
        cash flow since the books began plus equity gained over the cash put in — before selling costs and tax.
        {anyIncomplete ? " A dash means the landlord hasn't recorded what that figure needs yet." : ""}
      </p>
    </OwnerShell>
  );
}
