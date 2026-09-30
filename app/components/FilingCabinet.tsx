"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import AppShell from "./AppShell";
import Modal from "./Modal";
import { FileLink } from "./FileViewer";
import ConfirmDialog, { type ConfirmRequest } from "./ConfirmDialog";
import Scanner, { type ScanProperty, type ScanTenant } from "./Scanner";
import { Toasts, useToasts } from "./Toasts";
import styles from "../dashboard/dashboard.module.css";
import { formatDay } from "@/lib/lease";
import { KINDS, expiryLabel, expiryState, formatSize, type DocumentDTO } from "@/lib/documents";

export type CabinetProperty = ScanProperty & { companyId: string; companyName: string };

const EMPTY_EDIT = { id: "", title: "", kind: "Other", expiresOn: "", note: "", shared: false, sharedWithOwners: false, tenant: false, onProperty: false };

/**
 * Every document a company keeps, in one place: a drawer per property, a
 * folder per kind, and a scanner for turning the paper on the desk into a
 * PDF. On the property's own page it's that property's drawer.
 */
export default function FilingCabinet({
  userLabel,
  openRepairs,
  initial,
  properties,
  tenants,
  ownerCompanyIds,
  property,
  today,
  storageReady,
}: {
  userLabel: string;
  openRepairs: number;
  initial: DocumentDTO[];
  properties: CabinetProperty[];
  tenants: ScanTenant[];
  /** Companies where this person is an owner — the only role that may delete. */
  ownerCompanyIds: string[];
  /** Set on a property's own page; the list is that property's and the filter is hidden. */
  property?: CabinetProperty;
  today: string;
  storageReady: boolean;
}) {
  const { toasts, push, dismiss } = useToasts();
  const [docs, setDocs] = useState(initial);
  const [kind, setKind] = useState("");
  const [propertyFilter, setPropertyFilter] = useState("");
  const [query, setQuery] = useState("");
  const [scanning, setScanning] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(EMPTY_EDIT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null);
  const [upload, setUpload] = useState({ propertyId: property?.id ?? properties[0]?.id ?? "", tenantId: "", title: "", kind: "Lease", expiresOn: "", shared: false, sharedWithOwners: false });
  const fileRef = useRef<HTMLInputElement>(null);

  const propertyName = (id: string) => properties.find((p) => p.id === id)?.name ?? "";
  const kindsPresent = useMemo(() => KINDS.filter((k) => docs.some((d) => d.kind === k)), [docs]);
  const uploadTenants = tenants.filter((t) => t.propertyId === upload.propertyId);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return docs
      .filter((d) => !kind || d.kind === kind)
      .filter((d) => !propertyFilter || d.propertyId === propertyFilter)
      .filter(
        (d) =>
          !q ||
          d.title.toLowerCase().includes(q) ||
          d.filename.toLowerCase().includes(q) ||
          d.ownerLabel.toLowerCase().includes(q) ||
          d.note.toLowerCase().includes(q)
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [docs, kind, propertyFilter, query]);

  const canDelete = (d: DocumentDTO) => ownerCompanyIds.includes(d.companyId);

  function filed(doc: DocumentDTO) {
    setDocs((prev) => [doc, ...prev.filter((d) => d.id !== doc.id)]);
    push(`${doc.title} filed.`);
  }

  async function submitUpload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a file.");
      return;
    }
    const form = new FormData();
    form.set("file", file);
    if (upload.tenantId) form.set("tenantId", upload.tenantId);
    else form.set("propertyId", upload.propertyId);
    form.set("title", upload.title);
    form.set("kind", upload.kind);
    form.set("expiresOn", upload.expiresOn);
    form.set("shared", upload.shared && upload.tenantId ? "1" : "0");
    form.set("sharedWithOwners", upload.sharedWithOwners ? "1" : "0");
    setBusy(true);
    setError("");
    const res = await fetch("/api/documents", { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data?.error || "Couldn't upload that.");
      return;
    }
    setAdding(false);
    filed(data);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch(`/api/documents/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: editing.title, kind: editing.kind, expiresOn: editing.expiresOn, note: editing.note, shared: editing.shared, sharedWithOwners: editing.sharedWithOwners }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data?.error || "Couldn't save that.");
      return;
    }
    setDocs((prev) => prev.map((d) => (d.id === data.id ? data : d)));
    setEditing(EMPTY_EDIT);
    push("Saved.");
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
          push("Couldn't delete that.", "bad");
          return;
        }
        setDocs((prev) => prev.filter((x) => x.id !== d.id));
        setEditing(EMPTY_EDIT);
        push(`${d.title} deleted.`);
      },
    });
  }

  const scanButton = (
    <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={() => setScanning(true)} disabled={properties.length === 0}>
      📷 Scan
    </button>
  );
  const uploadButton = (
    <button
      type="button"
      className={styles.btn}
      onClick={() => {
        setError("");
        setUpload((u) => ({ ...u, propertyId: property?.id ?? u.propertyId ?? properties[0]?.id ?? "", tenantId: "", title: "", expiresOn: "", shared: false, sharedWithOwners: false }));
        setAdding(true);
      }}
      disabled={properties.length === 0}
    >
      Upload a file
    </button>
  );

  return (
    <AppShell
      openRepairs={openRepairs}
      userLabel={userLabel}
      title={property ? "Filing cabinet" : "Filing cabinet"}
      tagline={
        property
          ? `${property.name} · leases, receipts, notices and photos for this property`
          : "Every lease, certificate, receipt and notice across your properties — scanned from your phone or uploaded."
      }
      back={property ? { href: `/dashboard/properties/${property.id}`, label: property.name } : undefined}
      actions={
        <>
          {uploadButton}
          {scanButton}
        </>
      }
    >
      <Toasts toasts={toasts} onDismiss={dismiss} />

      <div className={styles.cabinetTools}>
        <input
          type="search"
          className={styles.cabinetSearch}
          placeholder="Search by name, tenant or note"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search documents"
        />
        {!property && properties.length > 1 && (
          <select className={styles.cabinetSelect} value={propertyFilter} onChange={(e) => setPropertyFilter(e.target.value)} aria-label="Property">
            <option value="">All properties</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {kindsPresent.length > 1 && (
        <div className={styles.chipRow} role="group" aria-label="Kind">
          <button type="button" className={`${styles.chip} ${!kind ? styles.active : ""}`} onClick={() => setKind("")}>
            All
          </button>
          {kindsPresent.map((k) => (
            <button key={k} type="button" className={`${styles.chip} ${kind === k ? styles.active : ""}`} onClick={() => setKind(kind === k ? "" : k)}>
              {k}
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <div className={styles.cabinetEmpty}>
          {docs.length === 0 ? (
            <>
              <p>Nothing filed yet.</p>
              <p className={styles.helpText}>
                Tap <strong>Scan</strong> to photograph a lease or a receipt with your phone, or <strong>Upload a file</strong> for a PDF you already have.
              </p>
            </>
          ) : (
            <p className={styles.helpText}>Nothing matches that.</p>
          )}
        </div>
      ) : (
        <ul className={styles.docList}>
          {shown.map((d) => {
            const state = expiryState(d.expiresOn, today);
            const where = property ? d.ownerLabel : [propertyName(d.propertyId) || null, d.tenantId || d.vendorId ? d.ownerLabel : null].filter(Boolean).join(" · ");
            return (
              <li key={d.id}>
                <FileLink className={styles.docMain} url={d.url} name={d.filename || d.title} mime={d.contentType}>
                  <span className={styles.docTitle}>{d.title}</span>
                  <span className={styles.docMeta}>
                    {d.kind}
                    {where ? ` · ${where}` : ""}
                    {d.size ? ` · ${formatSize(d.size)}` : ""}
                    {` · ${formatDay(d.createdAt.slice(0, 10))}`}
                    {d.shared ? " · on their portal" : ""}
                    {d.sharedWithOwners ? " · shown to owners" : ""}
                  </span>
                </FileLink>
                {d.expiresOn && (
                  <span className={`${styles.docExpiry} ${state === "expired" ? styles.docExpired : state === "soon" ? styles.docSoon : ""}`}>
                    {expiryLabel(d.expiresOn, today, formatDay)}
                  </span>
                )}
                <a className={styles.portalLink} href={`${d.url}?download=1`}>
                  Download
                </a>
                <button
                  type="button"
                  className={styles.portalLink}
                  onClick={() => {
                    setError("");
                    setEditing({ id: d.id, title: d.title, kind: d.kind, expiresOn: d.expiresOn, note: d.note, shared: d.shared, sharedWithOwners: d.sharedWithOwners, tenant: Boolean(d.tenantId), onProperty: Boolean(d.propertyId) });
                  }}
                >
                  Edit
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {!property && properties.length > 0 && (
        <p className={styles.helpText} style={{ marginTop: 14 }}>
          Each property has its own drawer:{" "}
          {properties.slice(0, 6).map((p, i) => (
            <span key={p.id}>
              {i > 0 ? ", " : ""}
              <Link href={`/dashboard/properties/${p.id}/files`}>{p.name}</Link>
            </span>
          ))}
          {properties.length > 6 ? "…" : ""}
        </p>
      )}

      <Scanner
        open={scanning}
        onClose={() => setScanning(false)}
        properties={properties}
        tenants={tenants}
        defaultPropertyId={property?.id}
        today={today}
        storageReady={storageReady}
        onSaved={filed}
      />

      <Modal open={adding} title="Upload a file" subtitle="A PDF or a photo you already have, up to 4 MB. To photograph paper, use Scan instead." onClose={() => setAdding(false)}>
        {!storageReady ? (
          <div className={styles.errorBar} style={{ marginTop: 0 }}>
            File storage isn&apos;t set up yet, so documents can&apos;t be uploaded.
          </div>
        ) : (
          <form onSubmit={submitUpload}>
            {error && <div className={styles.errorBar} style={{ marginTop: 0, marginBottom: 14 }}>{error}</div>}
            <div className={`${styles.fieldGrid} ${styles.modalGrid}`}>
              <div className={`${styles.field} ${styles.span4}`}>
                <label htmlFor="cab-file">File (PDF or photo)</label>
                <input id="cab-file" ref={fileRef} type="file" accept="application/pdf,image/*" required />
              </div>
              <div className={`${styles.field} ${styles.wide}`}>
                <label htmlFor="cab-property">Property</label>
                <select id="cab-property" value={upload.propertyId} onChange={(e) => setUpload((u) => ({ ...u, propertyId: e.target.value, tenantId: "" }))} disabled={Boolean(property)}>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className={`${styles.field} ${styles.wide}`}>
                <label htmlFor="cab-tenant">Tenant (optional)</label>
                <select id="cab-tenant" value={upload.tenantId} onChange={(e) => setUpload((u) => ({ ...u, tenantId: e.target.value }))}>
                  <option value="">— The property itself —</option>
                  {uploadTenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className={`${styles.field} ${styles.wide}`}>
                <label htmlFor="cab-title">Name</label>
                <input id="cab-title" type="text" placeholder="Taken from the file if left blank" value={upload.title} onChange={(e) => setUpload((u) => ({ ...u, title: e.target.value }))} />
              </div>
              <div className={`${styles.field} ${styles.wide}`}>
                <label htmlFor="cab-kind">Kind</label>
                <select id="cab-kind" value={upload.kind} onChange={(e) => setUpload((u) => ({ ...u, kind: e.target.value }))}>
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>
              <div className={`${styles.field} ${styles.wide}`}>
                <label htmlFor="cab-expires">Expires on (optional)</label>
                <input id="cab-expires" type="date" value={upload.expiresOn} onChange={(e) => setUpload((u) => ({ ...u, expiresOn: e.target.value }))} />
              </div>
              {upload.tenantId && (
                <label className={`${styles.checkboxField} ${styles.span4}`}>
                  <input type="checkbox" checked={upload.shared} onChange={(e) => setUpload((u) => ({ ...u, shared: e.target.checked }))} />
                  Show it on their portal so they can download it
                </label>
              )}
              <label className={`${styles.checkboxField} ${styles.span4}`}>
                <input type="checkbox" checked={upload.sharedWithOwners} onChange={(e) => setUpload((u) => ({ ...u, sharedWithOwners: e.target.checked }))} />
                Show to property owners (owner portal)
              </label>
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

      <Modal open={Boolean(editing.id)} title="Edit document" subtitle="Rename it, refile it under another kind, or set the date it runs out." onClose={() => setEditing(EMPTY_EDIT)}>
        <form onSubmit={saveEdit}>
          {error && <div className={styles.errorBar} style={{ marginTop: 0, marginBottom: 14 }}>{error}</div>}
          <div className={`${styles.fieldGrid} ${styles.modalGrid}`}>
            <div className={`${styles.field} ${styles.wide}`}>
              <label htmlFor="cab-e-title">Name</label>
              <input id="cab-e-title" type="text" required value={editing.title} onChange={(e) => setEditing((d) => ({ ...d, title: e.target.value }))} />
            </div>
            <div className={`${styles.field} ${styles.wide}`}>
              <label htmlFor="cab-e-kind">Kind</label>
              <select id="cab-e-kind" value={editing.kind} onChange={(e) => setEditing((d) => ({ ...d, kind: e.target.value }))}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>
            <div className={`${styles.field} ${styles.wide}`}>
              <label htmlFor="cab-e-expires">Expires on</label>
              <input id="cab-e-expires" type="date" value={editing.expiresOn} onChange={(e) => setEditing((d) => ({ ...d, expiresOn: e.target.value }))} />
            </div>
            <div className={`${styles.field} ${styles.wide}`}>
              <label htmlFor="cab-e-note">Note</label>
              <input id="cab-e-note" type="text" value={editing.note} onChange={(e) => setEditing((d) => ({ ...d, note: e.target.value }))} />
            </div>
            {editing.tenant && (
              <label className={`${styles.checkboxField} ${styles.span4}`}>
                <input type="checkbox" checked={editing.shared} onChange={(e) => setEditing((d) => ({ ...d, shared: e.target.checked }))} />
                Show it on their portal so they can download it
              </label>
            )}
            {editing.onProperty && (
              <label className={`${styles.checkboxField} ${styles.span4}`}>
                <input type="checkbox" checked={editing.sharedWithOwners} onChange={(e) => setEditing((d) => ({ ...d, sharedWithOwners: e.target.checked }))} />
                Show to property owners (owner portal)
              </label>
            )}
          </div>
          <div className={styles.formFoot}>
            {(() => {
              const d = docs.find((x) => x.id === editing.id);
              return d && canDelete(d) ? (
                <button type="button" className={`${styles.btn} ${styles.quiet} ${styles.danger}`} style={{ marginRight: "auto" }} onClick={() => remove(d)}>
                  Delete
                </button>
              ) : null;
            })()}
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
    </AppShell>
  );
}
