"use client";

import { useMemo, useRef, useState } from "react";
import Modal from "./Modal";
import ConfirmDialog, { type ConfirmRequest } from "./ConfirmDialog";
import styles from "../dashboard/dashboard.module.css";
import { formatDay } from "@/lib/lease";
import {
  KINDS,
  byUrgency,
  expiryLabel,
  expiryState,
  type DocumentDTO,
} from "@/lib/documents";

/** Something a document can be filed against: "property:ID", "tenant:ID" or "vendor:ID". */
export type DocTarget = { key: string; label: string };

const EMPTY_EDIT = { id: "", title: "", kind: "Other", expiresOn: "", note: "", shared: false, tenant: false };

/**
 * A list of documents with their expiry dates, and the forms to add, change
 * and remove them. Used wherever documents belong to something — a property
 * and its tenants, or the vendor book.
 */
export default function DocumentsPanel({
  initial,
  targets,
  today,
  canDelete,
  storageReady,
  onToast,
  emptyText = "Nothing filed yet.",
}: {
  initial: DocumentDTO[];
  targets: DocTarget[];
  /** YYYY-MM-DD, from the parent, so expiry states agree with the rest of the page. */
  today: string;
  canDelete: boolean;
  storageReady: boolean;
  onToast: (message: string, tone?: "bad") => void;
  emptyText?: string;
}) {
  const [docs, setDocs] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(EMPTY_EDIT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null);
  const [upload, setUpload] = useState({
    target: targets[0]?.key ?? "",
    title: "",
    kind: "Lease",
    expiresOn: "",
    note: "",
    shared: false,
  });
  const fileRef = useRef<HTMLInputElement>(null);

  const sorted = useMemo(() => byUrgency(docs, today), [docs, today]);
  const uploadingForTenant = upload.target.startsWith("tenant:");

  function openUpload() {
    setError("");
    setUpload((u) => ({ ...u, target: u.target || targets[0]?.key || "", title: "", expiresOn: "", note: "", shared: false }));
    setAdding(true);
  }

  async function submitUpload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a file.");
      return;
    }
    const [kind, id] = upload.target.split(":");
    const form = new FormData();
    form.set("file", file);
    form.set(kind === "tenant" ? "tenantId" : kind === "vendor" ? "vendorId" : "propertyId", id);
    form.set("title", upload.title);
    form.set("kind", upload.kind);
    form.set("expiresOn", upload.expiresOn);
    form.set("note", upload.note);
    form.set("shared", upload.shared && kind === "tenant" ? "1" : "0");

    setBusy(true);
    setError("");
    const res = await fetch("/api/documents", { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data?.error || "Couldn't upload that.");
      return;
    }
    setDocs((prev) => [data, ...prev]);
    setAdding(false);
    onToast(`${data.title} filed.`);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch(`/api/documents/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: editing.title,
        kind: editing.kind,
        expiresOn: editing.expiresOn,
        note: editing.note,
        shared: editing.shared,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data?.error || "Couldn't save that.");
      return;
    }
    setDocs((prev) => prev.map((d) => (d.id === data.id ? data : d)));
    setEditing(EMPTY_EDIT);
    onToast("Saved.");
  }

  function remove(d: DocumentDTO) {
    setConfirming({
      title: `Delete ${d.title}?`,
      body: "The file is deleted too. If this is the only copy, it's gone for good.",
      confirmLabel: "Delete",
      danger: true,
      onConfirm: async () => {
        const res = await fetch(`/api/documents/${d.id}`, { method: "DELETE" });
        setConfirming(null);
        if (!res.ok) {
          onToast("Couldn't delete that.", "bad");
          return;
        }
        setDocs((prev) => prev.filter((x) => x.id !== d.id));
        setEditing(EMPTY_EDIT);
        onToast(`${d.title} deleted.`);
      },
    });
  }

  return (
    <>
      {sorted.length === 0 ? (
        <p className={styles.helpText} style={{ marginTop: 0 }}>
          {emptyText}
        </p>
      ) : (
        <ul className={styles.docList}>
          {sorted.map((d) => {
            const state = expiryState(d.expiresOn, today);
            return (
              <li key={d.id}>
                <a className={styles.docMain} href={d.url} target="_blank" rel="noopener noreferrer">
                  <span className={styles.docTitle}>{d.title}</span>
                  <span className={styles.docMeta}>
                    {d.kind}
                    {targets.length > 1 ? ` · ${d.ownerLabel}` : ""}
                    {d.shared ? " · on their portal" : ""}
                  </span>
                </a>
                {d.expiresOn && (
                  <span
                    className={`${styles.docExpiry} ${
                      state === "expired" ? styles.docExpired : state === "soon" ? styles.docSoon : ""
                    }`}
                  >
                    {expiryLabel(d.expiresOn, today, formatDay)}
                  </span>
                )}
                <button
                  type="button"
                  className={styles.portalLink}
                  onClick={() => {
                    setError("");
                    setEditing({
                      id: d.id,
                      title: d.title,
                      kind: d.kind,
                      expiresOn: d.expiresOn,
                      note: d.note,
                      shared: d.shared,
                      tenant: Boolean(d.tenantId),
                    });
                  }}
                >
                  Edit
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div style={{ marginTop: 12 }}>
        <button
          type="button"
          className={`${styles.btn} ${styles.small}`}
          onClick={openUpload}
          disabled={targets.length === 0}
        >
          + Add a document
        </button>
      </div>

      <Modal
        open={adding}
        title="Add a document"
        subtitle="A lease, an insurance certificate, a licence — with the date it runs out, and you'll be told before it does."
        onClose={() => setAdding(false)}
      >
        {!storageReady ? (
          <div className={styles.errorBar} style={{ marginTop: 0 }}>
            File storage isn&apos;t set up yet, so documents can&apos;t be uploaded.
          </div>
        ) : (
          <form onSubmit={submitUpload}>
            {error && <div className={styles.errorBar} style={{ marginTop: 0, marginBottom: 14 }}>{error}</div>}
            <div className={`${styles.fieldGrid} ${styles.modalGrid}`}>
              <div className={`${styles.field} ${styles.span4}`}>
                <label htmlFor="doc-file">File (PDF or photo, up to 4 MB)</label>
                <input id="doc-file" ref={fileRef} type="file" accept="application/pdf,image/*" required />
              </div>
              {targets.length > 1 && (
                <div className={`${styles.field} ${styles.span4}`}>
                  <label htmlFor="doc-target">Whose is it</label>
                  <select
                    id="doc-target"
                    value={upload.target}
                    onChange={(e) => setUpload((u) => ({ ...u, target: e.target.value }))}
                  >
                    {targets.map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className={`${styles.field} ${styles.wide}`}>
                <label htmlFor="doc-title">Name</label>
                <input
                  id="doc-title"
                  type="text"
                  placeholder="Taken from the file if left blank"
                  value={upload.title}
                  onChange={(e) => setUpload((u) => ({ ...u, title: e.target.value }))}
                />
              </div>
              <div className={`${styles.field} ${styles.wide}`}>
                <label htmlFor="doc-kind">Kind</label>
                <select
                  id="doc-kind"
                  value={upload.kind}
                  onChange={(e) => setUpload((u) => ({ ...u, kind: e.target.value }))}
                >
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>
              <div className={`${styles.field} ${styles.wide}`}>
                <label htmlFor="doc-expires">Expires on</label>
                <input
                  id="doc-expires"
                  type="date"
                  value={upload.expiresOn}
                  onChange={(e) => setUpload((u) => ({ ...u, expiresOn: e.target.value }))}
                />
              </div>
              <div className={`${styles.field} ${styles.wide}`}>
                <label htmlFor="doc-note">Note</label>
                <input
                  id="doc-note"
                  type="text"
                  value={upload.note}
                  onChange={(e) => setUpload((u) => ({ ...u, note: e.target.value }))}
                />
              </div>
              {uploadingForTenant && (
                <label className={`${styles.checkboxField} ${styles.span4}`}>
                  <input
                    type="checkbox"
                    checked={upload.shared}
                    onChange={(e) => setUpload((u) => ({ ...u, shared: e.target.checked }))}
                  />
                  Show it on their portal so they can download it
                </label>
              )}
            </div>
            <div className={styles.formFoot}>
              <button type="button" className={`${styles.btn} ${styles.quiet}`} onClick={() => setAdding(false)}>
                Cancel
              </button>
              <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={busy}>
                {busy ? "Uploading…" : "Upload"}
              </button>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={Boolean(editing.id)}
        title="Edit document"
        subtitle="When the renewed one arrives, upload it as a new document and delete this one — or just move the date."
        onClose={() => setEditing(EMPTY_EDIT)}
      >
        <form onSubmit={saveEdit}>
          {error && <div className={styles.errorBar} style={{ marginTop: 0, marginBottom: 14 }}>{error}</div>}
          <div className={`${styles.fieldGrid} ${styles.modalGrid}`}>
            <div className={`${styles.field} ${styles.wide}`}>
              <label htmlFor="doc-e-title">Name</label>
              <input
                id="doc-e-title"
                type="text"
                required
                value={editing.title}
                onChange={(e) => setEditing((d) => ({ ...d, title: e.target.value }))}
              />
            </div>
            <div className={`${styles.field} ${styles.wide}`}>
              <label htmlFor="doc-e-kind">Kind</label>
              <select
                id="doc-e-kind"
                value={editing.kind}
                onChange={(e) => setEditing((d) => ({ ...d, kind: e.target.value }))}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>
            <div className={`${styles.field} ${styles.wide}`}>
              <label htmlFor="doc-e-expires">Expires on</label>
              <input
                id="doc-e-expires"
                type="date"
                value={editing.expiresOn}
                onChange={(e) => setEditing((d) => ({ ...d, expiresOn: e.target.value }))}
              />
            </div>
            <div className={`${styles.field} ${styles.wide}`}>
              <label htmlFor="doc-e-note">Note</label>
              <input
                id="doc-e-note"
                type="text"
                value={editing.note}
                onChange={(e) => setEditing((d) => ({ ...d, note: e.target.value }))}
              />
            </div>
            {editing.tenant && (
              <label className={`${styles.checkboxField} ${styles.span4}`}>
                <input
                  type="checkbox"
                  checked={editing.shared}
                  onChange={(e) => setEditing((d) => ({ ...d, shared: e.target.checked }))}
                />
                Show it on their portal so they can download it
              </label>
            )}
          </div>
          <div className={styles.formFoot}>
            {canDelete && (
              <button
                type="button"
                className={`${styles.btn} ${styles.quiet} ${styles.danger}`}
                style={{ marginRight: "auto" }}
                onClick={() => {
                  const d = docs.find((x) => x.id === editing.id);
                  if (d) remove(d);
                }}
              >
                Delete
              </button>
            )}
            <button type="button" className={`${styles.btn} ${styles.quiet}`} onClick={() => setEditing(EMPTY_EDIT)}>
              Cancel
            </button>
            <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog request={confirming} onCancel={() => setConfirming(null)} />
    </>
  );
}
