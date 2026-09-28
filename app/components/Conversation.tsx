"use client";

import { ago } from "@/lib/maintenance";
import { formatSize, isImageType, isUnreadFor, type MessageDTO, type Side } from "@/lib/messages";
import styles from "./messages.module.css";

function IconFile(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

/** "Today", "Yesterday", or the date — a divider between days. */
function dayLabel(iso: string, now: Date) {
  const d = new Date(iso);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

/**
 * A thread, oldest at the top, newest at the bottom where the composer is.
 * Yours sit on the right. Anything from the other side you haven't read
 * yet keeps an edge until the page has marked it read.
 */
export default function Conversation({
  messages,
  side,
  readAt,
  now,
  emptyText,
}: {
  messages: MessageDTO[];
  /** Which end of the conversation the reader is on. */
  side: Side;
  /** The reader's own read stamp, for marking what's new to them. */
  readAt: string;
  now: Date;
  emptyText: string;
}) {
  if (messages.length === 0) return <div className={styles.empty}>{emptyText}</div>;

  const mine = (m: MessageDTO) => (side === "tenant" ? m.fromTenant : !m.fromTenant);
  let lastDay = "";

  return (
    <ol className={styles.list}>
      {messages.map((m) => {
        const day = dayLabel(m.createdAt, now);
        const divider = day !== lastDay ? day : "";
        lastDay = day;
        const unread = isUnreadFor(m, side, readAt || null);
        return (
          <li key={m.id} style={{ display: "contents" }}>
            {divider && <span className={styles.day}>{divider}</span>}
            <div className={`${styles.item} ${mine(m) ? styles.mine : ""} ${unread ? styles.unread : ""}`}>
              <span className={styles.who}>
                {mine(m) ? "You" : m.authorName} · {ago(m.createdAt, now)}
              </span>
              {m.body && <div className={styles.bubble}>{m.body}</div>}
              {m.attachments.length > 0 && (
                <div className={styles.files}>
                  {m.attachments.map((a) =>
                    isImageType(a.contentType) ? (
                      <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" title={a.filename}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={a.url} alt={a.filename} className={styles.thumb} loading="lazy" />
                      </a>
                    ) : (
                      <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" className={styles.file}>
                        <IconFile className={styles.fileIcon} />
                        <span className={styles.fileName}>{a.filename}</span>
                        {a.size > 0 && <span className={styles.fileSize}>{formatSize(a.size)}</span>}
                      </a>
                    )
                  )}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
