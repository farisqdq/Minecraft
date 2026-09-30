/**
 * The pure parts of the in-app file viewer (app/components/FileViewer.tsx):
 * what kind of file something is, the download link for it, which clicks the
 * viewer should take over, and how big a PDF page can be drawn on a phone.
 *
 * Kept out of the component so they can be tested without a browser.
 */

export type ViewKind = "image" | "pdf" | "other";

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "avif", "bmp", "svg"]);

/** The part after the last dot of a name or URL path, lower-cased; "" if none. */
export function extensionOf(name: string | undefined | null): string {
  if (!name) return "";
  const clean = name.split(/[?#]/)[0];
  const base = clean.slice(clean.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** A MIME type alone, without parameters; "" if it says nothing useful. */
function kindFromMime(mime: string | undefined | null): ViewKind | null {
  const m = (mime ?? "").split(";")[0].trim().toLowerCase();
  if (!m || m === "application/octet-stream" || m === "binary/octet-stream") return null;
  if (m === "application/pdf" || m === "application/x-pdf") return "pdf";
  if (m.startsWith("image/")) return "image";
  return "other";
}

function kindFromName(name: string | undefined | null): ViewKind | null {
  const ext = extensionOf(name);
  if (!ext) return null;
  if (ext === "pdf") return "pdf";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  return "other";
}

/**
 * How to show a file: by the type the page already knows, else by the
 * file's name, else by its URL. Null means nothing gave it away — the viewer
 * then asks the server (the response's Content-Type decides).
 */
export function viewKindOf(file: { mime?: string | null; name?: string | null; url?: string | null }): ViewKind | null {
  return kindFromMime(file.mime) ?? kindFromName(file.name) ?? kindFromName(file.url);
}

/** For the answer the server gave, once nothing else could say. */
export function viewKindFromContentType(contentType: string | null | undefined): ViewKind {
  return kindFromMime(contentType) ?? "other";
}

/** The same file, sent as a download (see /api/files: ?download=1). */
export function downloadHref(url: string): string {
  const [beforeHash, hash = ""] = url.split("#", 2);
  if (/[?&]download=1(&|$)/.test(beforeHash)) return url;
  const joined = `${beforeHash}${beforeHash.includes("?") ? "&" : "?"}download=1`;
  return hash ? `${joined}#${hash}` : joined;
}

/**
 * Only a plain click or tap opens the viewer. Ctrl/⌘-click, shift-click,
 * middle-click and the like keep doing what the browser does with a link —
 * a new tab, a new window, a download — so the real href still works.
 */
export function isPlainClick(e: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented?: boolean;
}): boolean {
  return !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

/**
 * The scale to draw a PDF page at so it fills `cssWidth` sharply on a screen
 * with this pixel ratio, without the canvas going past `maxPixels` (a phone
 * runs out of canvas memory long before a desktop does). Returns the scale
 * for the drawing and the page's size on screen in CSS pixels.
 */
export function pdfPageScale(
  page: { width: number; height: number },
  cssWidth: number,
  devicePixelRatio: number,
  maxPixels = 4_000_000
): { scale: number; cssWidth: number; cssHeight: number } {
  const w = Math.max(1, page.width);
  const h = Math.max(1, page.height);
  const shownWidth = Math.max(1, cssWidth);
  const shownHeight = (shownWidth * h) / w;
  const dpr = Math.max(1, Math.min(devicePixelRatio || 1, 3));
  let scale = (shownWidth * dpr) / w;
  const pixels = w * scale * h * scale;
  if (pixels > maxPixels) scale *= Math.sqrt(maxPixels / pixels);
  return { scale, cssWidth: shownWidth, cssHeight: shownHeight };
}
