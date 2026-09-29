"use client";

/**
 * "Attach proof" for rent and expense entries: pick, preview and upload up to
 * four photos or PDFs.
 *
 * Why it is built this way (the property page had no attach control at all,
 * and the dashboard's relied on a display:none input):
 *  - Each button is a <label htmlFor> for its own real <input type="file">.
 *    A label tap is a genuine user gesture on every browser, including iOS
 *    Safari and the installed home-screen app, which don't open a picker for
 *    a script-driven .click() on some inputs and can ignore display:none ones.
 *    The inputs are visually hidden (clipped, still in the layout), never
 *    display:none, so they stay focusable and reachable.
 *  - "Take photo" has capture="environment" (straight to the rear camera);
 *    "Choose photo or file" has no capture, so iOS offers Photo Library,
 *    Take Photo and Files, and the accept list names PDF and HEIC.
 *  - On a desktop the same input reads "Choose files" and the area takes
 *    drag-and-drop; the camera button and drop hint are hidden by media
 *    query where they don't apply.
 *  - Photos are shrunk in the browser; a HEIC the browser can't decode
 *    (anything but Safari) goes up as the original if it fits in 4 MB.
 *  - "Scan" opens the document scanner in attachment mode: a crumpled
 *    receipt or a check photographed at an angle comes back cropped and
 *    cleaned up as one PDF, which joins the queue like any picked PDF. The
 *    scanner is portalled to <body> (it is its own <form>, and this picker
 *    sits inside the entry's form), and its submit/drag events are stopped
 *    here so they don't bubble through React to the entry form or this zone.
 */

import { useEffect, useId, useRef, useState, type DragEvent, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import Scanner from "./Scanner";
import { shrinkImage } from "@/lib/shrinkImage";
import {
  CAMERA_ACCEPT,
  MAX_PROOFS,
  PROOF_ACCEPT,
  chooseUpload,
  isHeic,
  proofCountLabel,
  proofKind,
  screenPicked,
  proofScanTitle,
  shortName,
  type ProofKind,
} from "@/lib/attachments-ui";
import s from "./proof.module.css";

export type ProofDTO = {
  id: string;
  transactionId: string;
  url: string;
  filename: string;
  contentType: string;
};

export type PendingProof = {
  key: string;
  file: File;
  kind: ProofKind;
  preview: string | null;
};

let seq = 0;

/** Events from the portalled scanner still bubble through React; they stop here. */
function stop(e: SyntheticEvent) {
  e.stopPropagation();
}

function localDayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function localDayLabel(): string {
  return new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function toPending(file: File): PendingProof {
  const kind = proofKind(file.name, file.type) ?? "image";
  let preview: string | null = null;
  if (kind === "image" && typeof URL !== "undefined" && URL.createObjectURL) {
    try {
      preview = URL.createObjectURL(file);
    } catch {
      preview = null;
    }
  }
  seq += 1;
  return { key: `p${seq}-${file.name}`, file, kind, preview };
}

/** Frees the preview URLs of files that are no longer queued. */
export function releasePending(list: PendingProof[]) {
  for (const p of list) if (p.preview) URL.revokeObjectURL(p.preview);
}

/**
 * Uploads one file to an entry through the same route the dashboard uses.
 * Shrinks photos first; falls back to the original when that fails.
 */
export async function uploadProof(
  transactionId: string,
  file: File
): Promise<{ ok: true; attachment: ProofDTO } | { ok: false; error: string }> {
  let prepared: File = file;
  try {
    prepared = await shrinkImage(file);
  } catch {
    prepared = file;
  }
  const choice = chooseUpload(file, prepared === file ? null : prepared);
  if ("error" in choice) return { ok: false, error: `${file.name} ${choice.error}.` };

  const form = new FormData();
  form.append("file", choice.file, choice.file.name || file.name || "proof");
  let res: Response;
  try {
    res = await fetch(`/api/transactions/${transactionId}/attachments`, { method: "POST", body: form });
  } catch {
    return { ok: false, error: `Couldn't upload ${file.name} — check your connection.` };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data?.error || `Couldn't upload ${file.name}.` };
  return { ok: true, attachment: data as ProofDTO };
}

/** A small file glyph for PDFs and photos this browser can't draw (HEIC). */
function FileTile({ label }: { label: string }) {
  return (
    <span className={s.fileTile} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
        <path d="M14 3v5h5" />
      </svg>
      <span>{label}</span>
    </span>
  );
}

/** An image, or the file tile when this browser can't draw it (HEIC outside Safari). */
function Thumb({ src, fallback }: { src: string; fallback: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <FileTile label={fallback} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className={s.thumb} onError={() => setFailed(true)} />;
}

export function PaperclipIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M21.4 11.1 12.2 20.3a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />
    </svg>
  );
}

/** Thumbnails of proof already stored, each opening the file itself. */
export function ProofStrip({
  items,
  onRemove,
  busyId,
  heading,
}: {
  items: ProofDTO[];
  onRemove?: (a: ProofDTO) => void;
  busyId?: string;
  heading?: string;
}) {
  if (items.length === 0) return null;
  return (
    <>
      {heading && <div className={s.stripHeading}>{heading}</div>}
      <ul className={s.strip}>
        {items.map((a) => (
          <li key={a.id} className={s.item}>
            <a
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className={s.thumbLink}
              title={a.filename}
              aria-label={`Open ${a.filename}`}
            >
              {a.contentType.startsWith("image/") ? (
                <Thumb src={a.url} fallback={isHeic(a.filename, a.contentType) ? "HEIC" : "IMG"} />
              ) : (
                <FileTile label="PDF" />
              )}
            </a>
            <span className={s.name}>{shortName(a.filename, 16)}</span>
            {onRemove && (
              <button
                type="button"
                className={s.remove}
                aria-label={`Remove ${a.filename}`}
                disabled={busyId === a.id}
                onClick={() => onRemove(a)}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * The picker itself: queues files (with previews) for the caller to upload
 * once the entry exists. `existing` counts proof already on the entry so the
 * four-file cap covers the whole entry.
 */
export default function ProofPicker({
  value,
  onChange,
  existing = 0,
  disabled = false,
  label = "Attach proof",
  hint,
  scanTitle,
}: {
  value: PendingProof[];
  onChange: (next: PendingProof[]) => void;
  existing?: number;
  disabled?: boolean;
  label?: string;
  hint?: string;
  /** The name a scan starts with, e.g. "Receipt – Sep 29, 2026" (lib/attachments-ui proofScanTitle). */
  scanTitle?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const cameraId = `proof-camera-${uid}`;
  const filesId = `proof-files-${uid}`;
  const [problems, setProblems] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const [scanning, setScanning] = useState(false);
  // The scanner is portalled to <body>, which only exists in the browser.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Latest queue for the unmount cleanup below.
  const latest = useRef(value);
  latest.current = value;
  useEffect(() => () => releasePending(latest.current), []);

  const room = MAX_PROOFS - existing - value.length;
  const full = room <= 0;

  function add(list: FileList | File[] | null | undefined) {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    const { accepted, problems: why } = screenPicked(files, existing + value.length);
    setProblems(why);
    if (accepted.length) onChange([...value, ...accepted.map(toPending)]);
  }

  function remove(key: string) {
    const gone = value.filter((p) => p.key === key);
    releasePending(gone);
    setProblems([]);
    onChange(value.filter((p) => p.key !== key));
  }

  function onDragEnter(e: DragEvent) {
    if (disabled || !Array.from(e.dataTransfer?.types ?? []).includes("Files")) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  }
  function onDragOver(e: DragEvent) {
    if (disabled) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = full ? "none" : "copy";
    if (!dragging) setDragging(true);
  }
  function onDragLeave() {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (disabled) return;
    add(e.dataTransfer?.files);
  }

  return (
    <div
      className={`${s.zone} ${dragging ? s.dragging : ""} ${disabled ? s.disabled : ""}`}
      data-proof-zone=""
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className={s.zoneHead}>
        <span className={s.zoneLabel}>{label}</span>
        <span className={s.zoneCount}>
          {existing + value.length}/{MAX_PROOFS}
        </span>
      </div>

      {/* Real inputs, visually hidden — never display:none (see top of file). */}
      <input
        id={cameraId}
        className={s.srOnly}
        type="file"
        accept={CAMERA_ACCEPT}
        capture="environment"
        disabled={disabled || full}
        data-proof-input="camera"
        onChange={(e) => {
          add(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        id={filesId}
        className={s.srOnly}
        type="file"
        accept={PROOF_ACCEPT}
        multiple
        disabled={disabled || full}
        data-proof-input="files"
        onChange={(e) => {
          add(e.target.files);
          e.target.value = "";
        }}
      />

      <div className={s.buttons}>
        <label htmlFor={cameraId} className={`${s.pick} ${s.cameraOnly}`} aria-disabled={disabled || full}>
          Take photo
        </label>
        <label htmlFor={filesId} className={s.pick} aria-disabled={disabled || full}>
          <span className={s.touchText}>Choose photo or file</span>
          <span className={s.pointerText}>Choose files</span>
        </label>
        <button
          type="button"
          className={s.pick}
          aria-disabled={disabled || full}
          disabled={disabled || full}
          data-proof-scan=""
          onClick={() => {
            setProblems([]);
            setScanning(true);
          }}
        >
          Scan
        </button>
        <span className={s.dropHint}>{dragging ? "Drop to attach" : "or drag files here"}</span>
      </div>

      {value.length > 0 && (
        <ul className={s.strip}>
          {value.map((p) => (
            <li key={p.key} className={s.item}>
              {p.kind === "image" && p.preview ? (
                <Thumb src={p.preview} fallback={isHeic(p.file.name, p.file.type) ? "HEIC" : "IMG"} />
              ) : (
                <FileTile label="PDF" />
              )}
              <span className={s.name} title={p.file.name}>
                {shortName(p.file.name, 16)}
              </span>
              <button
                type="button"
                className={s.remove}
                aria-label={`Remove ${p.file.name}`}
                onClick={() => remove(p.key)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className={s.hint}>
        {full
          ? `That's ${proofCountLabel(MAX_PROOFS)} — the most one entry takes.`
          : hint ?? "Photos or PDFs, up to 4 per entry, 4 MB each."}
      </p>
      {problems.length > 0 && (
        <p className={s.problem} role="alert">
          {problems.join(" ")}
        </p>
      )}

      {mounted &&
        createPortal(
          <div
            onSubmit={stop}
            onDragEnter={stop}
            onDragOver={stop}
            onDragLeave={stop}
            onDrop={stop}
          >
            <Scanner
              open={scanning}
              onClose={() => setScanning(false)}
              mode="attachment"
              defaultTitle={scanTitle || proofScanTitle(null, localDayLabel())}
              today={localDayKey()}
              storageReady
              onPdf={(file) => add([file])}
            />
          </div>,
          document.body
        )}
    </div>
  );
}
