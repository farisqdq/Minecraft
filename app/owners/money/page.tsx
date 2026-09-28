import { redirect } from "next/navigation";
import { requireOwnerSession } from "@/lib/owner-access";
import { money } from "@/lib/money";
import { monthKeyOf, monthSeries, monthsEnding, totalsFor } from "@/lib/owners";
import { ownerTransactions } from "@/lib/owners-db";
import OwnerShell from "../OwnerShell";
import styles from "../owners.module.css";

export const dynamic = "force-dynamic";

const SHORT = new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
const shortMonth = (key: string) => SHORT.format(new Date(`${key}-01T00:00:00Z`));

const signed = (n: number) => `${n < 0 ? "−" : ""}${money(Math.abs(n))}`;

/** The last twelve months and the year so far, per property and all together. */
export default async function OwnerMoney() {
  const me = await requireOwnerSession();
  if (!me) redirect("/owners/login");
  const now = new Date();
  const thisMonth = monthKeyOf(now);
  const months = monthsEnding(thisMonth, 12);
  const year = thisMonth.slice(0, 4);

  // Everything from the start of the twelve-month window or of this year,
  // whichever is earlier — one query, then arithmetic.
  const from = new Date(`${months[0] < `${year}-01` ? months[0] : `${year}-01`}-01T00:00:00.000Z`);
  const txns = await ownerTransactions(me.propertyIds, from);

  const combined = monthSeries(txns, months);
  const perProperty = me.properties.map((p) => {
    const own = txns.filter((t) => t.propertyId === p.id);
    return { property: p, series: monthSeries(own, months), ytd: totalsFor(own, year) };
  });
  const ytd = totalsFor(txns, year);
  const showOther = txns.some((t) => t.otherIncome);

  const Series = ({ rows, ytdRow }: { rows: typeof combined; ytdRow: typeof ytd }) => (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Month</th>
            <th>Rent</th>
            {showOther && <th>Other</th>}
            <th>Expenses</th>
            <th>Net</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.month}>
              <td>{shortMonth(m.month)}</td>
              <td>{m.rent ? money(m.rent) : <span className={styles.muted}>—</span>}</td>
              {showOther && <td>{m.other ? money(m.other) : <span className={styles.muted}>—</span>}</td>}
              <td>{m.expense ? money(m.expense) : <span className={styles.muted}>—</span>}</td>
              <td className={m.net < 0 ? styles.neg : ""}>{m.rent || m.other || m.expense ? signed(m.net) : <span className={styles.muted}>—</span>}</td>
            </tr>
          ))}
          <tr className={styles.totalRow}>
            <td>{year} to date</td>
            <td>{money(ytdRow.rent)}</td>
            {showOther && <td>{money(ytdRow.other)}</td>}
            <td>{money(ytdRow.expense)}</td>
            <td className={ytdRow.net < 0 ? styles.neg : ""}>{signed(ytdRow.net)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );

  return (
    <OwnerShell who={me.name}>
      <div className={styles.head}>
        <h1>Income &amp; expenses</h1>
        <p>The last twelve months as recorded by the landlord, and the year so far.</p>
      </div>

      <section className={styles.card}>
        <div className={styles.cardHead}>
          <h2>{year} so far</h2>
          <span className={styles.sub}>{me.properties.length === 1 ? me.properties[0].name : `${me.properties.length} properties`}</span>
        </div>
        <div className={styles.tiles}>
          <div className={styles.tile}>
            <div className={styles.tileLabel}>Rent collected</div>
            <div className={styles.tileValue}>{money(ytd.rent)}</div>
          </div>
          {showOther && (
            <div className={styles.tile}>
              <div className={styles.tileLabel}>Other income</div>
              <div className={styles.tileValue}>{money(ytd.other)}</div>
            </div>
          )}
          <div className={styles.tile}>
            <div className={styles.tileLabel}>Expenses</div>
            <div className={styles.tileValue}>{money(ytd.expense)}</div>
          </div>
          <div className={styles.tile}>
            <div className={styles.tileLabel}>Net</div>
            <div className={`${styles.tileValue} ${ytd.net < 0 ? styles.neg : styles.pos}`}>{signed(ytd.net)}</div>
          </div>
        </div>
      </section>

      {me.properties.length > 1 && (
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h2>All properties together</h2>
            <span className={styles.sub}>by month</span>
          </div>
          <Series rows={combined} ytdRow={ytd} />
        </section>
      )}

      {perProperty.map(({ property, series, ytd: own }) => (
        <section key={property.id} className={styles.card}>
          <div className={styles.cardHead}>
            <h2>{property.name}</h2>
            <span className={styles.sub}>by month</span>
          </div>
          <Series rows={series} ytdRow={own} />
        </section>
      ))}

      <p className={styles.note}>
        Rent is what was received in the month, not what was due. Mortgage principal is not an expense and is not
        shown; interest and escrow are, under their categories.
      </p>
    </OwnerShell>
  );
}
