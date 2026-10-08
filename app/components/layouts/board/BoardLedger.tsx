"use client";

import { useEffect, useMemo, useState } from "react";
import { money } from "@/lib/money";
import { PROOF_ACCEPT } from "@/lib/attachments-ui";
import { monthLabel } from "@/lib/quick-record";
import proofStyles from "../../proof.module.css";
import { FileLink, ThumbWithActions } from "../../FileViewer";
import OverflowMenu from "../../ui/OverflowMenu";
import { IconPencil, IconSearch, IconTrash, IconX } from "../../icons";
import type { DashboardProps } from "../dashboard-props";
import styles from "./Dashboard.module.css";
import { useViewOnly } from "../../ViewOnly";

export type Txn = DashboardProps["initialTransactions"][number];

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const dayLabels = new Map<string, string>();
const fmtDate = (iso: string) => {
  let label = dayLabels.get(iso);
  if (label === undefined) {
    label = DAY.format(new Date(iso + "T00:00:00"));
    dayLabels.set(iso, label);
  }
  return label;
};

type Sort = "newest" | "oldest" | "biggest" | "smallest";
const PAGE = 40;

/**
 * The month's entries under the board. Same data and same actions as
 * Classic's ledger — search (which looks across all time, like Classic's),
 * filters, edit, delete, proof — laid out as rows that stack on a phone.
 */
export default function BoardLedger({
  transactions,
  month,
  properties,
  targetLabel,
  storageReady,
  uploadingFor,
  proofError,
  onEdit,
  onDelete,
  onAttach,
  onRemoveProof,
}: {
  /** Every entry for the LLCs in view, all time. */
  transactions: Txn[];
  month: string;
  properties: { id: string; name: string }[];
  targetLabel: (t: { propertyId: string; unitId: string | null }) => string;
  storageReady: boolean;
  uploadingFor: string;
  proofError: { scope: string; message: string } | null;
  onEdit: (t: Txn) => void;
  onDelete: (t: Txn) => void;
  onAttach: (id: string, files: FileList | null) => void;
  onRemoveProof: (attachmentId: string) => void;
}) {
  const viewOnly = useViewOnly();
  const [query, setQuery] = useState("");
  const [property, setProperty] = useState("");
  const [type, setType] = useState("");
  const [sort, setSort] = useState<Sort>("newest");
  const [limit, setLimit] = useState(PAGE);
  const search = query.trim().toLowerCase();

  useEffect(() => setLimit(PAGE), [search, property, type, month, sort]);

  const haystacks = useMemo(
    () =>
      new Map(
        transactions.map((t) => [
          t.id,
          [targetLabel(t), t.detail, t.note, t.category, t.amount.toFixed(2), fmtDate(t.date)].join(" ").toLowerCase(),
        ])
      ),
    [transactions, targetLabel]
  );

  const rows = useMemo(() => {
    const out = transactions
      .filter((t) => search || t.date.startsWith(month))
      .filter((t) => !property || t.propertyId === property)
      .filter((t) => !type || t.type === type)
      .filter((t) => !search || (haystacks.get(t.id) ?? "").includes(search));
    const by: Record<Sort, (a: Txn, b: Txn) => number> = {
      newest: (a, b) => b.date.localeCompare(a.date),
      oldest: (a, b) => a.date.localeCompare(b.date),
      biggest: (a, b) => b.amount - a.amount,
      smallest: (a, b) => a.amount - b.amount,
    };
    return out.sort((a, b) => by[sort](a, b) || b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  }, [transactions, month, property, type, search, haystacks, sort]);

  const totals = useMemo(() => {
    let rent = 0;
    let expense = 0;
    for (const t of rows) {
      if (t.type === "rent") rent += t.amount;
      else expense += t.amount;
    }
    return { rent, expense };
  }, [rows]);

  const shown = rows.slice(0, limit);

  return (
    <section className={styles.section} aria-labelledby="board-ledger">
      <div className={styles.sectionHead}>
        <h2 id="board-ledger">{search ? "Ledger · search" : `Ledger · ${monthLabel(month)}`}</h2>
        <span className={styles.sectionMeta}>
          {rows.length} {rows.length === 1 ? "entry" : "entries"}
          {totals.rent > 0 && <> · <span className="num">+{money(totals.rent)}</span> in</>}
          {totals.expense > 0 && <> · <span className="num">−{money(totals.expense)}</span> out</>}
        </span>
      </div>
      <div className={styles.ledgerTools}>
        <label className={styles.searchBox}>
          <IconSearch size={16} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search every entry…"
            aria-label="Search the ledger"
          />
          {query && (
            <button type="button" className={styles.clear} onClick={() => setQuery("")} aria-label="Clear search">
              <IconX size={14} />
            </button>
          )}
        </label>
        <select value={property} onChange={(e) => setProperty(e.target.value)} aria-label="Filter by property" className={styles.select}>
          <option value="">All properties</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by type" className={styles.select}>
          <option value="">Rent and expenses</option>
          <option value="rent">Rent only</option>
          <option value="expense">Expenses only</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort the ledger" className={styles.select}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="biggest">Biggest amount</option>
          <option value="smallest">Smallest amount</option>
        </select>
      </div>

      {rows.length === 0 ? (
        <div className={styles.empty}>
          {search
            ? `Nothing matches “${query.trim()}”. Search covers the property, description, note, category, date and amount.`
            : `Nothing recorded in ${monthLabel(month)} yet.`}
        </div>
      ) : (
        <ul className={styles.ledger}>
          {shown.map((t) => (
            <li key={t.id} className={styles.ledgerRow}>
              <span className={styles.ledgerDate}>{fmtDate(t.date)}</span>
              <div className={styles.ledgerMain}>
                <div className={styles.ledgerWhere}>{targetLabel(t)}</div>
                <div className={styles.ledgerDetail}>
                  <span className={`${styles.kind} ${t.type === "rent" ? styles.kindRent : ""}`}>
                    {t.type === "rent" ? "Rent" : t.category || "Expense"}
                  </span>
                  {[t.detail, t.note].filter(Boolean).join(" · ")}
                </div>
                {(t.attachments.length > 0 || (storageReady && !viewOnly)) && (
                  <div className={styles.proofRow}>
                    {t.attachments.map((a) => (
                      <span key={a.id} className={styles.proofItem}>
                        <ThumbWithActions url={a.url} name={a.filename} mime={a.contentType}>
                          <FileLink url={a.url} name={a.filename} mime={a.contentType} title={a.filename}>
                            {a.contentType.startsWith("image/") ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={a.url} alt={a.filename} className={styles.proofThumb} />
                            ) : (
                              <span className={styles.proofFile}>PDF</span>
                            )}
                          </FileLink>
                        </ThumbWithActions>
                        {!viewOnly && (
                          <button
                            type="button"
                            className={styles.proofRemove}
                            aria-label={`Remove ${a.filename}`}
                            onClick={() => onRemoveProof(a.id)}
                          >
                            <IconX size={12} />
                          </button>
                        )}
                      </span>
                    ))}
                    {storageReady && !viewOnly && (
                      <label className={styles.proofAdd}>
                        {uploadingFor === t.id ? "Uploading…" : t.attachments.length > 0 ? "+ Add another" : "+ Attach proof"}
                        <input
                          type="file"
                          multiple
                          accept={PROOF_ACCEPT}
                          className={proofStyles.srOnly}
                          disabled={uploadingFor === t.id}
                          onChange={(e) => {
                            onAttach(t.id, e.target.files);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    )}
                  </div>
                )}
                {proofError?.scope === t.id && <div className={styles.warn}>{proofError.message}</div>}
              </div>
              <span className={`${styles.ledgerAmt} num ${t.type === "rent" ? styles.pos : ""}`}>
                {t.type === "rent" ? "+" : "−"}
                {money(t.amount)}
              </span>
              {!viewOnly && (
                <OverflowMenu
                  label={`Actions for the ${money(t.amount)} entry on ${fmtDate(t.date)}`}
                  items={[
                    { label: "Edit", icon: IconPencil, onSelect: () => onEdit(t) },
                    { label: "Delete", icon: IconTrash, destructive: true, onSelect: () => onDelete(t) },
                  ]}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {rows.length > shown.length && (
        <div className={styles.moreRow}>
          <button type="button" className={styles.btn} onClick={() => setLimit((n) => n + PAGE)}>
            Show {Math.min(PAGE, rows.length - shown.length)} more
          </button>
          <span className={styles.sectionMeta}>
            {shown.length} of {rows.length}
          </span>
        </div>
      )}
    </section>
  );
}
