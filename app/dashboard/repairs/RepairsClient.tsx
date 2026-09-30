"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AppShell from "../../components/AppShell";
import Modal from "../../components/Modal";
import { FileLink, ThumbWithActions } from "../../components/FileViewer";
import ConfirmDialog, { type ConfirmRequest } from "../../components/ConfirmDialog";
import { Toasts, useToasts } from "../../components/Toasts";
import styles from "../dashboard.module.css";
import rs from "./repairs.module.css";
import StatusBadge from "../../components/ui/StatusBadge";
import EmptyState from "../../components/ui/EmptyState";
import OverflowMenu from "../../components/ui/OverflowMenu";
import SegmentedControl from "../../components/ui/SegmentedControl";
import { SortHeader, TableWrap, tableStyles as t, useSort } from "../../components/ui/Table";
import { IconPhone, IconTrash, IconUsers, IconWrench, IconX } from "../../components/icons";
import { repairBadge } from "../../components/repair-status";
import { useNow } from "../../components/useNow";
import { useLivePulse } from "../../components/useLivePulse";
import { EXPENSE_CATEGORIES } from "@/lib/categories";
import { formatPhone, smsHref, telHref } from "@/lib/lease";
import { rankForRepair, type VendorDTO } from "@/lib/vendors";
import {
  STATUSES,
  STATUS_LABEL,
  ago,
  isOpen,
  type RequestDTO,
  type RequestStatus,
} from "@/lib/maintenance";

type Filter = "open" | "urgent" | "all";

/** The landlord's copy of a request carries who's on it; the tenant's doesn't. */
type Repair = RequestDTO & { vendorId: string };

export default function RepairsClient({
  userLabel,
  serverToday,
  serverNow,
  initial,
  openCount: initialOpen,
  vendors,
  companyOf,
}: {
  userLabel: string;
  serverToday: string;
  /** When the server rendered, so the first client render agrees. */
  serverNow: string;
  initial: Repair[];
  openCount: number;
  vendors: VendorDTO[];
  /** propertyId → companyId, so a repair only offers its own LLC's vendors. */
  companyOf: Record<string, string>;
}) {
  const router = useRouter();
  const { toasts, push, dismiss } = useToasts();
  const [requests, setRequests] = useState(initial);
  const [filter, setFilter] = useState<Filter>(initialOpen > 0 ? "open" : "all");
  const [openId, setOpenId] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const now = useNow(serverNow);

  // A tenant filing a repair, or replying to one, redraws this page within a
  // few seconds. `current` is derived from `requests`, so a thread that's
  // open on screen picks up the new message too — the reply box and its
  // half-typed text are separate state and are left alone.
  useLivePulse("/api/requests/pulse", async () => {
    const res = await fetch("/api/requests", { cache: "no-store" });
    if (!res.ok) return;
    const fresh = await res.json().catch(() => null);
    if (Array.isArray(fresh)) setRequests(fresh);
  });

  const [expenseFor, setExpenseFor] = useState<RequestDTO | null>(null);
  const [expense, setExpense] = useState({ amount: "", date: serverToday, category: "", detail: "" });
  const [expenseError, setExpenseError] = useState("");
  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null);

  const openCount = requests.filter((r) => isOpen(r.status)).length;
  const urgentCount = requests.filter((r) => r.urgency === "urgent" && isOpen(r.status)).length;

  const shown = useMemo(() => {
    if (filter === "open") return requests.filter((r) => isOpen(r.status));
    if (filter === "urgent") return requests.filter((r) => r.urgency === "urgent" && isOpen(r.status));
    return requests;
  }, [requests, filter]);

  const newCount = requests.filter((r) => r.status === "open").length;
  const scheduledCount = requests.filter((r) => r.status === "scheduled").length;

  // The server's order (urgent first, then longest-waiting) is the default:
  // "priority" ascending keeps it, since sorting is stable.
  const sortCols = useMemo(
    () => ({
      title: (r: Repair) => r.title,
      priority: (r: Repair) => (r.urgency === "urgent" ? 0 : 1),
      status: (r: Repair) => STATUSES.indexOf(r.status),
      property: (r: Repair) => [r.propertyName, r.unitName].filter(Boolean).join(" "),
      tenant: (r: Repair) => r.tenantName,
      vendor: (r: Repair) => vendors.find((v) => v.id === r.vendorId)?.name ?? "",
      age: (r: Repair) => new Date(r.createdAt),
    }),
    [vendors]
  );
  const { rows, sort, toggle } = useSort(shown, sortCols, { key: "priority", dir: "asc" });

  const current = requests.find((r) => r.id === openId) ?? null;

  function merge(fresh: Repair) {
    setRequests((prev) => prev.map((r) => (r.id === fresh.id ? fresh : r)));
  }

  async function setStatus(r: RequestDTO, status: RequestStatus) {
    setBusy(true);
    const res = await fetch(`/api/requests/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const fresh = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok || !fresh) {
      push("Couldn't update that.", "bad");
      return;
    }
    merge(fresh);
    push(`Marked ${STATUS_LABEL[status].landlord.toLowerCase()}. ${r.tenantName || "The tenant"} can see it.`);
    router.refresh();
  }

  async function setVendor(r: Repair, vendorId: string) {
    setBusy(true);
    const res = await fetch(`/api/requests/${r.id}/vendor`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendorId: vendorId || null }),
    });
    const fresh = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok || !fresh) {
      push(fresh?.error || "Couldn't change that.", "bad");
      return;
    }
    merge(fresh);
    const who = vendors.find((v) => v.id === vendorId);
    push(who ? `${who.name} is on it.` : "Nobody assigned.");
  }

  async function sendReply(r: RequestDTO) {
    if (!reply.trim()) return;
    setBusy(true);
    const res = await fetch(`/api/requests/${r.id}/updates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: reply }),
    });
    const fresh = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok || !fresh) {
      push("Couldn't send that.", "bad");
      return;
    }
    merge(fresh);
    setReply("");
    push("Sent.");
  }

  /**
   * Take one line out of the thread. No confirm, matching how a proof photo
   * comes off a ledger entry — the control is small and only shows on hover,
   * so it isn't next to anything you'd be reaching for.
   */
  async function removeUpdate(r: RequestDTO, updateId: string, isStatus: boolean) {
    const res = await fetch(`/api/requests/${r.id}/updates/${updateId}`, { method: "DELETE" });
    const fresh = await res.json().catch(() => null);
    if (!res.ok || !fresh) {
      push("Couldn't delete that.", "bad");
      return;
    }
    merge(fresh);
    push(isStatus ? "Status line removed." : "Message deleted.");
  }

  /**
   * Throw the whole report away. Unlike a single thread line this asks first:
   * it takes the tenant's words, their photos and the history with it, and
   * there is no undo.
   */
  function removeRequest(r: RequestDTO) {
    const bits = [
      r.photos.length > 0 &&
        `${r.photos.length} ${r.photos.length === 1 ? "photo" : "photos"}`,
      r.updates.length > 0 &&
        `${r.updates.length} ${r.updates.length === 1 ? "line" : "lines"} of history`,
    ].filter(Boolean);
    setConfirming({
      title: "Delete this report?",
      body: `"${r.title}" from ${r.tenantName || "a tenant"}${
        bits.length ? `, along with ${bits.join(" and ")}` : ""
      }. It disappears from their portal too, and it can't be undone.${
        r.loggedAsExpense
          ? " What it cost stays on the ledger — deleting the report doesn't touch the books."
          : ""
      }`,
      confirmLabel: "Delete report",
      danger: true,
      onConfirm: async () => {
        const res = await fetch(`/api/requests/${r.id}`, { method: "DELETE" });
        if (!res.ok) {
          push("Couldn't delete that.", "bad");
          return;
        }
        const data = await res.json().catch(() => ({}));
        setRequests((prev) => prev.filter((x) => x.id !== r.id));
        setOpenId("");
        setReply("");
        push(
          data?.keptTransaction
            ? "Report deleted. The expense is still on the ledger."
            : "Report deleted."
        );
        router.refresh();
      },
    });
  }

  function openExpense(r: RequestDTO) {
    setExpenseError("");
    setExpense({
      amount: "",
      date: serverToday,
      // Nearly every repair books here; it's one dropdown change when it doesn't.
      category: EXPENSE_CATEGORIES.find((c) => /repair/i.test(c)) ?? "",
      detail: r.title,
    });
    setExpenseFor(r);
  }

  async function saveExpense(e: React.FormEvent) {
    e.preventDefault();
    if (!expenseFor) return;
    const amount = parseFloat(expense.amount);
    if (!(amount > 0)) {
      setExpenseError("Enter what it cost.");
      return;
    }
    if (!expense.category) {
      setExpenseError("Pick a category.");
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/requests/${expenseFor.id}/expense`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...expense, amount }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setExpenseError(data?.error || "Couldn't log that.");
      return;
    }
    merge(data.request);
    setExpenseFor(null);
    push("Logged to the ledger and marked done.");
    router.refresh();
  }

  const vendorName = (id: string) => vendors.find((v) => v.id === id)?.name ?? "";

  return (
    <AppShell
      title="Repairs"
      userLabel={userLabel}
      openRepairs={openCount}
      actions={
        <Link href="/dashboard/repairs/vendors" className={styles.btn}>
          <IconUsers size={16} />
          Vendors
        </Link>
      }
    >
      <Toasts toasts={toasts} onDismiss={dismiss} />

      <div className={rs.stats}>
        <div className={rs.stat}>
          <span className={rs.statLabel}>Open</span>
          <span className={`${rs.statValue} num`}>{openCount}</span>
        </div>
        <div className={rs.stat}>
          <span className={rs.statLabel}>Urgent</span>
          <span className={`${rs.statValue} num ${urgentCount > 0 ? rs.statBad : ""}`}>{urgentCount}</span>
        </div>
        <div className={rs.stat}>
          <span className={rs.statLabel}>New, not looked at</span>
          <span className={`${rs.statValue} num`}>{newCount}</span>
        </div>
        <div className={rs.stat}>
          <span className={rs.statLabel}>Scheduled</span>
          <span className={`${rs.statValue} num`}>{scheduledCount}</span>
        </div>
      </div>

      <div className={rs.toolbar}>
        <SegmentedControl<Filter>
          label="Which repairs"
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "open", label: `Open${openCount > 0 ? ` · ${openCount}` : ""}` },
            { value: "urgent", label: `Urgent${urgentCount > 0 ? ` · ${urgentCount}` : ""}` },
            { value: "all", label: `All · ${requests.length}` },
          ]}
        />
      </div>

      {shown.length === 0 ? (
        <div className={rs.emptyCard}>
          <EmptyState
            icon={IconWrench}
            title={
              requests.length === 0
                ? "Nothing reported yet."
                : filter === "urgent"
                  ? "Nothing urgent is open."
                  : "Nothing open — everything reported has been closed out."
            }
            detail={
              requests.length === 0
                ? "Invite a tenant to the portal from their card on a property page and they can report a problem here."
                : undefined
            }
            action={
              requests.length > 0 && filter !== "all" ? (
                <button type="button" className={styles.btn} onClick={() => setFilter("all")}>
                  Show all repairs
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <TableWrap>
          <table className={`${t.table} ${rs.table}`}>
            <thead>
              <tr>
                <SortHeader label="Issue" col="title" sort={sort} onSort={toggle} />
                <SortHeader label="Priority" col="priority" sort={sort} onSort={toggle} />
                <SortHeader label="Status" col="status" sort={sort} onSort={toggle} />
                <SortHeader label="Property" col="property" sort={sort} onSort={toggle} />
                <SortHeader label="Reported by" col="tenant" sort={sort} onSort={toggle} />
                <SortHeader label="Vendor" col="vendor" sort={sort} onSort={toggle} />
                <SortHeader label="Age" col="age" sort={sort} onSort={toggle} numeric firstDir="asc" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const urgent = r.urgency === "urgent";
                return (
                  <tr key={r.id} className={rs.row} onClick={() => setOpenId(r.id)}>
                    <td data-label="Issue">
                      <button
                        type="button"
                        className={rs.titleBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenId(r.id);
                        }}
                      >
                        {r.title}
                      </button>
                      <span className={t.sub}>
                        {r.category}
                        {r.place ? ` · ${r.place}` : ""}
                        {r.photos.length > 0
                          ? ` · ${r.photos.length} ${r.photos.length === 1 ? "photo" : "photos"}`
                          : ""}
                        {r.loggedAsExpense ? " · on the books" : ""}
                      </span>
                    </td>
                    <td data-label="Priority">
                      {urgent ? (
                        <StatusBadge status={isOpen(r.status) ? "late" : "ended"}>Urgent</StatusBadge>
                      ) : (
                        <span className={t.muted}>Normal</span>
                      )}
                    </td>
                    <td data-label="Status">
                      <StatusBadge status={repairBadge(r.status)}>{STATUS_LABEL[r.status].landlord}</StatusBadge>
                    </td>
                    <td data-label="Property" className={rs.clip}>
                      {[r.propertyName, r.unitName].filter(Boolean).join(" — ")}
                    </td>
                    <td data-label="Reported by" className={t.muted}>
                      {r.tenantName || "A tenant"}
                    </td>
                    <td data-label="Vendor" className={r.vendorId ? undefined : t.muted}>
                      {vendorName(r.vendorId) || "—"}
                    </td>
                    <td data-label="Age" className={`${t.num} ${t.muted}`}>
                      {ago(r.createdAt, now)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      )}

      <Modal
        open={Boolean(current)}
        title={current?.title ?? ""}
        subtitle={
          current
            ? `${[current.propertyName, current.unitName].filter(Boolean).join(" — ")} · reported by ${
                current.tenantName || "a tenant"
              } ${ago(current.createdAt, now)}`
            : ""
        }
        onClose={() => {
          setOpenId("");
          setReply("");
        }}
      >
        {current && (
          <div className={rs.panel}>
            <div className={rs.badges}>
              <StatusBadge status={repairBadge(current.status)}>{STATUS_LABEL[current.status].landlord}</StatusBadge>
              {current.urgency === "urgent" && <StatusBadge status="late">Urgent</StatusBadge>}
              <StatusBadge status="neutral" dot={false}>
                {current.category}
                {current.place ? ` · ${current.place}` : ""}
              </StatusBadge>
            </div>

            {current.detail && <p className={rs.detail}>{current.detail}</p>}

            {current.photos.length > 0 && (
              <div className={styles.photoRow}>
                {current.photos.map((p) => (
                  <ThumbWithActions key={p.id} url={p.url} name={p.filename} mime={p.contentType}>
                    <FileLink url={p.url} name={p.filename} mime={p.contentType}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt={p.filename} className={styles.repairPhoto} />
                    </FileLink>
                  </ThumbWithActions>
                ))}
              </div>
            )}

            <dl className={rs.props}>
              <dt>Status</dt>
              <dd>
                <div className={rs.statusGroup} role="group" aria-label="Status">
                  {STATUSES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`${rs.statusBtn} ${current.status === s ? rs.statusOn : ""}`}
                      aria-pressed={current.status === s}
                      disabled={busy || current.status === s}
                      onClick={() => setStatus(current, s)}
                    >
                      {STATUS_LABEL[s].landlord}
                    </button>
                  ))}
                </div>
              </dd>

              {(() => {
                // Only this LLC's book, best match for the category first.
                const pool = rankForRepair(
                  vendors.filter((v) => v.companyId === companyOf[current.propertyId]),
                  current.category
                );
                const on = vendors.find((v) => v.id === current.vendorId);
                return (
                  <>
                    <dt>
                      <label htmlFor="repair-vendor">Who&apos;s fixing it</label>
                    </dt>
                    <dd>
                      <div className={rs.vendorRow}>
                        {pool.length === 0 ? (
                          <span className={rs.note}>
                            No vendors in this LLC&apos;s book yet.{" "}
                            <Link href="/dashboard/repairs/vendors">Add one</Link>
                          </span>
                        ) : (
                          <select
                            id="repair-vendor"
                            className={rs.select}
                            value={current.vendorId}
                            disabled={busy}
                            onChange={(e) => setVendor(current, e.target.value)}
                          >
                            <option value="">Nobody yet</option>
                            {pool.map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.name} — {v.trade}
                              </option>
                            ))}
                          </select>
                        )}
                        {on?.phone && telHref(on.phone) && (
                          <>
                            <a className={`${styles.btn} ${styles.small}`} href={telHref(on.phone)}>
                              <IconPhone size={14} />
                              Call {formatPhone(on.phone)}
                            </a>
                            <a className={`${styles.btn} ${styles.small}`} href={smsHref(on.phone)}>
                              Text
                            </a>
                          </>
                        )}
                      </div>
                      <p className={rs.note}>
                        {on
                          ? "Their cost goes to their total when you log this repair on the books. The tenant isn't told who."
                          : "The tenant isn't told who you send."}
                      </p>
                    </dd>
                  </>
                );
              })()}
            </dl>

            <div className={rs.activity}>
              <h3 className={rs.activityHead}>Activity</h3>
              <ol className={rs.thread}>
                {current.updates.map((u) => (
                  <li
                    key={u.id}
                    className={`${rs.threadItem} ${u.from === "system" ? rs.threadSystem : ""} ${
                      u.from === "tenant" ? rs.threadThem : ""
                    }`}
                  >
                    <span className={rs.threadWho}>
                      {u.from === "system" ? "Status" : u.authorName} · {ago(u.createdAt, now)}
                    </span>
                    <span className={rs.threadBody}>
                      {u.statusTo ? STATUS_LABEL[u.statusTo].landlord : u.body}
                    </span>
                    <button
                      type="button"
                      className={rs.threadDel}
                      aria-label={
                        u.from === "system"
                          ? "Delete this status line"
                          : `Delete this message from ${u.authorName}`
                      }
                      title="Delete"
                      onClick={() => removeUpdate(current, u.id, u.from === "system")}
                    >
                      <IconX size={14} />
                    </button>
                  </li>
                ))}
              </ol>

              <div className={rs.reply}>
                <input
                  type="text"
                  aria-label={`Reply to ${current.tenantName || "the tenant"}`}
                  placeholder={`Reply to ${current.tenantName || "the tenant"}…`}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void sendReply(current);
                    }
                  }}
                />
                <button
                  type="button"
                  className={`${styles.btn} ${styles.small}`}
                  disabled={busy || !reply.trim()}
                  onClick={() => sendReply(current)}
                >
                  Send
                </button>
              </div>
            </div>

            <div className={rs.foot}>
              <OverflowMenu
                label="More actions for this report"
                align="start"
                items={[
                  {
                    label: "Delete report",
                    icon: IconTrash,
                    destructive: true,
                    onSelect: () => removeRequest(current),
                  },
                ]}
              />
              {current.loggedAsExpense ? (
                <span className={rs.note}>This repair is already on the books.</span>
              ) : (
                <button
                  type="button"
                  className={`${styles.btn} ${styles.primary}`}
                  onClick={() => openExpense(current)}
                >
                  Log what it cost
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(expenseFor)}
        title="Log what it cost"
        subtitle={
          expenseFor
            ? `Goes on ${[expenseFor.propertyName, expenseFor.unitName].filter(Boolean).join(" — ")} as an expense and marks this done. Your tenant sees that it's fixed, never the amount.`
            : ""
        }
        narrow
        onClose={() => setExpenseFor(null)}
      >
        <form onSubmit={saveExpense}>
          <div className={`${styles.fieldGrid} ${styles.modalGrid}`}>
            <div className={styles.field}>
              <label htmlFor="x-date">Date</label>
              <input
                id="x-date"
                type="date"
                required
                value={expense.date}
                onChange={(e) => setExpense((f) => ({ ...f, date: e.target.value }))}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="x-amount">Amount ($)</label>
              <input
                id="x-amount"
                type="number"
                min="0"
                step="0.01"
                required
                value={expense.amount}
                onChange={(e) => setExpense((f) => ({ ...f, amount: e.target.value }))}
              />
            </div>
            <div className={`${styles.field} ${styles.wide}`}>
              <label htmlFor="x-category">Category</label>
              <select
                id="x-category"
                required
                value={expense.category}
                onChange={(e) => setExpense((f) => ({ ...f, category: e.target.value }))}
              >
                <option value="">Choose one</option>
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className={`${styles.field} ${styles.span4}`}>
              <label htmlFor="x-detail">Description</label>
              <input
                id="x-detail"
                type="text"
                value={expense.detail}
                onChange={(e) => setExpense((f) => ({ ...f, detail: e.target.value }))}
              />
            </div>
          </div>
          {expenseError && <div className={styles.errorBar}>{expenseError}</div>}
          <div className={styles.formFoot}>
            <button type="button" className={styles.btn} onClick={() => setExpenseFor(null)}>
              Cancel
            </button>
            <button type="submit" className={`${styles.btn} ${styles.accent}`} disabled={busy}>
              {busy ? "Saving…" : "Log it"}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog request={confirming} onCancel={() => setConfirming(null)} />
    </AppShell>
  );
}
