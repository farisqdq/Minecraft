"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import AppShell from "../../components/AppShell";
import styles from "../dashboard.module.css";
import { useNow } from "../../components/useNow";
import { useLivePulse } from "../../components/useLivePulse";
import { ago } from "@/lib/maintenance";
import { KIND_LABEL, actionCount, type NotificationItem, type NotificationKind } from "@/lib/notifications";

type Filter = "all" | NotificationKind;

const ORDER: NotificationKind[] = ["application", "message", "repair", "document", "lease"];

/**
 * The notification center: new applications, unread messages, repairs
 * nobody has looked at, documents running out and leases ending. Tapping
 * one goes to where it gets dealt with; it leaves this list on its own
 * once it has been.
 */
export default function NotificationsClient({
  userLabel,
  serverNow,
  initial,
  openRepairs,
}: {
  userLabel: string;
  serverNow: string;
  initial: NotificationItem[];
  openRepairs: number;
}) {
  const [items, setItems] = useState(initial);
  const [filter, setFilter] = useState<Filter>("all");
  const now = useNow(serverNow);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data?.items)) setItems(data.items);
    } catch {
      // Offline: keep what's on screen.
    }
  }, []);
  // A message or repair landing while this is open shows within seconds;
  // anything else (an application) on the next visit or the minute tick.
  useLivePulse("/api/requests/pulse", reload, 15000);

  const kinds = ORDER.filter((k) => items.some((i) => i.kind === k));
  const shown = filter === "all" ? items : items.filter((i) => i.kind === filter);
  const todo = actionCount(items);
  const when = (i: NotificationItem) =>
    i.kind === "document" || i.kind === "lease" ? "" : ` · ${ago(i.at, now)}`;

  return (
    <AppShell
      title="Notifications"
      tagline={
        todo > 0
          ? `${todo} thing${todo === 1 ? "" : "s"} need${todo === 1 ? "s" : ""} you. Each one clears itself once it's dealt with.`
          : "You're caught up. New applications, messages, repairs and anything running out will show here."
      }
      userLabel={userLabel}
      openRepairs={openRepairs}
    >
      {kinds.length > 1 && (
        <div className={styles.periodToggle} role="group" aria-label="Show" style={{ marginBottom: 16, flexWrap: "wrap" }}>
          <button type="button" className={filter === "all" ? styles.active : ""} onClick={() => setFilter("all")}>
            All · {items.length}
          </button>
          {kinds.map((k) => (
            <button key={k} type="button" className={filter === k ? styles.active : ""} onClick={() => setFilter(k)}>
              {KIND_LABEL[k]} · {items.filter((i) => i.kind === k).length}
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <div className={styles.ledgerWrap}>
          <div className={styles.emptyState}>Nothing here — you're all caught up.</div>
        </div>
      ) : (
        <div className={styles.repairList}>
          {shown.map((i) => (
            <article key={i.id} className={`${styles.repair} ${i.action ? styles.repairUrgent : ""}`}>
              <Link href={i.href} className={styles.repairHead} style={{ textDecoration: "none" }}>
                <span className={styles.repairTitle}>
                  {i.title}
                  {i.urgent && <span className={styles.urgentTag}>Urgent</span>}
                </span>
                <span className={`${styles.repairStatus} ${i.action ? styles.rs_open : ""}`}>
                  {i.action ? "Needs you" : "Heads-up"}
                </span>
                <span className={styles.repairMeta}>
                  {KIND_LABEL[i.kind]}
                  {when(i)}
                </span>
                {i.detail && <span className={styles.repairWho}>{i.detail}</span>}
              </Link>
            </article>
          ))}
        </div>
      )}
    </AppShell>
  );
}
