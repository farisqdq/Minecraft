"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import AppShell from "../../../components/AppShell";
import { Toasts, useToasts } from "../../../components/Toasts";
import Conversation from "../../../components/Conversation";
import Composer from "../../../components/Composer";
import { useNow } from "../../../components/useNow";
import { useLivePulse } from "../../../components/useLivePulse";
import { useMarkRead } from "../../../components/useMarkRead";
import { announceMessagesRead, sendMessage } from "../../../components/messages-client";
import styles from "../../dashboard.module.css";
import { unreadCount, type ThreadDTO } from "@/lib/messages";

/**
 * The landlord's side of one tenant's conversation. Marked read once it
 * has actually been on screen for a moment (useMarkRead), which is what
 * drops the count on the Messages tab.
 */
export default function ThreadClient({
  userLabel,
  serverNow,
  initial,
  tenantActive,
  openRepairs,
  storageReady,
}: {
  userLabel: string;
  /** When the server rendered, so the first client render agrees. */
  serverNow: string;
  initial: ThreadDTO;
  tenantActive: boolean;
  openRepairs: number;
  storageReady: boolean;
}) {
  const { toasts, push, dismiss } = useToasts();
  const [thread, setThread] = useState(initial);
  const now = useNow(serverNow);
  const panel = useRef<HTMLDivElement>(null);
  const tenantId = thread.tenantId;

  async function refresh() {
    const res = await fetch(`/api/messages/${tenantId}`, { cache: "no-store" });
    if (!res.ok) return;
    const fresh = await res.json().catch(() => null);
    if (fresh && Array.isArray(fresh.messages)) setThread(fresh);
  }

  // The tenant writing while this is open redraws it within seconds; the
  // composer's half-typed text is its own state and is left alone.
  useLivePulse("/api/requests/pulse", refresh);

  const unread = unreadCount(thread.messages, "landlord", thread.landlordReadAt || null);

  useMarkRead(panel, unread, () => {
    void fetch(`/api/messages/${tenantId}/read`, { method: "POST" })
      .then(() => {
        const stamp = new Date().toISOString();
        setThread((t) => ({ ...t, landlordReadAt: stamp }));
        announceMessagesRead();
      })
      .catch(() => undefined);
  });

  async function send(body: string, files: File[]) {
    const result = await sendMessage({
      createUrl: `/api/messages/${tenantId}`,
      attachUrl: `/api/messages/${tenantId}/attachments`,
      body,
      files,
    });
    if ("error" in result) {
      push(result.error, "bad");
      return false;
    }
    setThread((t) => ({
      ...t,
      messages: [...t.messages, result.message],
      lastMessageAt: result.message.createdAt,
      landlordReadAt: result.message.createdAt,
    }));
    if (result.failed.length > 0) {
      push(`Sent, but ${result.failed.length === 1 ? "one file" : `${result.failed.length} files`} didn't upload: ${result.failed.join("; ")}`, "bad");
    } else {
      push(tenantActive ? `Sent. ${thread.tenantName} will see it in their portal.` : "Sent. They've moved out, so nobody is told.");
    }
    return true;
  }

  const place = [thread.propertyName, thread.unitName].filter(Boolean).join(" — ");

  return (
    <AppShell
      title={thread.tenantName}
      tagline={`${place}${tenantActive ? "" : " · moved out"}`}
      userLabel={userLabel}
      openRepairs={openRepairs}
      back={{ href: "/dashboard/messages", label: "Messages" }}
      actions={
        <Link href={`/dashboard/properties/${thread.propertyId}#tenant-${tenantId}`} className={styles.btn}>
          Tenant card
        </Link>
      }
    >
      <Toasts toasts={toasts} onDismiss={dismiss} />

      <div className={styles.card} ref={panel}>
        <Conversation
          messages={thread.messages}
          side="landlord"
          readAt={thread.landlordReadAt}
          now={now}
          emptyText={`Nothing yet. Write below and ${thread.tenantName} sees it in their portal, by email and on their phone.`}
        />
        <Composer onSend={send} storageReady={storageReady} placeholder={`Write to ${thread.tenantName}…`} />
      </div>
    </AppShell>
  );
}
