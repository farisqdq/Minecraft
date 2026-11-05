"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./AssistantPanel.module.css";

type Turn = { role: "user" | "assistant"; text: string; error?: boolean };

const KEY = "rr-assistant-chat";
const EXAMPLES = [
  "Who owes rent right now?",
  "What's the phone number for the tenant at the furniture store?",
  "Which repairs are still open?",
  "How much did we spend on repairs at Maple this year?",
];

/**
 * The office assistant (lib/assistant): a button in the corner of every
 * landlord page that opens a chat. The chat lives in this browser tab only
 * (sessionStorage), so closing the tab forgets it.
 */
export default function AssistantPanel() {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(KEY) || "[]");
      if (Array.isArray(saved)) setTurns(saved);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(turns.slice(-40)));
    } catch {}
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [turns, busy]);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    const next: Turn[] = [...turns, { role: "user", text: q }];
    setTurns(next);
    setDraft("");
    setBusy(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Failed answers aren't sent back: they're our error text, not the assistant's.
        body: JSON.stringify({ messages: next.filter((t) => !t.error).map(({ role, text }) => ({ role, text })) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "The assistant couldn't answer just now.");
      setTurns((t) => [...t, { role: "assistant", text: body.answer + (body.cut ? "\n\n(The answer was cut short.)" : "") }]);
    } catch (err) {
      setTurns((t) => [...t, { role: "assistant", text: (err as Error).message, error: true }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  if (!open) {
    return (
      <button type="button" className={styles.fab} onClick={() => setOpen(true)} aria-label="Ask the assistant">
        <span aria-hidden>✦</span> Ask
      </button>
    );
  }

  return (
    <section className={styles.panel} aria-label="Assistant">
      <header className={styles.head}>
        <strong>Ask about your rentals</strong>
        <span className={styles.headActions}>
          {turns.length > 0 && (
            <button type="button" className={styles.link} onClick={() => setTurns([])} disabled={busy}>
              New chat
            </button>
          )}
          <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label="Close">
            ×
          </button>
        </span>
      </header>
      <div className={styles.list} ref={listRef}>
        {turns.length === 0 && (
          <div className={styles.empty}>
            <p>Ask anything about your properties, tenants, rent, bills, repairs or vendors. It looks it up in your records; it can&apos;t change anything.</p>
            {EXAMPLES.map((e) => (
              <button key={e} type="button" className={styles.example} onClick={() => ask(e)}>
                {e}
              </button>
            ))}
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`${styles.msg} ${t.role === "user" ? styles.mine : styles.theirs} ${t.error ? styles.err : ""}`}>
            {t.text}
          </div>
        ))}
        {busy && <div className={`${styles.msg} ${styles.theirs} ${styles.thinking}`}>Looking it up…</div>}
      </div>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          ask(draft);
        }}
      >
        <textarea
          ref={inputRef}
          className={styles.input}
          value={draft}
          rows={2}
          maxLength={2000}
          placeholder="Type a question…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask(draft);
            }
          }}
        />
        <button type="submit" className={styles.send} disabled={busy || !draft.trim()}>
          Ask
        </button>
      </form>
    </section>
  );
}
