"use client";

import { useRef, useState } from "react";
import { unreadCount, type ThreadDTO } from "@/lib/messages";
import { useNow } from "../components/useNow";
import { useLivePulse } from "../components/useLivePulse";
import { useMarkRead } from "../components/useMarkRead";
import Conversation from "../components/Conversation";
import Composer from "../components/Composer";
import { announceMessagesRead, sendMessage } from "../components/messages-client";
import styles from "./portal.module.css";

/**
 * The tenant's one conversation with the company that manages their place.
 *
 * Everything from the landlord's side is signed with the company's name —
 * the server does that, this never sees a person's name. Marked read once
 * the card has actually been on screen for a moment (useMarkRead), which
 * is what drops the badge in the bar above.
 */
export default function PortalMessages({
  initial,
  storageReady,
  serverNow,
}: {
  initial: ThreadDTO;
  storageReady: boolean;
  /** When the server rendered, so the first client render agrees. */
  serverNow: string;
}) {
  const [thread, setThread] = useState(initial);
  const [note, setNote] = useState("");
  const now = useNow(serverNow);
  const card = useRef<HTMLElement>(null);

  async function refresh() {
    const res = await fetch("/api/portal/messages", { cache: "no-store" });
    if (!res.ok) return;
    const fresh = await res.json().catch(() => null);
    if (fresh && Array.isArray(fresh.messages)) setThread(fresh);
  }

  // A reply landing while this page is open shows up without a reload.
  useLivePulse("/api/portal/requests/pulse", refresh);

  const unread = unreadCount(thread.messages, "tenant", thread.tenantReadAt || null);

  useMarkRead(card, unread, () => {
    void fetch("/api/portal/messages/read", { method: "POST" })
      .then(() => {
        const stamp = new Date().toISOString();
        setThread((t) => ({ ...t, tenantReadAt: stamp }));
        announceMessagesRead();
      })
      .catch(() => undefined);
  });

  async function send(body: string, files: File[]) {
    setNote("");
    const result = await sendMessage({
      createUrl: "/api/portal/messages",
      attachUrl: "/api/portal/messages/attachments",
      body,
      files,
    });
    if ("error" in result) {
      setNote(result.error);
      return false;
    }
    setThread((t) => ({
      ...t,
      messages: [...t.messages, result.message],
      lastMessageAt: result.message.createdAt,
      tenantReadAt: result.message.createdAt,
    }));
    if (result.failed.length > 0) {
      setNote(
        `Sent, but ${result.failed.length === 1 ? "one file" : `${result.failed.length} files`} didn't upload: ${result.failed.join("; ")}`
      );
    }
    return true;
  }

  return (
    <section className={styles.card} id="messages" ref={card}>
      <div className={styles.cardHead}>
        <h2>Messages</h2>
        {unread > 0 && <span className={styles.unreadTag}>{unread} new</span>}
      </div>
      <p className={styles.soon} style={{ marginBottom: 12 }}>
        A written record between you and {thread.companyName || "your landlord"}. For a repair, use{" "}
        <strong>Report a problem</strong> below so it gets tracked.
      </p>

      <Conversation
        messages={thread.messages}
        side="tenant"
        readAt={thread.tenantReadAt}
        now={now}
        emptyText="Nothing here yet. Anything you send is kept on your record along with the reply."
      />

      {note && <div className={styles.formError} style={{ marginTop: 12 }}>{note}</div>}

      <Composer
        onSend={send}
        storageReady={storageReady}
        placeholder={`Write to ${thread.companyName || "your landlord"}…`}
      />
    </section>
  );
}
