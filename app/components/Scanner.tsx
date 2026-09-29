"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Modal from "./Modal";
import styles from "../dashboard/dashboard.module.css";
import { formatDay } from "@/lib/lease";
import { KINDS, scanTitle, type DocumentDTO } from "@/lib/documents";
import { buildPdf, jpegInfo, type JpegPage } from "@/lib/pdf";
import { DEFAULT_LOOK, firstQuality, lookLabel, otherLook, qualitySteps, sharedLook, withEveryLook, type Look } from "@/lib/scanLook";
import {
  MAX_DOCUMENT_BYTES,
  QUALITY_STEPS,
  SCAN_MAX_EDGE,
  adaptiveThreshold,
  bwParams,
  contrastTable,
  exifOrientation,
  findPaper,
  pageBudget,
  rotationFor,
  softenEdges,
  toGray,
} from "@/lib/scan";
import { scanFileName } from "@/lib/attachments-ui"; // scan-anywhere

/** Enough for a lease; more than this and a phone starts running out of memory. */
export const MAX_PAGES = 20;
/** A phone photo is 3–12 MB; anything past this isn't a photo of a page. */
const MAX_PHOTO_BYTES = 30 * 1024 * 1024;

type Page = {
  key: number;
  /** The photo as it came off the phone; everything else is rebuilt from it. */
  original: File;
  /** Quarter turns the person added on top of the photo's own orientation. */
  turns: number;
  /** This page's own look; kept through rotating and reordering. */
  look: Look;
  /** The cleaned-up page as a JPEG, or null while it's being made. */
  jpeg: Blob | null;
  width: number;
  height: number;
  previewUrl: string;
  error: string;
};

export type ScanProperty = { id: string; name: string };
export type ScanTenant = { id: string; name: string; propertyId: string };

let nextKey = 1;
// scan-anywhere: stable defaults, so the reset-on-open effect doesn't re-run every render.
const NO_PROPERTIES: ScanProperty[] = [];
const NO_TENANTS: ScanTenant[] = [];

/**
 * Photos of paper in, one PDF out. Every step runs in the browser: the
 * photo is straightened by its EXIF tag, cropped to the sheet, cleaned up
 * (contrast, or black-and-white for a shadowed page), shrunk to fit the
 * upload cap, and the pages are stitched into a PDF by lib/pdf. The server
 * only ever sees a finished PDF, the same as any other upload.
 */
export default function Scanner({
  open,
  onClose,
  properties = NO_PROPERTIES, // scan-anywhere: optional, attachment mode has no pickers
  tenants = NO_TENANTS, // scan-anywhere
  defaultPropertyId,
  today,
  storageReady,
  onSaved,
  mode = "document", // scan-anywhere
  onPdf, // scan-anywhere
  defaultTitle: titleOverride, // scan-anywhere
}: {
  open: boolean;
  onClose: () => void;
  properties?: ScanProperty[];
  tenants?: ScanTenant[];
  defaultPropertyId?: string;
  /** YYYY-MM-DD, for the default title. */
  today: string;
  storageReady: boolean;
  onSaved?: (doc: DocumentDTO) => void;
  /**
   * scan-anywhere: "document" files the PDF in the filing cabinet
   * (POST /api/documents). "attachment" hides the property/tenant/kind
   * pickers and hands the PDF to `onPdf` as `<name>.pdf` instead of
   * uploading it, so it rides along with a rent or expense entry.
   */
  mode?: "document" | "attachment";
  onPdf?: (file: File) => void;
  /** scan-anywhere: the name to start with, instead of "<kind> – <property> – <day>". */
  defaultTitle?: string;
}) {
  const attachment = mode === "attachment"; // scan-anywhere
  const [pages, setPages] = useState<Page[]>([]);
  // The look new pages arrive in; each page then keeps its own.
  const [look, setLook] = useState<Look>(DEFAULT_LOOK);
  const [autoCrop, setAutoCrop] = useState(true);
  const [propertyId, setPropertyId] = useState(defaultPropertyId ?? properties[0]?.id ?? "");
  const [tenantId, setTenantId] = useState("");
  const [kind, setKind] = useState("Lease");
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [shared, setShared] = useState(false);
  const [stage, setStage] = useState<"" | "building" | "uploading">("");
  const [error, setError] = useState("");
  const cameraRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  // Work is done one page at a time, so a burst of photos doesn't decode all
  // at once; the crop setting is read through a ref so a queued page uses
  // the one chosen by the time its turn comes. The look travels with the
  // page itself.
  const queue = useRef(Promise.resolve());
  const settings = useRef({ autoCrop });
  settings.current = { autoCrop };
  const pagesRef = useRef<Page[]>([]);
  pagesRef.current = pages;

  const propertyName = properties.find((p) => p.id === propertyId)?.name ?? "";
  const propertyTenants = useMemo(() => tenants.filter((t) => t.propertyId === propertyId), [tenants, propertyId]);
  const defaultTitle = titleOverride || scanTitle(kind, propertyName, formatDay(today)); // scan-anywhere
  const busy = pages.some((p) => !p.jpeg && !p.error);
  const allLook = sharedLook(pages, look);
  const ready = pages.length > 0 && !busy && stage === "";

  // Start over each time the sheet opens, and drop the preview URLs.
  useEffect(() => {
    if (open) {
      setPropertyId(defaultPropertyId ?? properties[0]?.id ?? "");
      setTenantId("");
      setKind("Lease");
      setTitle("");
      setTitleTouched(false);
      setShared(false);
      setStage("");
      setError("");
    } else {
      setPages((prev) => {
        prev.forEach((p) => URL.revokeObjectURL(p.previewUrl));
        return [];
      });
    }
  }, [open, defaultPropertyId, properties]);

  // A tenant belongs to one property; changing the property drops them.
  useEffect(() => {
    if (tenantId && !propertyTenants.some((t) => t.id === tenantId)) setTenantId("");
  }, [propertyTenants, tenantId]);

  function replacePage(key: number, patch: Partial<Page>) {
    setPages((prev) =>
      prev.map((p) => {
        if (p.key !== key) return p;
        if (patch.previewUrl && p.previewUrl) URL.revokeObjectURL(p.previewUrl);
        return { ...p, ...patch };
      })
    );
  }

  /** Rebuild one page from its photo with the current settings. */
  function process(page: Page) {
    queue.current = queue.current
      .then(async () => {
        const result = await renderPage(page.original, page.turns, { look: page.look, autoCrop: settings.current.autoCrop });
        replacePage(page.key, {
          jpeg: result.jpeg,
          width: result.width,
          height: result.height,
          previewUrl: URL.createObjectURL(result.jpeg),
          error: "",
        });
      })
      .catch((err) => {
        console.error("Scan failed", err);
        replacePage(page.key, {
          error: "Couldn't read this photo. Try a JPG or PNG.",
          jpeg: null,
        });
      });
  }

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setError("");
    const files = Array.from(list);
    const room = MAX_PAGES - pages.length;
    if (files.length > room) {
      setError(`A scan can have up to ${MAX_PAGES} pages; the first ${Math.max(0, room)} were added.`);
    }
    const added: Page[] = files.slice(0, Math.max(0, room)).map((file) => ({
      key: nextKey++,
      original: file,
      turns: 0,
      look,
      jpeg: null,
      width: 0,
      height: 0,
      previewUrl: "",
      error: file.size > MAX_PHOTO_BYTES ? "That photo is too large." : "",
    }));
    setPages((prev) => [...prev, ...added]);
    added.filter((p) => !p.error).forEach(process);
  }

  /** "All B&W" / "All color": every page, and the pages added next. */
  function changeAllLooks(next: Look) {
    setLook(next);
    const changed = new Set(pagesRef.current.filter((p) => !p.error && p.look !== next).map((p) => p.key));
    if (changed.size === 0) return;
    const updated = withEveryLook(pagesRef.current, next);
    setPages((prev) => withEveryLook(prev, next).map((p) => (changed.has(p.key) ? { ...p, jpeg: null } : p)));
    updated.filter((p) => changed.has(p.key)).forEach((p) => process(p));
  }

  /** One page's own toggle, e.g. a photo of damage in colour among B&W pages. */
  function toggleLook(page: Page) {
    const next = otherLook(page.look);
    replacePage(page.key, { look: next, jpeg: null });
    process({ ...page, look: next });
  }

  function changeAutoCrop(next: boolean) {
    setAutoCrop(next);
    settings.current = { ...settings.current, autoCrop: next };
    reprocessAll();
  }

  function reprocessAll() {
    const current = pagesRef.current.filter((p) => !p.error);
    setPages((prev) => prev.map((p) => (p.error ? p : { ...p, jpeg: null })));
    current.forEach((p) => process(p));
  }

  function rotate(page: Page) {
    const turns = (page.turns + 1) % 4;
    replacePage(page.key, { turns, jpeg: null });
    process({ ...page, turns });
  }

  function move(index: number, by: -1 | 1) {
    setPages((prev) => {
      const to = index + by;
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });
  }

  function remove(page: Page) {
    if (page.previewUrl) URL.revokeObjectURL(page.previewUrl);
    setPages((prev) => prev.filter((p) => p.key !== page.key));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    const good = pages.filter((p) => p.jpeg);
    if (good.length === 0) {
      setError("Add at least one page.");
      return;
    }
    if (!propertyId && !attachment) { // scan-anywhere: attachments belong to an entry, not a property
      setError("Choose a property.");
      return;
    }
    setError("");
    setStage("building");
    try {
      // Every page gets an equal share of the upload cap; a page over its
      // share is re-encoded smaller until it fits.
      const budget = pageBudget(good.length);
      const jpegPages: JpegPage[] = [];
      for (const p of good) {
        const fitted = await fitToBudget(p.jpeg!, budget);
        const bytes = new Uint8Array(await fitted.arrayBuffer());
        const info = jpegInfo(bytes);
        if (!info) throw new Error("The browser produced a JPEG this can't read.");
        jpegPages.push({ data: bytes, ...info });
      }
      const finalTitle = (titleTouched ? title.trim() : "") || defaultTitle;
      const pdf = buildPdf(jpegPages, { title: finalTitle, created: new Date() });
      if (pdf.length > MAX_DOCUMENT_BYTES + 64 * 1024) {
        throw new Error("Even shrunk, these pages don't fit in one upload. Split them into two scans.");
      }
      // scan-anywhere: as proof, the PDF goes back to the picker and is
      // uploaded with the entry, under the attachment rules.
      if (attachment) {
        onPdf?.(new File([pdf as BlobPart], scanFileName(finalTitle), { type: "application/pdf" }));
        onClose();
        return;
      }
      setStage("uploading");
      const form = new FormData();
      form.set("file", new File([pdf as BlobPart], "scan.pdf", { type: "application/pdf" }));
      if (tenantId) form.set("tenantId", tenantId);
      else form.set("propertyId", propertyId);
      form.set("title", finalTitle);
      form.set("kind", kind);
      form.set("shared", shared && tenantId ? "1" : "0");
      const res = await fetch("/api/documents", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Couldn't upload the scan.");
      onSaved?.(data); // scan-anywhere: optional now
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't build the PDF.");
    } finally {
      setStage("");
    }
  }

  return (
    <Modal
      open={open}
      title={attachment ? "Scan proof" : "Scan a document"} // scan-anywhere
      subtitle={
        attachment // scan-anywhere
          ? "Photograph the check or receipt. It's cleaned up here on your phone and attached as one PDF."
          : "Photograph each page. It's straightened, cropped and cleaned up here on your phone, then saved as one PDF."
      }
      onClose={() => stage === "" && onClose()}
    >
      {!storageReady ? (
        <div className={styles.errorBar} style={{ marginTop: 0 }}>
          File storage isn&apos;t set up yet, so scans can&apos;t be saved.
        </div>
      ) : (
        <form onSubmit={save}>
          {error && <div className={styles.errorBar} style={{ marginTop: 0, marginBottom: 14 }}>{error}</div>}

          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={filesRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />

          {pages.length > 0 && (
            <ol className={styles.scanGrid} aria-label="Pages">
              {pages.map((p, i) => (
                <li key={p.key} className={styles.scanPage}>
                  <div className={styles.scanThumb}>
                    {p.previewUrl ? (
                      <img src={p.previewUrl} alt={`Page ${i + 1}`} />
                    ) : (
                      <span className={styles.scanThumbText}>{p.error ? "✕" : "…"}</span>
                    )}
                    <span className={styles.scanNumber}>{i + 1}</span>
                    {!p.error && (
                      <button
                        type="button"
                        className={`${styles.scanLook} ${p.look === "color" ? styles.scanLookColor : ""}`}
                        onClick={() => toggleLook(p)}
                        disabled={!p.jpeg}
                        aria-label={`Page ${i + 1} is ${p.look === "bw" ? "black and white" : "in color"}; switch to ${
                          p.look === "bw" ? "color" : "black and white"
                        }`}
                        title={p.look === "bw" ? "Switch this page to color" : "Switch this page to black & white"}
                      >
                        {lookLabel(p.look)}
                      </button>
                    )}
                  </div>
                  {p.error ? (
                    <p className={styles.scanError}>{p.error}</p>
                  ) : (
                    <div className={styles.scanTools}>
                      <button type="button" onClick={() => rotate(p)} title="Rotate" aria-label={`Rotate page ${i + 1}`} disabled={!p.jpeg}>
                        ⟳
                      </button>
                      <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move page ${i + 1} earlier`}>
                        ←
                      </button>
                      <button type="button" onClick={() => move(i, 1)} disabled={i === pages.length - 1} aria-label={`Move page ${i + 1} later`}>
                        →
                      </button>
                      <button type="button" onClick={() => remove(p)} aria-label={`Remove page ${i + 1}`} className={styles.scanRemove}>
                        ✕
                      </button>
                    </div>
                  )}
                  {p.error && (
                    <button type="button" className={styles.portalLink} onClick={() => remove(p)}>
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}

          <div className={styles.scanAdd}>
            <button
              type="button"
              className={`${styles.btn} ${pages.length === 0 ? styles.primary : ""}`}
              onClick={() => cameraRef.current?.click()}
              disabled={pages.length >= MAX_PAGES || stage !== ""}
            >
              📷 {pages.length === 0 ? "Take a photo" : "Add a page"}
            </button>
            <button
              type="button"
              className={styles.btn}
              onClick={() => filesRef.current?.click()}
              disabled={pages.length >= MAX_PAGES || stage !== ""}
            >
              Choose photos
            </button>
            {busy && <span className={styles.helpText}>Cleaning up…</span>}
          </div>

          <div className={styles.scanOptions}>
            <span className={styles.scanOptionLabel}>Look</span>
            <button
              type="button"
              className={`${styles.chip} ${allLook === "bw" ? styles.active : ""}`}
              onClick={() => changeAllLooks("bw")}
              aria-pressed={allLook === "bw"}
            >
              All B&amp;W
            </button>
            <button
              type="button"
              className={`${styles.chip} ${allLook === "color" ? styles.active : ""}`}
              onClick={() => changeAllLooks("color")}
              aria-pressed={allLook === "color"}
            >
              All color
            </button>
            <label className={styles.checkboxField} style={{ marginLeft: "auto" }}>
              <input type="checkbox" checked={autoCrop} onChange={(e) => changeAutoCrop(e.target.checked)} />
              Crop to the page
            </label>
          </div>

          <div className={`${styles.fieldGrid} ${styles.modalGrid}`} style={{ marginTop: 16 }}>
            {/* scan-anywhere: an attachment is filed with its entry, so no property/tenant/kind. */}
            {!attachment && (<>
            <div className={`${styles.field} ${styles.wide}`}>
              <label htmlFor="scan-property">Property</label>
              <select id="scan-property" value={propertyId} onChange={(e) => setPropertyId(e.target.value)} required>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className={`${styles.field} ${styles.wide}`}>
              <label htmlFor="scan-tenant">Tenant (optional)</label>
              <select id="scan-tenant" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
                <option value="">— The property itself —</option>
                {propertyTenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className={`${styles.field} ${styles.wide}`}>
              <label htmlFor="scan-kind">Kind</label>
              <select id="scan-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>
            </>)}
            <div className={`${styles.field} ${attachment ? styles.span4 : styles.wide}`}>{/* scan-anywhere */}
              <label htmlFor="scan-title">Name</label>
              <input
                id="scan-title"
                type="text"
                value={titleTouched ? title : defaultTitle}
                onChange={(e) => {
                  setTitleTouched(true);
                  setTitle(e.target.value);
                }}
                maxLength={120}
              />
            </div>
            {tenantId && !attachment && ( // scan-anywhere
              <label className={`${styles.checkboxField} ${styles.span4}`}>
                <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
                Show it on their portal so they can download it
              </label>
            )}
          </div>

          <div className={styles.formFoot}>
            <button type="button" className={`${styles.btn} ${styles.quiet}`} onClick={onClose} disabled={stage !== ""}>
              Cancel
            </button>
            <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={!ready}>
              {stage === "building"
                ? "Building PDF…"
                : stage === "uploading"
                  ? "Saving…"
                  : busy
                    ? "Cleaning up…"
                    : `Save ${pages.length > 1 ? `${pages.length} pages` : "PDF"}`}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/* ---------- The picture work ---------- */

type Decoded = { source: CanvasImageSource; width: number; height: number; unappliedTurn: 0 | 90 | 180 | 270 };

/**
 * Decodes a photo, and works out whether the browser already turned it the
 * way its EXIF tag says. Modern ones do; if the decoded size still matches
 * the size stored in the file for a sideways tag, this one didn't, and the
 * turn is applied while drawing.
 */
async function decodePhoto(file: File): Promise<Decoded> {
  const head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
  const turn = rotationFor(exifOrientation(head));
  const stored = jpegInfo(head);

  let source: CanvasImageSource;
  let width: number;
  let height: number;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    source = bitmap;
    width = bitmap.width;
    height = bitmap.height;
  } catch {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      const url = URL.createObjectURL(file);
      el.onload = () => {
        URL.revokeObjectURL(url);
        resolve(el);
      };
      el.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("decode"));
      };
      el.src = url;
    });
    source = img;
    width = img.naturalWidth;
    height = img.naturalHeight;
  }
  if (!width || !height) throw new Error("decode");

  let unappliedTurn: Decoded["unappliedTurn"] = 0;
  if ((turn === 90 || turn === 270) && stored && width === stored.width && height === stored.height) {
    unappliedTurn = turn;
  }
  return { source, width, height, unappliedTurn };
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", quality);
  });
}

/**
 * One photo to one cleaned-up JPEG page: oriented, shrunk to scanning size,
 * cropped to the sheet, and either contrast-stretched or thresholded.
 */
async function renderPage(
  file: File,
  turns: number,
  opts: { look: Look; autoCrop: boolean }
): Promise<{ jpeg: Blob; width: number; height: number }> {
  const decoded = await decodePhoto(file);
  const totalTurn = (decoded.unappliedTurn + turns * 90) % 360;
  const scale = Math.min(1, SCAN_MAX_EDGE / Math.max(decoded.width, decoded.height));
  const sw = Math.max(1, Math.round(decoded.width * scale));
  const sh = Math.max(1, Math.round(decoded.height * scale));
  const sideways = totalTurn === 90 || totalTurn === 270;
  const canvas = makeCanvas(sideways ? sh : sw, sideways ? sw : sh);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((totalTurn * Math.PI) / 180);
  ctx.drawImage(decoded.source, -sw / 2, -sh / 2, sw, sh);
  ctx.restore();
  if ("close" in decoded.source && typeof decoded.source.close === "function") decoded.source.close();

  let image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let gray = toGray(image.data, image.width, image.height);

  if (opts.autoCrop) {
    const box = findPaper(gray, image.width, image.height);
    if (box) {
      image = ctx.getImageData(box.x, box.y, box.width, box.height);
      gray = toGray(image.data, image.width, image.height);
    }
  }

  const px = image.data;
  if (opts.look === "bw") {
    // Each pixel against its neighbourhood, not one global cut, so a shadow
    // across the page doesn't blacken it. See bwParams for the sizes.
    const { radius, offset } = bwParams(image.width, image.height);
    const bw = softenEdges(adaptiveThreshold(gray, image.width, image.height, radius, offset), image.width, image.height);
    for (let i = 0, p = 0; i < bw.length; i++, p += 4) {
      px[p] = px[p + 1] = px[p + 2] = bw[i];
      px[p + 3] = 255;
    }
  } else {
    const table = contrastTable(gray);
    for (let p = 0; p < px.length; p += 4) {
      px[p] = table[px[p]];
      px[p + 1] = table[px[p + 1]];
      px[p + 2] = table[px[p + 2]];
      px[p + 3] = 255;
    }
  }

  const out = makeCanvas(image.width, image.height);
  out.getContext("2d")!.putImageData(image, 0, 0);
  const jpeg = await toBlob(out, firstQuality(opts.look));
  encodedLook.set(jpeg, opts.look);
  return { jpeg, width: image.width, height: image.height };
}

/**
 * The look each rendered page was made in, so shrinking it later starts
 * from the right quality without every caller having to pass it along.
 */
const encodedLook = new WeakMap<Blob, Look>();

/**
 * Re-encodes a page until it's under `budget` bytes: lower quality first,
 * then a smaller picture. A page that already fits is returned untouched.
 */
async function fitToBudget(jpeg: Blob, budget: number): Promise<Blob> {
  const steps = qualitySteps(encodedLook.get(jpeg) ?? "color", QUALITY_STEPS);
  if (jpeg.size <= budget) return jpeg;
  const bitmap = await createImageBitmap(jpeg);
  let width = bitmap.width;
  let height = bitmap.height;
  let best = jpeg;
  for (let round = 0; round < 6; round++) {
    const canvas = makeCanvas(width, height);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
    for (const q of steps) {
      const candidate = await toBlob(canvas, q);
      if (candidate.size < best.size) best = candidate;
      if (candidate.size <= budget) {
        bitmap.close();
        return candidate;
      }
    }
    width = Math.round(width * 0.8);
    height = Math.round(height * 0.8);
  }
  bitmap.close();
  return best;
}
