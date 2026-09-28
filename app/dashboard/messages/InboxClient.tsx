"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "../../components/AppShell";
import styles from "../dashboard.module.css";
import { useNow } from "../../components/useNow";
import { useLivePulse } from "../../components/useLivePulse";
import { ago } from "@/lib/maintenance";
import { sortThreads, type InboxRowDTO } from "@/lib/messages";

type Filter = "unread" | "all";

/**
 * The inbox: one line per tenant you've ever exchanged a message with,
 * newest activity first, with what's waiting on you counted. Rows look
 * like the repair queue's so the two read the same.
 */
export default function InboxClient({
  userLabel,
  serverNow,
  initial,
  openRepairs,
  tenants,
}: {
  userLabel: string;
  /** When the server rendered, so the first client render agrees. */
  serverNow: string;
  initial: InboxRowDTO[];
  openRepairs: number;
  /** Current tenants, for starting a conversation that doesn't exist yet. */
  tenants: { id: string; name: string; place: string; hasPortal: boolean }[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [filter, setFilter] = useState<Filter>(initial.some((r) => r.unread > 0) ? "unread" : "all");
  const [picking, setPicking] = useState(false);
  const now = useNow(serverNow);

  // A tenant writing while this page is open redraws it within seconds.
  useLivePulse("/api/requests/pulse", async () => {
    const res = await fetch("/api/messages", { cache: "no-store" });
    if (!res.ok) return;
    const fresh = await res.json().catch(() => null);
    if (Array.isArray(fresh)) setRows(fresh);
  });

  const unreadTotal = rows.reduce((n, r) => n + r.unread, 0);
  const shown = sortThreads(filter === "unread" ? rows.filter((r) => r.unread > 0) : rows);
  const withoutThread = tenants.filter((t) => !rows.some((r) => r.tenantId === t.id));

  return (
    <AppShell
      title="Messages"
      tagline="Every conversation with a tenant, newest first. Replies go to their portal, by email and to their phone."
      userLabel={userLabel}
      openRepairs={openRepairs}
      actions={
        withoutThread.length > 0 ? (
          picking ? (
            <div className={styles.field} style={{ minWidth: 220 }}>
              <select
                aria-label="Start a conversation with"
                defaultValue=""
                autoFocus
                onBlur={() => setPicking(false)}
                onChange={(e) => {
                  if (e.target.value) router.push(`/dashboard/messages/${e.target.value}`);
                }}
              >
                <option value="">Write to…</option>
                {withoutThread.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} — {t.place}
                    {t.hasPortal ? "" : " (no portal login yet)"}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <button type="button" className={`${styles.btn} ${styles.accent}`} onClick={() => setPicking(true)}>
              New message
            </button>
          )
        ) : undefined
      }
    >
      <div className={styles.periodToggle} role="group" aria-label="Which conversations" style={{ marginBottom: 16 }}>
        <button type="button" className={filter === "unread" ? styles.active : ""} onClick={() => setFilter("unread")}>
          Unread{unreadTotal > 0 ? ` · ${unreadTotal}` : ""}
        </button>
        <button type="button" className={filter === "all" ? styles.active : ""} onClick={() => setFilter("all")}>
          All · {rows.length}
        </button>
      </div>

      {shown.length === 0 ? (
        <div className={styles.ledgerWrap}>
          <div className={styles.emptyState}>
            {rows.length === 0
              ? "No conversations yet. Write to a tenant from their card on a property page, or with New message above; once they have a portal login they can write to you here too."
              : "Nothing unread — you've seen everything your tenants have sent."}
          </div>
        </div>
      ) : (
        <div className={styles.repairList}>
          {shown.map((r) => (
            <article key={r.threadId} className={`${styles.repair} ${r.unread > 0 ? styles.repairUrgent : ""}`}>
              <Link href={`/dashboard/messages/${r.tenantId}`} className={styles.repairHead} style={{ textDecoration: "none" }}>
                <span className={styles.repairTitle}>
                  {r.tenantName}
                  {!r.tenantActive && <span className={styles.urgentTag} style={{ background: "var(--surface-3)", color: "var(--muted)" }}>Moved out</span>}
                </span>
                {r.unread > 0 && <span className={`${styles.repairStatus} ${styles.rs_open}`}>{r.unread} new</span>}
                <span className={styles.repairMeta}>
                  {[r.propertyName, r.unitName].filter(Boolean).join(" — ")} · {ago(r.lastMessageAt, now)}
                </span>
                <span className={styles.repairWho}>
                  {r.lastFromTenant ? `${r.tenantName.split(" ")[0]}: ` : "You: "}
                  {r.preview}
                </span>
              </Link>
            </article>
          ))}
        </div>
      )}
    </AppShell>
  );
}
