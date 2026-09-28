"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { signOutTo } from "../components/sign-out";
import InstallBanner from "../components/InstallBanner";
import { useLivePulse } from "../components/useLivePulse";
import { MESSAGES_READ_EVENT } from "../components/messages-client";
import styles from "./portal.module.css";

/**
 * The tenant frame: a brand, who you are, the way out — and a count of
 * messages from the landlord they haven't read, which jumps to the
 * Messages card. The count comes from its own small endpoint, refreshed
 * when the page's heartbeat changes and dropped the moment the card marks
 * itself read.
 */
export default function PortalShell({ who, children }: { who: string; children: ReactNode }) {
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/portal/messages/unread", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (typeof data?.count === "number") setUnread(data.count);
    } catch {
      // Offline: keep whatever the badge said.
    }
  }, []);

  useEffect(() => {
    void refresh();
    window.addEventListener(MESSAGES_READ_EVENT, refresh);
    return () => window.removeEventListener(MESSAGES_READ_EVENT, refresh);
  }, [refresh]);

  // The cards on the page poll this already; the badge rides on the same
  // signature at a gentler pace.
  useLivePulse("/api/portal/requests/pulse", refresh, 15000);

  return (
    <div className={styles.shell}>
      <header className={styles.bar}>
        <span className={styles.brand}>
          <span className={styles.mark} aria-hidden="true">
            R
          </span>
          Rent Roll
        </span>
        <span className={styles.spacer} />
        <a
          href="#messages"
          className={`${styles.inboxLink} ${unread > 0 ? styles.inboxLinkNew : ""}`}
          aria-label={unread > 0 ? `Messages, ${unread} unread` : "Messages"}
          title="Messages"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
            strokeLinejoin="round" aria-hidden="true">
            <path d="M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H9l-4.5 3.5V16.5H4A1.5 1.5 0 0 1 2.5 15V7A1.5 1.5 0 0 1 4 5.5Z" />
          </svg>
          {unread > 0 && <span className={styles.inboxBadge}>{unread}</span>}
        </a>
        {who && <span className={styles.who}>{who}</span>}
        <button
          type="button"
          className={styles.signOut}
          onClick={() => signOutTo("/portal/login")}
        >
          Sign out
        </button>
      </header>
      <main className={styles.main}>
        <InstallBanner audience="tenant" />
        {children}
      </main>
    </div>
  );
}
