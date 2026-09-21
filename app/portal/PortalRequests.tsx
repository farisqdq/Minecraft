"use client";

import { useRef, useState } from "react";
import {
  MAX_PHOTOS,
  REQUEST_CATEGORIES,
  STATUS_LABEL,
  ago,
  isOpen,
  type RequestDTO,
} from "@/lib/maintenance";
import { useNow } from "../components/useNow";
import styles from "./portal.module.css";

const EMPTY = {
  title: "",
  category: "",
  place: "",
  detail: "",
  urgency: "normal" as "normal" | "urgent",
};

/**
 * The reporting half of the portal: file something, then watch it.
 *
 * Both halves live in one component because the list is the confirmation —
 * hitting send and seeing the thing appear at the top with "Sent" on it is
 * what tells someone it worked.
 */
export default function PortalRequests({
  initial,
  storageReady,
  serverNow,
}: {
  initial: RequestDTO[];
  storageReady: boolean;
  /** When the server rendered, so the first client render agrees. */
  serverNow: string;
}) {
  const [requests, setRequests] = useState(initial);
  const [form, setForm] = useState(EMPTY);
  const [open, setOpen] = useState(initial.length === 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [dropped, setDropped] = useState(0);
  const [expanded, setExpanded] = useState("");
  const [reply, setReply] = useState("");
  const [replying, setReplying] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const now = useNow(serverNow);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) {
      setError("Say in a few words what's wrong.");
      return;
    }
    if (!form.category) {
      setError("Pick what kind of problem it is.");
      return;
    }
    setSaving(true);
    setError("");

    const res = await fetch("/api/portal/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const created = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSaving(false);
      setError(created?.error || "Couldn't send that.");
      return;
    }

    // Photos go up one at a time against the request that now exists. A photo
    // that fails doesn't lose the report — the words are already filed.
    let withPhotos: RequestDTO = created;
    for (const file of photos.slice(0, MAX_PHOTOS)) {
      const data = new FormData();
      data.append("file", file);
      const up = await fetch(`/api/portal/requests/${created.id}/photos`, { method: "POST", body: data });
      const photo = await up.json().catch(() => null);
      if (up.ok && photo) withPhotos = { ...withPhotos, photos: [...withPhotos.photos, photo] };
    }

    setRequests((prev) => [withPhotos, ...prev]);
    setForm(EMPTY);
    setPhotos([]);
    setDropped(0);
    if (fileInput.current) fileInput.current.value = "";
    setSaving(false);
    setOpen(false);
    setExpanded(withPhotos.id);
  }

  async function sendReply(id: string) {
    if (!reply.trim()) return;
    setReplying(id);
    const res = await fetch(`/api/portal/requests/${id}/updates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: reply }),
    });
    const fresh = await res.json().catch(() => null);
    setReplying("");
    if (!res.ok || !fresh) return;
    setRequests((prev) => prev.map((r) => (r.id === id ? fresh : r)));
    setReply("");
  }

  const openCount = requests.filter((r) => isOpen(r.status)).length;

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>Report a problem</h2>
        {!open && (
          <button type="button" className={styles.cardAction} onClick={() => setOpen(true)}>
            + New report
          </button>
        )}
      </div>

      {open && (
        <form onSubmit={submit} className={styles.reportForm}>
          <div className={styles.field}>
            <label htmlFor="r-title">What&apos;s wrong?</label>
            <input
              id="r-title"
              type="text"
              required
              maxLength={120}
              placeholder="e.g. Kitchen sink is leaking"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </div>
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label htmlFor="r-category">Kind of problem</label>
              <select
                id="r-category"
                required
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              >
                <option value="">Choose one</option>
                {REQUEST_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor="r-place">Where is it?</label>
              <input
                id="r-place"
                type="text"
                maxLength={80}
                placeholder="e.g. Upstairs bathroom"
                value={form.place}
                onChange={(e) => setForm((f) => ({ ...f, place: e.target.value }))}
              />
            </div>
          </div>
          <div className={styles.field}>
            <label htmlFor="r-detail">Anything else worth knowing?</label>
            <textarea
              id="r-detail"
              rows={3}
              maxLength={4000}
              placeholder="When it started, what you've tried, when someone can get in…"
              value={form.detail}
              onChange={(e) => setForm((f) => ({ ...f, detail: e.target.value }))}
            />
          </div>

          <div className={styles.urgencyRow}>
            <button
              type="button"
              className={form.urgency === "normal" ? styles.urgencyOn : ""}
              onClick={() => setForm((f) => ({ ...f, urgency: "normal" }))}
            >
              Can wait
            </button>
            <button
              type="button"
              className={form.urgency === "urgent" ? `${styles.urgencyOn} ${styles.urgentOn}` : ""}
              onClick={() => setForm((f) => ({ ...f, urgency: "urgent" }))}
            >
              Needs attention now
            </button>
          </div>
          <p className={styles.soon}>
            No water, no heat, gas, or anything on fire — call, don&apos;t type. This form is checked
            when someone gets to it.
          </p>

          {storageReady && (
            <div className={styles.field}>
              <label htmlFor="r-photos">Photos (up to {MAX_PHOTOS})</label>
              <input
                id="r-photos"
                ref={fileInput}
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? []);
                  setPhotos(picked.slice(0, MAX_PHOTOS));
                  setDropped(Math.max(0, picked.length - MAX_PHOTOS));
                }}
              />
              {photos.length > 0 && (
                <span className={styles.hint}>
                  {photos.length} {photos.length === 1 ? "photo" : "photos"} will be sent with this.
                  {dropped > 0 &&
                    ` The other ${dropped} won't be — ${MAX_PHOTOS} is the limit for one report.`}
                </span>
              )}
            </div>
          )}

          {error && <div className={styles.formError}>{error}</div>}
          <div className={styles.formFoot}>
            {requests.length > 0 && (
              <button type="button" className={styles.btnQuiet} onClick={() => setOpen(false)}>
                Cancel
              </button>
            )}
            <button type="submit" className={styles.btnPrimary} disabled={saving}>
              {saving ? "Sending…" : "Send to your landlord"}
            </button>
          </div>
        </form>
      )}

      {requests.length > 0 && (
        <div className={styles.requestList}>
          <p className={styles.listHead}>
            {openCount > 0
              ? `${openCount} still open`
              : "Nothing open — everything you've reported is closed out."}
          </p>
          {requests.map((r) => {
            const isExpanded = expanded === r.id;
            return (
              <article key={r.id} className={styles.request}>
                <button
                  type="button"
                  className={styles.requestHead}
                  onClick={() => {
                    // Clear the draft when switching: half a sentence about
                    // the sink shouldn't follow you to the door report.
                    if (!isExpanded) setReply("");
                    setExpanded(isExpanded ? "" : r.id);
                  }}
                  aria-expanded={isExpanded}
                >
                  <span className={styles.requestTitle}>
                    {r.title}
                    {r.urgency === "urgent" && <span className={styles.urgentTag}>Urgent</span>}
                  </span>
                  <span className={`${styles.statusTag} ${styles[`s_${r.status}`] ?? ""}`}>
                    {STATUS_LABEL[r.status].tenant}
                  </span>
                  <span className={styles.requestMeta}>
                    {r.category}
                    {r.place ? ` · ${r.place}` : ""} · {ago(r.createdAt, now)}
                  </span>
                </button>

                {isExpanded && (
                  <div className={styles.requestBody}>
                    {r.detail && <p className={styles.requestDetail}>{r.detail}</p>}
                    {r.photos.length > 0 && (
                      <div className={styles.photoRow}>
                        {r.photos.map((p) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer">
                            <img src={p.url} alt={p.filename} className={styles.photo} />
                          </a>
                        ))}
                      </div>
                    )}

                    <ol className={styles.thread}>
                      {r.updates.map((u) => (
                        <li
                          key={u.id}
                          className={`${styles.threadItem} ${
                            u.from === "system" ? styles.threadSystem : ""
                          } ${u.from === "landlord" ? styles.threadThem : ""}`}
                        >
                          <span className={styles.threadWho}>
                            {u.from === "system" ? "Status" : u.authorName} · {ago(u.createdAt, now)}
                          </span>
                          <span className={styles.threadBody}>
                            {u.statusTo ? STATUS_LABEL[u.statusTo].tenant : u.body}
                          </span>
                        </li>
                      ))}
                    </ol>

                    <div className={styles.replyRow}>
                      <input
                        type="text"
                        placeholder={
                          isOpen(r.status) ? "Add something…" : "Still a problem? Say so here."
                        }
                        value={expanded === r.id ? reply : ""}
                        onChange={(e) => setReply(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void sendReply(r.id);
                          }
                        }}
                      />
                      <button
                        type="button"
                        className={styles.btnQuiet}
                        disabled={replying === r.id || !reply.trim()}
                        onClick={() => sendReply(r.id)}
                      >
                        {replying === r.id ? "Sending…" : "Send"}
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
