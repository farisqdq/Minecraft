"use client";

import { useEffect, useRef, useState } from "react";
import { money } from "@/lib/money";
import { monthName, type NoticeDTO } from "@/lib/notices";
import { ago } from "@/lib/maintenance";
import { useNow } from "../components/useNow";
import { useLivePulse } from "../components/useLivePulse";
import styles from "./portal.module.css";

/**
 * What the landlord has asked for, at the top of the portal where it can't be
 * scrolled past.
 *
 * Unread ones are marked as read once they've actually been on screen, not
 * on delivery — the difference between "we sent it" and "they read it" is the
 * whole reason to keep the record.
 */
export default function PortalNotices({
  initial,
  serverNow,
}: {
  initial: NoticeDTO[];
  /** When the server rendered, so the first client render agrees. */
  serverNow: string;
}) {
  const [notices, setNotices] = useState(initial);
  const [showAll, setShowAll] = useState(false);
  const now = useNow(serverNow);
  const marked = useRef(false);

  // A reminder sent while this page is open shows up without a reload.
  useLivePulse("/api/portal/requests/pulse", async () => {
    const res = await fetch("/api/portal/notices", { cache: "no-store" });
    if (!res.ok) return;
    const fresh = await res.json().catch(() => null);
    if (Array.isArray(fresh)) {
      setNotices(fresh);
      marked.current = false;
    }
  });

  const unread = notices.filter((n) => !n.readAt).length;

  useEffect(() => {
    if (unread === 0 || marked.current) return;
    // A short pause so a page you open and immediately leave doesn't count
    // as read. Nothing depends on the request succeeding.
    //
    // The "already done it" flag is set when the request actually goes out,
    // not when the timer is scheduled. Setting it up front looks equivalent
    // and isn't: React mounts, unmounts and remounts effects (in development
    // always, in production whenever a tree is re-created), the cleanup
    // clears the pending timer, and the second run then sees the flag and
    // returns — so the notice would sit unread forever.
    const timer = setTimeout(() => {
      marked.current = true;
      void fetch("/api/portal/notices", { method: "POST" }).catch(() => undefined);
    }, 2500);
    return () => clearTimeout(timer);
  }, [unread]);

  if (notices.length === 0) return null;

  const shown = showAll ? notices : notices.slice(0, 3);

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>From your landlord</h2>
        {unread > 0 && <span className={styles.unreadTag}>{unread} new</span>}
      </div>

      <ul className={styles.noticeList}>
        {shown.map((n) => (
          <li key={n.id} className={`${styles.notice} ${n.readAt ? "" : styles.noticeNew}`}>
            <span className={styles.noticeWhen}>
              {n.kind === "rent" && n.month ? `${monthName(n.month)} rent` : "Message"}
              {n.amount > 0 ? ` · ${money(n.amount)}` : ""} · {ago(n.createdAt, now)}
            </span>
            <span className={styles.noticeBody}>{n.body}</span>
          </li>
        ))}
      </ul>

      {notices.length > 3 && (
        <button type="button" className={styles.cardAction} onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show fewer" : `Show all ${notices.length}`}
        </button>
      )}
    </section>
  );
}
