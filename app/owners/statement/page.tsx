import { redirect } from "next/navigation";
import { requireOwnerSession } from "@/lib/owner-access";
import { money } from "@/lib/money";
import { monthName } from "@/lib/notices";
import { isMonthKey, monthKeyOf, monthsEnding, shiftMonth, type OwnerStatement } from "@/lib/owners";
import { ownerStatements } from "@/lib/owners-db";
import OwnerShell from "../OwnerShell";
import MonthPicker from "./MonthPicker";
import { FileLink } from "../../components/FileViewer";
import styles from "../owners.module.css";

export const dynamic = "force-dynamic";

const signed = (n: number) => `${n < 0 ? "−" : ""}${money(Math.abs(n))}`;

function Lines({ s }: { s: OwnerStatement }) {
  return (
    <table className={styles.table}>
      <tbody>
        <tr>
          <td>Rent collected</td>
          <td>{money(s.rentCollected)}</td>
        </tr>
        {s.otherIncome > 0 && (
          <tr>
            <td>
              Other income
              <span className={styles.rowSub}>deposit kept at a move-out</span>
            </td>
            <td>{money(s.otherIncome)}</td>
          </tr>
        )}
        <tr>
          <td>
            <strong>Total income</strong>
          </td>
          <td>
            <strong>{money(s.totalIncome)}</strong>
          </td>
        </tr>
        {s.expenses.length === 0 ? (
          <tr>
            <td className={styles.muted}>No expenses recorded</td>
            <td className={styles.muted}>—</td>
          </tr>
        ) : (
          s.expenses.map((e) => (
            <tr key={e.category}>
              <td>{e.category}</td>
              <td>{money(e.amount)}</td>
            </tr>
          ))
        )}
        <tr>
          <td>
            <strong>Total expenses</strong>
          </td>
          <td>
            <strong>{money(s.totalExpenses)}</strong>
          </td>
        </tr>
        <tr className={styles.totalRow}>
          <td>Net</td>
          <td className={s.net < 0 ? styles.neg : styles.pos}>{signed(s.net)}</td>
        </tr>
      </tbody>
    </table>
  );
}

/** One month, laid out the way an owner statement is: income, expenses by category, net — and a PDF of it. */
export default async function OwnerStatementPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const me = await requireOwnerSession();
  if (!me) redirect("/owners/login");

  const thisMonth = monthKeyOf(new Date());
  const { month: wanted } = await searchParams;
  // Last month by default: the one that's complete.
  const month = isMonthKey(wanted) ? wanted : shiftMonth(thisMonth, -1);
  // Two years back is as far as the picker goes; the URL takes any month.
  const choices = monthsEnding(thisMonth, 24).reverse();
  if (!choices.includes(month)) choices.push(month);

  const { properties, combined } = await ownerStatements(me.properties, month);

  return (
    <OwnerShell who={me.name}>
      <div className={styles.head}>
        <h1>Owner statement</h1>
        <p>{monthName(month)}</p>
      </div>

      <section className={styles.card}>
        <div className={styles.controls}>
          <MonthPicker months={choices} value={month} labels={choices.map(monthName)} />
          {/* Viewed in the app's own file viewer, which has a way back — a
              downloaded PDF in the installed app can leave you with none. */}
          <FileLink
            className={styles.btn}
            url={`/api/owners/statement?month=${month}`}
            name={`owner-statement-${month}.pdf`}
            mime="application/pdf"
          >
            View
          </FileLink>
          <a className={`${styles.btn} ${styles.btnPrimary}`} href={`/api/owners/statement?month=${month}`} download>
            Download PDF
          </a>
        </div>
      </section>

      {properties.map((p) => (
        <section key={p.id} className={styles.card}>
          <div className={styles.cardHead}>
            <h2>{p.name}</h2>
            <span className={styles.sub}>{p.statement.entries === 0 ? "nothing recorded" : `${p.statement.entries} ${p.statement.entries === 1 ? "entry" : "entries"}`}</span>
          </div>
          <Lines s={p.statement} />
        </section>
      ))}

      {properties.length > 1 && (
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h2>All properties together</h2>
            <span className={styles.sub}>{properties.length} properties</span>
          </div>
          <Lines s={combined} />
        </section>
      )}

      <p className={styles.note}>
        Figures are what the landlord has recorded for the month. Mortgage principal is not an expense and is not
        shown.
      </p>
    </OwnerShell>
  );
}
