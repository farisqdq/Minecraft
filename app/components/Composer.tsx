"use client";

import { useEffect, useRef, useState } from "react";
import { shrinkImage } from "@/lib/shrinkImage";
import { MAX_UPLOAD_BYTES } from "@/lib/blob";
import { MAX_ATTACHMENTS_PER_MESSAGE, MAX_MESSAGE_CHARS, isImageType } from "@/lib/messages";
import styles from "./messages.module.css";

function IconClip(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="m20 11-8.5 8.5a5 5 0 0 1-7-7L13 4a3.3 3.3 0 0 1 4.7 4.7L9.5 17a1.7 1.7 0 0 1-2.4-2.4L15 6.7" />
    </svg>
  );
}

type Pending = { key: number; file: File; preview: string };

/**
 * Where a message is written, on either side. Photos are shrunk in the
 * browser as they're picked — a phone photo is 3-8 MB, and nothing about a
 * leaking tap needs that — so the send is quick and the store stays small.
 * PDFs and anything the browser can't decode go up as they are, and are
 * turned away here if they're over the limit rather than after the upload.
 */
export default function Composer({
  onSend,
  storageReady,
  placeholder,
  sendLabel = "Send",
}: {
  /** Sends and reports back; true clears the box. */
  onSend: (body: string, files: File[]) => Promise<boolean>;
  storageReady: boolean;
  placeholder: string;
  sendLabel?: string;
}) {
  const [body, setBody] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const nextKey = useRef(1);

  // Object URLs for the thumbnails are released when they leave the list.
  useEffect(() => {
    return () => pending.forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pick(files: FileList | null) {
    if (!files) return;
    const room = MAX_ATTACHMENTS_PER_MESSAGE - pending.length;
    const chosen = Array.from(files);
    const kept: Pending[] = [];
    let tooBig = 0;
    for (const raw of chosen.slice(0, Math.max(0, room))) {
      const file = await shrinkImage(raw);
      if (file.size > MAX_UPLOAD_BYTES) {
        tooBig += 1;
        continue;
      }
      kept.push({
        key: nextKey.current++,
        file,
        preview: isImageType(file.type) ? URL.createObjectURL(file) : "",
      });
    }
    setPending((prev) => [...prev, ...kept]);
    const dropped = chosen.length - Math.min(chosen.length, Math.max(0, room));
    const notes: string[] = [];
    if (dropped > 0) notes.push(`${MAX_ATTACHMENTS_PER_MESSAGE} files is the limit for one message; ${dropped} left off.`);
    if (tooBig > 0) notes.push(`${tooBig === 1 ? "One file is" : `${tooBig} files are`} over 4 MB and left off.`);
    setError(notes.join(" "));
    if (input.current) input.current.value = "";
  }

  function remove(key: number) {
    setPending((prev) => {
      const gone = prev.find((p) => p.key === key);
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
      return prev.filter((p) => p.key !== key);
    });
  }

  async function send() {
    const text = body.trim();
    if (!text && pending.length === 0) {
      setError("Type something, or attach a photo.");
      return;
    }
    setBusy(true);
    setError("");
    const ok = await onSend(text, pending.map((p) => p.file));
    setBusy(false);
    if (ok) {
      setBody("");
      pending.forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
      setPending([]);
    }
  }

  const full = pending.length >= MAX_ATTACHMENTS_PER_MESSAGE;

  return (
    <div className={styles.composer}>
      <textarea
        aria-label="Your message"
        placeholder={placeholder}
        maxLength={MAX_MESSAGE_CHARS}
        value={body}
        disabled={busy}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          // Enter alone makes a new line: people write in paragraphs here.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void send();
          }
        }}
      />

      {pending.length > 0 && (
        <div className={styles.pending}>
          {pending.map((p) => (
            <span key={p.key} className={styles.chip}>
              {p.preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.preview} alt="" className={styles.chipThumb} />
              ) : null}
              <span className={styles.chipName}>{p.file.name}</span>
              <button
                type="button"
                className={styles.chipRemove}
                aria-label={`Remove ${p.file.name}`}
                title="Remove"
                onClick={() => remove(p.key)}
                disabled={busy}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.row}>
        {storageReady && (
          <label className={styles.attach} aria-disabled={full || busy}>
            <IconClip className={styles.fileIcon} />
            {pending.length === 0 ? "Attach" : `Attach (${pending.length}/${MAX_ATTACHMENTS_PER_MESSAGE})`}
            <input
              ref={input}
              type="file"
              accept="image/*,.heic,.heif,application/pdf"
              multiple
              disabled={full || busy}
              onChange={(e) => void pick(e.target.files)}
            />
          </label>
        )}
        <span className={styles.hint}>
          {storageReady ? "Photos, or a PDF. Up to 4, each under 4 MB." : ""}
        </span>
        <button type="button" className={styles.send} disabled={busy} onClick={() => void send()}>
          {busy ? "Sending…" : sendLabel}
        </button>
      </div>
    </div>
  );
}
