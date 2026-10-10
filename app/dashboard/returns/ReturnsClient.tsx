"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "../../components/AppShell";
import KpiTile, { KpiRow } from "../../components/ui/KpiTile";
import EmptyState from "../../components/ui/EmptyState";
import { SortHeader, TableWrap, tableStyles, useSort } from "../../components/ui/Table";
import { useViewOnly } from "../../components/ViewOnly";
import r from "../../components/returns.module.css";
import { dayLabel } from "../../components/ReturnsPanel";
import { moneyRound, signedMoney } from "@/lib/money";
import { moneyTone, toneClass } from "@/lib/money-tone";
import { percent, portfolioReturns, type PropertyReturns } from "@/lib/returns";

export type ReturnsRow = {
  id: string;
  name: string;
  address: string;
  companyId: string;
  purchasePrice: number | null;
  purchasedOn: string | null;
  cashInvested: number | null;
  returns: PropertyReturns;
};

type Col = "name" | "value" | "debt" | "equity" | "cap" | "cashFlow" | "coc" | "total";

const COLUMNS: Record<Col, (row: ReturnsRow) => string | number | null> = {
  name: (x) => x.name,
  value: (x) => x.returns.value,
  debt: (x) => x.returns.debt,
  equity: (x) => x.returns.equity,
  cap: (x) => x.returns.capRate,
  cashFlow: (x) => x.returns.annualCashFlow,
  coc: (x) => x.returns.cashOnCash,
  total: (x) => x.returns.totalReturn,
};

function listNames(names: string[]) {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const whole = (n: number) => signedMoney(Math.round(n));

function Tone({ value, children }: { value: number | null; children: React.ReactNode }) {
  return <span className={value === null ? r.zero : toneClass(r, moneyTone(value))}>{children}</span>;
}

/**
 * The portfolio as an investment: one row per property, the totals above.
 * Each figure is defined once, in lib/returns, and explained at the foot of
 * the page in the words an owner would use.
 */
export default function ReturnsClient({
  openRepairs,
  userLabel,
  companies,
  rows,
}: {
  openRepairs: number;
  userLabel: string;
  companies: { id: string; name: string }[];
  rows: ReturnsRow[];
}) {
  const viewOnly = useViewOnly();
  const [companyId, setCompanyId] = useState<string>("all");
  const shown = useMemo(
    () => (companyId === "all" ? rows : rows.filter((x) => x.companyId === companyId)),
    [rows, companyId]
  );
  const total = useMemo(
    () => portfolioReturns(shown.map((x) => ({ returns: x.returns, cashInvested: x.cashInvested }))),
    [shown]
  );
  const { rows: sorted, sort, toggle } = useSort(shown, COLUMNS, { key: "name", dir: "asc" });
  const companyName = new Map(companies.map((c) => [c.id, c.name]));
  const unvalued = total.properties - total.valued;
  const incomplete = shown.filter((x) => x.returns.missing.some((m) => m !== "value")).length;
  const lateBooks = shown.filter((x) => x.returns.booksStartLate && x.returns.totalReturn !== null);

  return (
    <AppShell
      title="Returns"
      tagline="What each property is worth, what's owed on it, and what it earns"
      userLabel={userLabel}
      openRepairs={openRepairs}
    >
      {companies.length > 1 && (
        <div className={r.filters} role="group" aria-label="Which LLC">
          <button type="button" className={r.chip} aria-pressed={companyId === "all"} onClick={() => setCompanyId("all")}>
            All LLCs
          </button>
          {companies.map((c) => (
            <button
              key={c.id}
              type="button"
              className={r.chip}
              aria-pressed={companyId === c.id}
              onClick={() => setCompanyId(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <EmptyState
          title="No properties yet"
          detail="Add a property from the overview, then its purchase details on its page."
          action={
            <Link href="/dashboard" className={r.addLink}>
              Go to the overview
            </Link>
          }
        />
      ) : (
        <>
          <KpiRow>
            <KpiTile
              label="Portfolio value"
              value={total.valued > 0 ? moneyRound(total.value) : "—"}
              hint={
                unvalued === 0
                  ? `${total.properties} ${total.properties === 1 ? "property" : "properties"}`
                  : `${unvalued} of ${total.properties} without a value`
              }
            />
            <KpiTile
              label="Equity"
              value={total.valued > 0 ? whole(total.equity) : "—"}
              hint={total.debt > 0 ? `${moneyRound(total.debt)} owed · ${percent(total.ltv, 0)} LTV` : "Nothing owed"}
            />
            <KpiTile
              label="Net operating income"
              value={moneyRound(total.annualNoi)}
              hint={total.capRate !== null ? `${percent(total.capRate)} cap rate` : "Last 12 months"}
            />
            <KpiTile
              label="Cash flow"
              value={whole(total.annualCashFlow)}
              hint={
                total.cashOnCash !== null ? `${percent(total.cashOnCash)} cash-on-cash` : "After the mortgage, last 12 months"
              }
            />
            <KpiTile
              label="Total return"
              value={total.totalReturn !== null ? whole(total.totalReturn) : "—"}
              hint={
                total.totalReturn !== null && total.cashInvested > 0
                  ? `On ${moneyRound(total.cashInvested)} of cash in`
                  : "Needs values and cash invested"
              }
            />
          </KpiRow>

          <div style={{ marginTop: 16 }}>
            <TableWrap>
              <table className={tableStyles.table}>
                <thead>
                  <tr>
                    <SortHeader label="Property" col="name" sort={sort} onSort={toggle} />
                    <SortHeader label="Value" col="value" sort={sort} onSort={toggle} numeric />
                    <SortHeader label="Owed" col="debt" sort={sort} onSort={toggle} numeric />
                    <SortHeader label="Equity" col="equity" sort={sort} onSort={toggle} numeric />
                    <SortHeader label="Cap rate" col="cap" sort={sort} onSort={toggle} numeric />
                    <SortHeader label="Cash flow / yr" col="cashFlow" sort={sort} onSort={toggle} numeric />
                    <SortHeader label="Cash-on-cash" col="coc" sort={sort} onSort={toggle} numeric />
                    <SortHeader label="Total return" col="total" sort={sort} onSort={toggle} numeric />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((row) => {
                    const ret = row.returns;
                    const owedPct = ret.value && ret.value > 0 ? Math.min(100, (ret.debt / ret.value) * 100) : null;
                    const needsPurchase = ret.missing.some((m) => m !== "value");
                    return (
                      <tr key={row.id}>
                        <td data-label="Property">
                          <div className={r.propName}>
                            <Link href={`/dashboard/properties/${row.id}#investment`}>{row.name}</Link>
                            <small>
                              {companies.length > 1 && companyId === "all" ? `${companyName.get(row.companyId) ?? ""} · ` : ""}
                              {needsPurchase
                                ? viewOnly
                                  ? "No purchase details"
                                  : "Add purchase details"
                                : ret.missing.includes("value")
                                  ? viewOnly
                                    ? "No valuation yet"
                                    : "Add a current value"
                                  : ret.valueFrom === "valuation" && ret.valueAsOf
                                  ? `Valued ${ret.valueAsOf.slice(0, 7) === ret.window.to ? "this month" : dayLabel(ret.valueAsOf)}`
                                  : ""}
                            </small>
                          </div>
                        </td>
                        <td className={tableStyles.num} data-label="Value">
                          {ret.value === null ? <span className={r.zero}>—</span> : moneyRound(ret.value)}
                        </td>
                        <td className={tableStyles.num} data-label="Owed">
                          {ret.debt > 0 ? moneyRound(ret.debt) : <span className={r.zero}>—</span>}
                        </td>
                        <td className={tableStyles.num} data-label="Equity">
                          {ret.equity === null ? (
                            <span className={r.zero}>—</span>
                          ) : (
                            <>
                              <Tone value={ret.equity}>{whole(ret.equity)}</Tone>
                              {owedPct !== null && (
                                <span className={r.miniBar} aria-hidden="true">
                                  <span className={r.owed} style={{ width: `${owedPct}%` }} />
                                  <span className={r.owned} style={{ width: `${100 - owedPct}%` }} />
                                </span>
                              )}
                            </>
                          )}
                        </td>
                        <td className={tableStyles.num} data-label="Cap rate">
                          {ret.capRate === null ? <span className={r.zero}>—</span> : percent(ret.capRate)}
                        </td>
                        <td className={tableStyles.num} data-label="Cash flow / yr">
                          {ret.annualCashFlow === null ? (
                            <span className={r.zero}>—</span>
                          ) : (
                            <Tone value={ret.annualCashFlow}>
                              {whole(ret.annualCashFlow)}
                              {ret.annualized ? "*" : ""}
                            </Tone>
                          )}
                        </td>
                        <td className={tableStyles.num} data-label="Cash-on-cash">
                          {ret.cashOnCash === null ? (
                            <span className={r.zero}>—</span>
                          ) : (
                            <Tone value={ret.cashOnCash}>{percent(ret.cashOnCash)}</Tone>
                          )}
                        </td>
                        <td className={tableStyles.num} data-label="Total return">
                          {ret.totalReturn === null ? (
                            <span className={r.zero}>—</span>
                          ) : (
                            <div className={r.propName} style={{ alignItems: "flex-end" }}>
                              <Tone value={ret.totalReturn}>{whole(ret.totalReturn)}</Tone>
                              <small>
                                {ret.irr !== null
                                  ? `${percent(ret.irr)} a year`
                                  : ret.totalReturnPct !== null
                                    ? `${percent(ret.totalReturnPct)} on cash`
                                    : ""}
                              </small>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          </div>

          {(shown.some((x) => x.returns.annualized) || incomplete > 0 || lateBooks.length > 0) && (
            <p className={r.caveat}>
              {shown.some((x) => x.returns.annualized)
                ? "* Owned for less than a year; scaled up from the months owned. "
                : ""}
              {incomplete > 0 && !viewOnly
                ? `${incomplete} ${incomplete === 1 ? "property needs" : "properties need"} purchase details — open ${
                    incomplete === 1 ? "it" : "one"
                  } and use Investment.`
                : ""}
              {lateBooks.length > 0
                ? ` ${listNames(lateBooks.map((x) => x.name))}: the ledger here starts after ${
                    lateBooks.length === 1 ? "it was" : "they were"
                  } bought, so cash flow from before then isn't counted and the total return and IRR run low.`
                : ""}
            </p>
          )}

          <section className={`${r.card} ${r.explain}`} aria-label="What these mean">
            <div className={r.cardHead}>
              <h3>What these mean</h3>
            </div>
            <dl>
              <div>
                <dt>Value and equity</dt>
                <dd>
                  The latest value you&apos;ve entered (or the purchase price until you do), less what&apos;s still owed on
                  the mortgages entered on each property.
                </dd>
              </div>
              <div>
                <dt>Net operating income</dt>
                <dd>
                  Rent less operating expenses over the last twelve months. Mortgage interest and principal are left out:
                  they&apos;re how you paid for it, not what it costs to run.
                </dd>
              </div>
              <div>
                <dt>Cap rate</dt>
                <dd>
                  Net operating income ÷ value. What the place earns as if it were bought outright — the figure for
                  comparing one property with another, or with what the market pays.
                </dd>
              </div>
              <div>
                <dt>Cash flow and cash-on-cash</dt>
                <dd>
                  What was left after interest and principal, and that as a share of the cash you put in. What your own
                  money is earning this year.
                </dd>
              </div>
              <div>
                <dt>Total return and IRR</dt>
                <dd>
                  Cash flow since the books began, plus equity gained over the cash you put in — what selling today would
                  come to, before selling costs and tax. IRR is that as a yearly rate, weighing when each dollar moved;
                  shown after a year of ownership.
                </dd>
              </div>
              <div>
                <dt>Totals</dt>
                <dd>
                  Rates across properties are worked out from the totals, not averaged, and only from properties that
                  have both halves — a house with no value can&apos;t drag the cap rate down.
                </dd>
              </div>
            </dl>
          </section>
        </>
      )}
    </AppShell>
  );
}
