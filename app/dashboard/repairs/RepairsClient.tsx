"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "../../components/AppShell";
import Modal from "../../components/Modal";
import ConfirmDialog, { type ConfirmRequest } from "../../components/ConfirmDialog";
import { Toasts, useToasts } from "../../components/Toasts";
import styles from "../dashboard.module.css";
import { useNow } from "../../components/useNow";
import { useLivePulse } from "../../components/useLivePulse";
import { EXPENSE_CATEGORIES } from "@/lib/categories";
import {
  STATUSES,
  STATUS_LABEL,
  ago,
  isOpen,
  type RequestDTO,
  type RequestStatus,
} from "@/lib/maintenance";

type Filter = "open" | "urgent" | "all";

export default function RepairsClient({
  userLabel,
  serverToday,
  serverNow,
  initial,
  openCount: initialOpen,
}: {
  userLabel: string;
  serverToday: string;
  /** When the server rendered, so the first client render agrees. */
  serverNow: string;
  initial: RequestDTO[];
  openCount: number;
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

  const current = requests.find((r) => r.id === openId) ?? null;

  function merge(fresh: RequestDTO) {
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

  return (
    <AppShell
      title="Repairs"
      tagline="What your tenants have reported, oldest and most urgent first."
      userLabel={userLabel}
      openRepairs={openCount}
    >
      <Toasts toasts={toasts} onDismiss={dismiss} />

      <div className={styles.periodToggle} role="group" aria-label="Which repairs" style={{ marginBottom: 16 }}>
        <button
          type="button"
          className={filter === "open" ? styles.active : ""}
          onClick={() => setFilter("open")}
        >
          Open{openCount > 0 ? ` · ${openCount}` : ""}
        </button>
        <button
          type="button"
          className={filter === "urgent" ? styles.active : ""}
          onClick={() => setFilter("urgent")}
        >
          Urgent{urgentCount > 0 ? ` · ${urgentCount}` : ""}
        </button>
        <button
          type="button"
          className={filter === "all" ? styles.active : ""}
          onClick={() => setFilter("all")}
        >
          All · {requests.length}
        </button>
      </div>

      {shown.length === 0 ? (
        <div className={styles.ledgerWrap}>
          <div className={styles.emptyState}>
            {requests.length === 0
              ? "Nothing reported yet. Invite a tenant to the portal from their card on a property page and they can report a problem here."
              : filter === "urgent"
                ? "Nothing urgent is open."
                : "Nothing open — everything reported has been closed out."}
          </div>
        </div>
      ) : (
        <div className={styles.repairList}>
          {shown.map((r) => (
            <article
              key={r.id}
              className={`${styles.repair} ${r.urgency === "urgent" && isOpen(r.status) ? styles.repairUrgent : ""}`}
            >
              <button type="button" className={styles.repairHead} onClick={() => setOpenId(r.id)}>
                <span className={styles.repairTitle}>
                  {r.title}
                  {r.urgency === "urgent" && <span className={styles.urgentTag}>Urgent</span>}
                </span>
                <span className={`${styles.repairStatus} ${styles[`rs_${r.status}`] ?? ""}`}>
                  {STATUS_LABEL[r.status].landlord}
                </span>
                <span className={styles.repairMeta}>
                  {[r.propertyName, r.unitName].filter(Boolean).join(" — ")} · {r.category}
                  {r.place ? ` · ${r.place}` : ""}
                </span>
                <span className={styles.repairWho}>
                  {r.tenantName || "A tenant"} · {ago(r.createdAt, now)}
                  {r.photos.length > 0
                    ? ` · ${r.photos.length} ${r.photos.length === 1 ? "photo" : "photos"}`
                    : ""}
                  {r.loggedAsExpense ? " · on the books" : ""}
                </span>
              </button>
            </article>
          ))}
        </div>
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
          <div className={styles.repairPanel}>
            {current.detail && <p className={styles.repairDetail}>{current.detail}</p>}

            {current.photos.length > 0 && (
              <div className={styles.photoRow}>
                {current.photos.map((p) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer">
                    <img src={p.url} alt={p.filename} className={styles.repairPhoto} />
                  </a>
                ))}
              </div>
            )}

            <div className={styles.statusRow}>
              {STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`${styles.btn} ${styles.small} ${
                    current.status === s ? styles.primary : ""
                  }`}
                  disabled={busy || current.status === s}
                  onClick={() => setStatus(current, s)}
                >
                  {STATUS_LABEL[s].landlord}
                </button>
              ))}
            </div>

            <ol className={styles.thread}>
              {current.updates.map((u) => (
                <li
                  key={u.id}
                  className={`${styles.threadItem} ${u.from === "system" ? styles.threadSystem : ""} ${
                    u.from === "tenant" ? styles.threadThem : ""
                  }`}
                >
                  <span className={styles.threadWho}>
                    {u.from === "system" ? "Status" : u.authorName} · {ago(u.createdAt, now)}
                  </span>
                  <span className={styles.threadBody}>
                    {u.statusTo ? STATUS_LABEL[u.statusTo].landlord : u.body}
                  </span>
                  <button
                    type="button"
                    className={styles.threadDel}
                    aria-label={
                      u.from === "system"
                        ? "Delete this status line"
                        : `Delete this message from ${u.authorName}`
                    }
                    title="Delete"
                    onClick={() => removeUpdate(current, u.id, u.from === "system")}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ol>

            <div className={styles.replyRow}>
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

            <div className={styles.formFoot} style={{ justifyContent: "space-between" }}>
              <button
                type="button"
                className={`${styles.btn} ${styles.small} ${styles.quiet} ${styles.danger}`}
                onClick={() => removeRequest(current)}
              >
                Delete report
              </button>
              {current.loggedAsExpense ? (
                <span className={styles.helpText}>This repair is already on the books.</span>
              ) : (
                <button
                  type="button"
                  className={`${styles.btn} ${styles.accent}`}
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
