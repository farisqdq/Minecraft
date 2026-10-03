"use client";

import { useMemo, useRef, useState, type DragEvent } from "react";
import Link from "next/link";
import AppShell from "../../components/AppShell";
import styles from "../dashboard.module.css";
import s from "./import.module.css";
import { readStatement, withRefs, type BankRow, type ColumnMap, type DateOrder } from "@/lib/bank-csv";
import { payeeKey, payeeLabel, samePayee, type Suggestion } from "@/lib/bank-match";
import { EXPENSE_CATEGORIES } from "@/lib/categories";
import { money } from "@/lib/money";
import { rentNote } from "@/lib/quick-record";

type PlaceOption = { key: string; propertyId: string; unitId: string | null; label: string };
export type ImportCompany = { id: string; name: string; places: PlaceOption[] };

type Line = BankRow & { ref: string };

/** What will happen to one line. Starts as the suggestion; edits mark it touched. */
type Decision = {
  action: "rent" | "expense" | "skip";
  /** "propertyId|unitId", or "" when not chosen. */
  place: string;
  category: string;
  detail: string;
  note: string;
  vendorId: string | null;
  recurringExpenseId: string | null;
  touched: boolean;
};

type Filter = "all" | "import" | "check" | "skip";

/** A bank file larger than this is a mistake — a year of a busy account is a few hundred KB. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const PAGE = 100;

const STATUS_LABEL: Partial<Record<Suggestion["status"], string>> = {
  duplicate: "In the ledger",
  imported: "Imported",
  mortgage: "Mortgage",
  deposit: "Deposit",
  transfer: "Transfer",
};

const shortDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const longDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function decisionFrom(sg: Suggestion): Decision {
  return {
    action: sg.action,
    place: sg.propertyId ? `${sg.propertyId}|${sg.unitId ?? ""}` : "",
    category: sg.category,
    detail: sg.detail,
    note: sg.note,
    vendorId: sg.vendorId,
    recurringExpenseId: sg.recurringExpenseId,
    touched: false,
  };
}

function complete(d: Decision) {
  if (d.action === "rent") return Boolean(d.place);
  if (d.action === "expense") return Boolean(d.place && d.category);
  return true;
}

/** Whether a line wants a person's eye before importing. */
function needsLook(d: Decision, sg: Suggestion | undefined) {
  if (d.action !== "skip" && !complete(d)) return true;
  if (d.touched || !sg) return false;
  if (sg.confidence === "guess") return true;
  return d.action === "skip" && sg.confidence === "none" && sg.status === "new";
}

export default function ImportClient({
  openRepairs,
  companies,
  tenantAt,
}: {
  openRepairs?: number;
  companies: ImportCompany[];
  /** "propertyId|unitId" → the one current tenant's name. */
  tenantAt: Record<string, string>;
}) {
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const company = companies.find((c) => c.id === companyId);
  const places = company?.places ?? [];
  const placeByKey = useMemo(() => new Map(places.map((p) => [p.key, p])), [places]);

  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [fileError, setFileError] = useState("");
  const [flip, setFlip] = useState(false);
  const [columns, setColumns] = useState<ColumnMap | null>(null);
  const [dateOrder, setDateOrder] = useState<DateOrder | null>(null);
  const [editingColumns, setEditingColumns] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const statement = useMemo(
    () =>
      file
        ? readStatement(file.text, { flip, columns: columns ?? undefined, dateOrder: dateOrder ?? undefined })
        : null,
    [file, flip, columns, dateOrder]
  );
  // Newest first, the way the ledger reads.
  const lines: Line[] = useMemo(
    () =>
      statement
        ? withRefs(statement.rows).sort((a, b) => b.date.localeCompare(a.date) || a.line - b.line)
        : [],
    [statement]
  );

  const [suggestions, setSuggestions] = useState<Record<string, Suggestion> | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Bumps on every new analysis, so a slow answer for an old file can't land on a new one.
  const analysis = useRef(0);

  const [filter, setFilter] = useState<Filter>("all");
  const [shown, setShown] = useState(PAGE);
  const [offer, setOffer] = useState<{ from: string; refs: string[]; key: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ created: number; alreadyImported: number; rent: number; rentTotal: number; expense: number; expenseTotal: number } | null>(null);

  async function analyze(forLines: Line[], forCompany: string) {
    const run = ++analysis.current;
    setSuggestions(null);
    setDecisions({});
    setOffer(null);
    setError("");
    setShown(PAGE);
    if (forLines.length === 0 || !forCompany) return;
    setLoading(true);
    try {
      const res = await fetch("/api/import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: forCompany,
          rows: forLines.map(({ ref, date, amount, text }) => ({ ref, date, amount, text })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (run !== analysis.current) return;
      if (!res.ok) {
        setError(data.error || "Couldn't match the lines. Try again.");
        return;
      }
      const list = data.suggestions as Suggestion[];
      setSuggestions(Object.fromEntries(list.map((sg) => [sg.ref, sg])));
      setDecisions(Object.fromEntries(list.map((sg) => [sg.ref, decisionFrom(sg)])));
    } catch {
      if (run === analysis.current) setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      if (run === analysis.current) setLoading(false);
    }
  }

  /** Re-reads the file with different settings, then re-matches. */
  function reread(next: { flip?: boolean; columns?: ColumnMap | null; dateOrder?: DateOrder | null }) {
    if (!file) return;
    const f = next.flip ?? flip;
    const c = next.columns === undefined ? columns : next.columns;
    const d = next.dateOrder === undefined ? dateOrder : next.dateOrder;
    if (next.flip !== undefined) setFlip(f);
    if (next.columns !== undefined) setColumns(c);
    if (next.dateOrder !== undefined) setDateOrder(d);
    const st = readStatement(file.text, { flip: f, columns: c ?? undefined, dateOrder: d ?? undefined });
    void analyze(withRefs(st.rows), companyId);
  }

  async function takeFile(f: File | undefined | null) {
    setFileError("");
    setResult(null);
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) {
      setFileError("That file is too large for a bank statement. Export a shorter date range.");
      return;
    }
    const text = await f.text();
    if (/^%PDF|^PK/.test(text.slice(0, 4))) {
      setFileError("That's a PDF or Excel file. Download the CSV version from your bank instead — it's usually under Download or Export.");
      return;
    }
    setFlip(false);
    setColumns(null);
    setDateOrder(null);
    setEditingColumns(false);
    setFilter("all");
    setFile({ name: f.name, text });
    const st = readStatement(text);
    if (st.error && st.rows.length === 0) setEditingColumns(Boolean(st.header.length));
    void analyze(withRefs(st.rows), companyId);
  }

  function reset() {
    analysis.current++;
    setFile(null);
    setSuggestions(null);
    setDecisions({});
    setResult(null);
    setError("");
    setFileError("");
    setLoading(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  function changeCompany(id: string) {
    setCompanyId(id);
    if (lines.length > 0) void analyze(lines, id);
  }

  const lineByRef = useMemo(() => new Map(lines.map((l) => [l.ref, l])), [lines]);

  /** Applies an edit to one line, filling in what the new choice implies. */
  function decide(ref: string, patch: Partial<Decision>) {
    const line = lineByRef.get(ref);
    const current = decisions[ref];
    if (!line || !current) return;
    const sg = suggestions?.[ref];
    const next: Decision = { ...current, ...patch, touched: true };
    if (patch.action === "rent" || (patch.place !== undefined && next.action === "rent")) {
      next.detail = tenantAt[next.place] ?? (current.action === "rent" ? current.detail : "");
      next.note = rentNote(line.date.slice(0, 7));
      next.category = "";
      next.vendorId = null;
      next.recurringExpenseId = null;
    }
    if (patch.action === "expense" && current.action !== "expense") {
      next.category = current.category || (sg?.action === "expense" ? sg.category : "");
      next.detail = sg?.action === "expense" && sg.detail ? sg.detail : payeeLabel(line.text);
      next.note = "";
    }
    if (patch.place !== undefined && next.action === "expense") {
      // A recurring bill belongs to one property; moving the line breaks the link.
      const was = current.place.split("|")[0];
      if (next.place.split("|")[0] !== was) next.recurringExpenseId = null;
    }
    setDecisions((all) => ({ ...all, [ref]: next }));

    // Offer the same choice to other lines from this payee that nobody has decided yet.
    if (patch.action !== undefined || patch.place !== undefined || patch.category !== undefined) {
      const refs = samePayee(lines, ref).filter((r) => {
        const d = decisions[r];
        const other = suggestions?.[r];
        if (!d || d.touched || !other) return false;
        if (other.status === "duplicate" || other.status === "imported") return false;
        return d.action !== next.action || d.place !== next.place || d.category !== next.category;
      });
      setOffer(refs.length > 0 && next.action !== "skip" ? { from: ref, refs, key: payeeLabel(line.text) } : null);
    }
  }

  function applyOffer() {
    if (!offer) return;
    const from = decisions[offer.from];
    if (!from) return;
    setDecisions((all) => {
      const out = { ...all };
      for (const ref of offer.refs) {
        const line = lineByRef.get(ref);
        const d = out[ref];
        if (!line || !d) continue;
        out[ref] = {
          ...d,
          action: from.action,
          place: from.place,
          category: from.category,
          detail: from.action === "rent" ? tenantAt[from.place] ?? from.detail : from.detail,
          note: from.action === "rent" ? rentNote(line.date.slice(0, 7)) : d.note,
          vendorId: from.action === "expense" ? from.vendorId : null,
          recurringExpenseId: null,
          touched: true,
        };
      }
      return out;
    });
    setOffer(null);
  }

  const counts = useMemo(() => {
    let toImport = 0;
    let check = 0;
    let skip = 0;
    let rent = 0;
    let rentTotal = 0;
    let expense = 0;
    let expenseTotal = 0;
    let incomplete = 0;
    for (const l of lines) {
      const d = decisions[l.ref];
      if (!d) continue;
      if (needsLook(d, suggestions?.[l.ref])) check++;
      if (d.action === "skip") {
        skip++;
        continue;
      }
      toImport++;
      if (!complete(d)) {
        incomplete++;
        continue;
      }
      if (d.action === "rent") {
        rent++;
        rentTotal += Math.abs(l.amount);
      } else {
        expense++;
        expenseTotal += Math.abs(l.amount);
      }
    }
    return { toImport, check, skip, rent, rentTotal, expense, expenseTotal, incomplete, ready: rent + expense };
  }, [lines, decisions, suggestions]);

  const visible = useMemo(
    () =>
      lines.filter((l) => {
        const d = decisions[l.ref];
        if (!d) return filter === "all";
        if (filter === "import") return d.action !== "skip";
        if (filter === "skip") return d.action === "skip";
        if (filter === "check") return needsLook(d, suggestions?.[l.ref]);
        return true;
      }),
    [lines, decisions, suggestions, filter]
  );

  async function doImport() {
    if (!company || counts.ready === 0) return;
    setImporting(true);
    setError("");
    const rows = lines
      .filter((l) => {
        const d = decisions[l.ref];
        return d && d.action !== "skip" && complete(d);
      })
      .map((l) => {
        const d = decisions[l.ref];
        const place = placeByKey.get(d.place)!;
        return {
          ref: l.ref,
          date: l.date,
          amount: Math.abs(l.amount),
          type: d.action,
          propertyId: place.propertyId,
          unitId: place.unitId,
          category: d.action === "expense" ? d.category : null,
          detail: d.detail,
          note: d.note,
          vendorId: d.vendorId,
          recurringExpenseId: d.recurringExpenseId,
          bankText: l.text,
        };
      });
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: company.id, rows }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "The import didn't go through. Nothing was saved.");
        return;
      }
      setResult({
        created: data.created,
        alreadyImported: data.alreadyImported,
        rent: counts.rent,
        rentTotal: counts.rentTotal,
        expense: counts.expense,
        expenseTotal: counts.expenseTotal,
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setError("Couldn't reach the server. Nothing was saved — try again.");
    } finally {
      setImporting(false);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    void takeFile(e.dataTransfer.files?.[0]);
  }

  const range =
    lines.length > 0 ? `${longDay(lines[lines.length - 1].date)} – ${longDay(lines[0].date)}` : "";

  return (
    <AppShell
      openRepairs={openRepairs}
      title="Import from your bank"
      tagline="Upload the CSV your bank exports. Each line is matched to a tenant, a bill or a property before anything is saved."
      back={{ href: "/dashboard", label: "Overview" }}
    >
      {companies.length === 0 ? (
        <div className={styles.firstRun}>
          <h2>No LLCs yet</h2>
          <p>Add an LLC and its properties on the overview first, then come back to import its bank account.</p>
        </div>
      ) : result ? (
        <section className={styles.block}>
          <div className={`${styles.formCard} ${s.done}`}>
            <div className={s.doneMark} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="m5 12.5 4.5 4.5L19 7.5" />
              </svg>
            </div>
            <h2>
              {result.created === 0
                ? "Nothing new to add"
                : `${result.created} ${result.created === 1 ? "entry" : "entries"} added to ${company?.name ?? "the ledger"}`}
            </h2>
            <p className={s.doneLine}>
              {result.rent > 0 && (
                <span>
                  {result.rent} rent {result.rent === 1 ? "payment" : "payments"} ·{" "}
                  <strong className={s.in}>{money(result.rentTotal)}</strong>
                </span>
              )}
              {result.expense > 0 && (
                <span>
                  {result.expense} {result.expense === 1 ? "expense" : "expenses"} ·{" "}
                  <strong className={s.out}>{money(result.expenseTotal)}</strong>
                </span>
              )}
            </p>
            {result.alreadyImported > 0 && (
              <p className={s.doneNote}>
                {result.alreadyImported} {result.alreadyImported === 1 ? "line was" : "lines were"} already imported and left as they were.
              </p>
            )}
            <p className={s.doneNote}>
              Next time, every payee you filed today is filed the same way for you. Each entry can still be edited or
              deleted from the ledger like any other.
            </p>
            <div className={s.doneActions}>
              <Link href="/dashboard" className={`${styles.btn} ${styles.primary}`}>
                See the overview
              </Link>
              <button type="button" className={styles.btn} onClick={reset}>
                Import another file
              </button>
            </div>
          </div>
        </section>
      ) : !file ? (
        <section className={styles.block}>
          <div className={styles.formCard}>
            {companies.length > 1 && (
              <div className={`${styles.field} ${s.companyField}`}>
                <label htmlFor="import-company">Which LLC is this bank account for?</label>
                <select id="import-company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <label
              className={`${s.drop} ${dragging ? s.dragging : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".csv,.txt,text/csv,text/plain,application/vnd.ms-excel"
                className={s.fileInput}
                onChange={(e) => void takeFile(e.target.files?.[0])}
              />
              <svg className={s.dropIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 10.5 12 4l9 6.5" />
                <path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8" />
                <path d="M3 20.5h18" />
              </svg>
              <span className={s.dropTitle}>Choose your bank&apos;s CSV file</span>
              <span className={s.dropSub}>or drop it here</span>
            </label>
            {fileError && <p className={s.fileError}>{fileError}</p>}
            <div className={s.howTo}>
              <p>
                <strong>Getting the file.</strong> In online banking, open the account and look for <em>Download</em> or{" "}
                <em>Export</em> transactions, and choose <em>CSV</em> (sometimes called <em>Spreadsheet</em> or{" "}
                <em>Comma delimited</em>). A month or a quarter at a time is easiest to check. Card statements work too.
              </p>
              <p>
                <strong>What happens to it.</strong> The file is read on this device. Only the lines you choose to import
                are saved — personal spending on the same account stays out of the books, and uploading an overlapping
                statement later never adds a line twice.
              </p>
            </div>
          </div>
        </section>
      ) : (
        <>
          <section className={styles.block}>
            <div className={`${styles.formCard} ${s.fileCard}`}>
              <div className={s.fileHead}>
                <div className={s.fileName}>
                  <strong>{file.name}</strong>
                  <span>
                    {statement?.rows.length ?? 0} {statement?.rows.length === 1 ? "line" : "lines"}
                    {range && ` · ${range}`}
                    {companies.length > 1 && company && ` · ${company.name}`}
                  </span>
                </div>
                <div className={s.fileActions}>
                  {companies.length > 1 && (
                    <select
                      aria-label="LLC"
                      className={s.inlineSelect}
                      value={companyId}
                      onChange={(e) => changeCompany(e.target.value)}
                    >
                      {companies.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <button type="button" className={`${styles.btn} ${styles.small}`} onClick={reset}>
                    Choose another file
                  </button>
                </div>
              </div>

              {statement && statement.columns && !editingColumns && (
                <div className={s.readAs}>
                  <span>
                    Read as{" "}
                    <b>{statement.header[statement.columns.date]}</b> for the date,{" "}
                    <b>{statement.columns.text.map((c) => statement.header[c]).join(" + ")}</b> for the description,{" "}
                    {statement.columns.amount !== null ? (
                      <>
                        <b>{statement.header[statement.columns.amount]}</b> for the amount
                      </>
                    ) : (
                      <>
                        <b>{statement.header[statement.columns.debit!]}</b> out and{" "}
                        <b>{statement.header[statement.columns.credit!]}</b> in
                      </>
                    )}
                    .
                  </span>
                  <button type="button" className={s.link} onClick={() => setEditingColumns(true)}>
                    Change
                  </button>
                  <label className={s.flip}>
                    <input type="checkbox" checked={flip} onChange={(e) => reread({ flip: e.target.checked })} />
                    Money in is shown as negative
                  </label>
                </div>
              )}

              {statement && editingColumns && (
                <ColumnPicker
                  header={statement.header}
                  sample={statement.sample}
                  initial={statement.columns}
                  dateOrder={statement.dateOrder}
                  onCancel={statement.columns ? () => setEditingColumns(false) : undefined}
                  onApply={(c, order) => {
                    setEditingColumns(false);
                    reread({ columns: c, dateOrder: order });
                  }}
                />
              )}

              {statement?.error && !editingColumns && <p className={s.fileError}>{statement.error}</p>}
              {statement && statement.skipped.length > 0 && (
                <details className={s.skippedLines}>
                  <summary>
                    {statement.skipped.length} {statement.skipped.length === 1 ? "line wasn't" : "lines weren't"} read
                  </summary>
                  <ul>
                    {statement.skipped.slice(0, 50).map((k) => (
                      <li key={k.line}>
                        Line {k.line}: {k.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </section>

          {error && <div className={styles.errorBar}>{error}</div>}

          {loading && (
            <p className={s.loading} role="status">
              Matching {lines.length} lines against your tenants, bills and ledger…
            </p>
          )}

          {suggestions && lines.length > 0 && (
            <section className={styles.block}>
              <div className={s.filters} role="group" aria-label="Show">
                {(
                  [
                    ["all", "All", lines.length],
                    ["import", "To import", counts.toImport],
                    ["check", "Worth a look", counts.check],
                    ["skip", "Skipped", counts.skip],
                  ] as [Filter, string, number][]
                ).map(([key, label, n]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={filter === key}
                    className={`${s.filter} ${filter === key ? s.filterOn : ""}`}
                    onClick={() => {
                      setFilter(key);
                      setShown(PAGE);
                    }}
                  >
                    {label} <span className={s.filterCount}>{n}</span>
                  </button>
                ))}
              </div>

              {visible.length === 0 ? (
                <p className={styles.emptyState}>
                  {filter === "check" ? "Nothing needs a second look." : "No lines here."}
                </p>
              ) : (
                <ol className={s.lines}>
                  {visible.slice(0, shown).map((l) => (
                    <LineRow
                      key={l.ref}
                      line={l}
                      sg={suggestions[l.ref]}
                      d={decisions[l.ref]}
                      places={places}
                      onDecide={(patch) => decide(l.ref, patch)}
                      offer={offer?.from === l.ref ? offer : null}
                      onApplyOffer={applyOffer}
                      onDismissOffer={() => setOffer(null)}
                    />
                  ))}
                </ol>
              )}
              {visible.length > shown && (
                <div className={s.more}>
                  <button type="button" className={styles.btn} onClick={() => setShown((n) => n + PAGE)}>
                    Show {Math.min(PAGE, visible.length - shown)} more of {visible.length - shown}
                  </button>
                </div>
              )}

              <div className={s.bar}>
                <div className={s.barText}>
                  {counts.ready === 0 ? (
                    <span>Nothing chosen to import yet.</span>
                  ) : (
                    <span>
                      {counts.rent > 0 && (
                        <>
                          {counts.rent} rent <b className={s.in}>+{money(counts.rentTotal)}</b>
                        </>
                      )}
                      {counts.rent > 0 && counts.expense > 0 && " · "}
                      {counts.expense > 0 && (
                        <>
                          {counts.expense} {counts.expense === 1 ? "expense" : "expenses"}{" "}
                          <b className={s.out}>−{money(counts.expenseTotal)}</b>
                        </>
                      )}
                    </span>
                  )}
                  {counts.incomplete > 0 && (
                    <button type="button" className={s.barWarn} onClick={() => setFilter("check")}>
                      {counts.incomplete} still {counts.incomplete === 1 ? "needs" : "need"} a property or category and will be left out
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.primary}`}
                  disabled={counts.ready === 0 || importing}
                  onClick={doImport}
                >
                  {importing ? "Importing…" : `Import ${counts.ready} ${counts.ready === 1 ? "entry" : "entries"}`}
                </button>
              </div>
            </section>
          )}
        </>
      )}
    </AppShell>
  );
}

function LineRow({
  line,
  sg,
  d,
  places,
  onDecide,
  offer,
  onApplyOffer,
  onDismissOffer,
}: {
  line: Line;
  sg: Suggestion | undefined;
  d: Decision | undefined;
  places: PlaceOption[];
  onDecide: (patch: Partial<Decision>) => void;
  offer: { refs: string[]; key: string } | null;
  onApplyOffer: () => void;
  onDismissOffer: () => void;
}) {
  if (!d || !sg) return null;
  const moneyIn = line.amount > 0;
  const kind = moneyIn ? "rent" : "expense";
  const statusLabel = STATUS_LABEL[sg.status];
  const tone =
    d.touched ? "touched" : statusLabel ? "status" : sg.confidence === "sure" ? "sure" : sg.confidence === "guess" ? "guess" : "none";
  const id = `line-${line.ref.replace(/[^a-z0-9]/gi, "")}`;

  return (
    <li className={`${s.line} ${d.action === "skip" ? s.skipped : ""}`}>
      <div className={s.lineMain}>
        <div className={s.lineDate}>{shortDay(line.date)}</div>
        <div className={s.lineText}>
          <div className={s.bankText} title={line.text}>
            {line.text}
          </div>
          <div className={`${s.why} ${s[`why_${tone}`]}`}>
            {statusLabel && !d.touched && <span className={s.tag}>{statusLabel}</span>}
            {!statusLabel && sg.confidence === "guess" && !d.touched && <span className={`${s.tag} ${s.tagGuess}`}>Check</span>}
            {d.touched ? "Your choice" : sg.why || "Nothing on file matches — choose what this is, or leave it skipped"}
            {sg.status === "mortgage" && sg.propertyId && !d.touched && (
              <>
                {" "}
                <Link href={`/dashboard/properties/${sg.propertyId}`} className={s.whyLink}>
                  Open the loan
                </Link>
              </>
            )}
          </div>
        </div>
        <div className={`${s.lineAmt} ${moneyIn ? s.in : s.out}`}>
          {moneyIn ? "+" : "−"}
          {money(Math.abs(line.amount))}
        </div>
      </div>

      <div className={s.decide}>
        <div className={s.seg} role="radiogroup" aria-label="What this is">
          <button
            type="button"
            role="radio"
            aria-checked={d.action === kind}
            className={d.action === kind ? s.segOn : ""}
            onClick={() => onDecide({ action: kind })}
          >
            {moneyIn ? "Rent" : "Expense"}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={d.action === "skip"}
            className={d.action === "skip" ? s.segOn : ""}
            onClick={() => onDecide({ action: "skip" })}
          >
            Skip
          </button>
        </div>
        {d.action !== "skip" && (
          <>
            <select
              aria-label={moneyIn ? "Rent for" : "Property"}
              className={`${s.pick} ${!d.place ? s.pickMissing : ""}`}
              value={d.place}
              onChange={(e) => onDecide({ place: e.target.value })}
            >
              <option value="">{moneyIn ? "Rent for…" : "Property…"}</option>
              {places.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
            {d.action === "expense" && (
              <select
                aria-label="Category"
                className={`${s.pick} ${!d.category ? s.pickMissing : ""}`}
                value={d.category}
                onChange={(e) => onDecide({ category: e.target.value })}
              >
                <option value="">Category…</option>
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
            <input
              id={id}
              aria-label="Description in the ledger"
              className={s.detail}
              value={d.detail}
              maxLength={200}
              placeholder={moneyIn ? "Tenant" : "Paid to"}
              onChange={(e) => onDecide({ detail: e.target.value })}
            />
          </>
        )}
      </div>

      {offer && (
        <div className={s.offer} role="status">
          <span>
            {offer.refs.length} more {offer.refs.length === 1 ? "line" : "lines"} from <b>{offer.key}</b> — file{" "}
            {offer.refs.length === 1 ? "it" : "them"} the same way?
          </span>
          <button type="button" className={`${styles.btn} ${styles.small} ${styles.primary}`} onClick={onApplyOffer}>
            Apply to {offer.refs.length}
          </button>
          <button type="button" className={`${styles.btn} ${styles.small} ${styles.quiet}`} onClick={onDismissOffer}>
            No
          </button>
        </div>
      )}
    </li>
  );
}

function ColumnPicker({
  header,
  sample,
  initial,
  dateOrder,
  onApply,
  onCancel,
}: {
  header: string[];
  sample: string[][];
  initial: ColumnMap | null;
  dateOrder: DateOrder;
  onApply: (c: ColumnMap, order: DateOrder) => void;
  onCancel?: () => void;
}) {
  const [date, setDate] = useState(initial?.date ?? -1);
  const [text, setText] = useState(initial?.text[0] ?? -1);
  const [memo, setMemo] = useState(initial?.text[1] ?? -1);
  const [split, setSplit] = useState(initial ? initial.amount === null : false);
  const [amount, setAmount] = useState(initial?.amount ?? -1);
  const [debit, setDebit] = useState(initial?.debit ?? -1);
  const [credit, setCredit] = useState(initial?.credit ?? -1);
  const [order, setOrder] = useState<DateOrder>(dateOrder);

  const ok = date >= 0 && text >= 0 && (split ? debit >= 0 && credit >= 0 && debit !== credit : amount >= 0);
  const pick = (label: string, value: number, set: (n: number) => void, optional = false) => (
    <div className={styles.field}>
      <label>{label}</label>
      <select value={value} onChange={(e) => set(Number(e.target.value))}>
        <option value={-1}>{optional ? "(none)" : "Choose…"}</option>
        {header.map((h, i) => (
          <option key={i} value={i}>
            {h || `Column ${i + 1}`}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className={s.picker}>
      <p className={styles.helpText} style={{ marginTop: 0 }}>
        {initial
          ? "Say which column holds what. These are the first lines of the file:"
          : "This file's columns weren't recognised. If it is a bank or card export, say which column holds what — these are its first lines:"}
      </p>
      <div className={s.sampleWrap}>
        <table className={s.sample}>
          <thead>
            <tr>
              {header.map((h, i) => (
                <th key={i}>{h || `Column ${i + 1}`}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sample.map((r, i) => (
              <tr key={i}>
                {header.map((_, c) => (
                  <td key={c}>{r[c] ?? ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={s.pickerGrid}>
        {pick("Date", date, setDate)}
        <div className={styles.field}>
          <label>Dates are written</label>
          <select value={order} onChange={(e) => setOrder(e.target.value as DateOrder)}>
            <option value="mdy">Month first (09/03/2026)</option>
            <option value="dmy">Day first (03/09/2026)</option>
          </select>
        </div>
        {pick("Description", text, setText)}
        {pick("Also read (memo)", memo, setMemo, true)}
        <div className={styles.field}>
          <label>Amounts are in</label>
          <select value={split ? "2" : "1"} onChange={(e) => setSplit(e.target.value === "2")}>
            <option value="1">One column, minus for money out</option>
            <option value="2">Two columns, money out and money in</option>
          </select>
        </div>
        {split ? (
          <>
            {pick("Money out (debits)", debit, setDebit)}
            {pick("Money in (credits)", credit, setCredit)}
          </>
        ) : (
          pick("Amount", amount, setAmount)
        )}
      </div>
      <div className={styles.formFoot}>
        {onCancel && (
          <button type="button" className={styles.btn} onClick={onCancel}>
            Cancel
          </button>
        )}
        <button
          type="button"
          className={`${styles.btn} ${styles.primary}`}
          disabled={!ok}
          onClick={() =>
            onApply(
              {
                date,
                text: memo >= 0 && memo !== text ? [text, memo] : [text],
                amount: split ? null : amount,
                debit: split ? debit : null,
                credit: split ? credit : null,
                sign: null,
              },
              order
            )
          }
        >
          Read the file this way
        </button>
      </div>
    </div>
  );
}
