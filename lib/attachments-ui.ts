/**
 * The rules the "Attach proof" picker applies in the browser before anything
 * is uploaded. Pure, so they can be tested without a DOM. The server still
 * decides for itself (lib/blob.ts inspectUpload sniffs the bytes); this only
 * turns a wrong pick away early with a sentence instead of a failed upload.
 */
import { MAX_UPLOAD_BYTES, resolveContentType } from "./blob.ts";

/** Most proofs per entry: a receipt, the invoice, a couple of photos. */
export const MAX_PROOFS = 4;

export { MAX_UPLOAD_BYTES };

/**
 * `accept` for "Choose photo or file". image/* alone hides PDFs in the iOS
 * Files sheet; the explicit .heic/.heif keeps iPhone photos selectable in
 * browsers whose image/* list doesn't include them.
 */
export const PROOF_ACCEPT = "image/*,application/pdf,.heic,.heif";

/** `accept` for "Take photo" — the camera only ever produces images. */
export const CAMERA_ACCEPT = "image/*";

export type ProofKind = "image" | "pdf";

/**
 * What a picked file is, by MIME type or — when the phone hands over an
 * empty or odd type, as iOS does for some HEIC files — by extension. Null
 * for anything the server would refuse.
 */
export function proofKind(name: string, type: string): ProofKind | null {
  const resolved = resolveContentType((type || "").toLowerCase(), name || "");
  if (!resolved) return null;
  return resolved === "application/pdf" ? "pdf" : "image";
}

/** HEIC/HEIF: only Safari can draw these, so previews and shrinking may fail elsewhere. */
export function isHeic(name: string, type: string): boolean {
  const t = (type || "").toLowerCase();
  if (t === "image/heic" || t === "image/heif") return true;
  return /\.(heic|heif)$/i.test(name || "");
}

/** A photo the browser can re-encode smaller before upload (see lib/shrinkImage). */
export function canShrink(name: string, type: string): boolean {
  return proofKind(name, type) === "image" && !/gif$/i.test(type || "") && !/\.gif$/i.test(name || "");
}

type Picked = { name: string; type: string; size: number };

/**
 * Splits a fresh pick into what can be queued and why the rest can't.
 * `already` is how many proofs the entry has or has queued. A photo over
 * 4 MB is still queued — it is shrunk before upload — but a PDF (or a GIF)
 * over the limit can't be made smaller, so it is turned away now.
 */
export function screenPicked<T extends Picked>(
  picked: T[],
  already: number
): { accepted: T[]; problems: string[] } {
  const accepted: T[] = [];
  const problems: string[] = [];
  let room = Math.max(0, MAX_PROOFS - already);
  let overflow = 0;
  for (const file of picked) {
    const kind = proofKind(file.name, file.type);
    if (!kind) {
      problems.push(`${file.name || "That file"} isn't a photo or PDF.`);
      continue;
    }
    if (file.size === 0) {
      problems.push(`${file.name || "That file"} is empty.`);
      continue;
    }
    if (file.size > MAX_UPLOAD_BYTES && !canShrink(file.name, file.type)) {
      problems.push(`${file.name} is over 4 MB.`);
      continue;
    }
    if (room === 0) {
      overflow += 1;
      continue;
    }
    accepted.push(file);
    room -= 1;
  }
  if (overflow > 0) {
    problems.push(`Up to ${MAX_PROOFS} files per entry — ${overflow} left out.`);
  }
  return { accepted, problems };
}

/**
 * Which file to upload after trying to shrink it: the smaller copy when
 * shrinking worked, otherwise the original if it fits. A HEIC that a
 * non-Safari browser can't decode comes back unshrunk and goes up as is.
 */
export function chooseUpload<T extends { size: number }>(
  original: T,
  shrunk: T | null
): { file: T } | { error: string } {
  const pick = shrunk && shrunk.size > 0 && shrunk.size < original.size ? shrunk : original;
  if (pick.size > MAX_UPLOAD_BYTES) return { error: "is over 4 MB and couldn't be made smaller" };
  return { file: pick };
}

/** "1 proof" / "3 proofs" — the paperclip's label. */
export function proofCountLabel(n: number): string {
  return `${n} ${n === 1 ? "proof" : "proofs"}`;
}

/** A long camera filename, cut in the middle so the extension still shows. */
export function shortName(name: string, max = 22): string {
  if (name.length <= max) return name;
  const keep = max - 1;
  const tail = Math.min(8, Math.floor(keep / 2));
  return `${name.slice(0, keep - tail)}…${name.slice(-tail)}`;
}

/**
 * The name a scan starts with when it's attached as proof (scan-anywhere).
 * Rent paid on paper is nearly always a check; anything else is a receipt.
 * `dayLabel` is the entry's date as the page shows it.
 */
export function proofScanTitle(type: string | null | undefined, dayLabel: string): string {
  const what = type === "rent" ? "Rent check" : "Receipt";
  const day = (dayLabel || "").trim();
  return day ? `${what} – ${day}` : what;
}

/**
 * "<name>.pdf" for a scanned proof: characters a file system or a download
 * dialog chokes on become dashes, and a long name is cut so the paperclip
 * strip and the stored filename stay readable.
 */
export function scanFileName(title: string, max = 80): string {
  let base = (title || "")
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.pdf$/i, "")
    .replace(/^[.\s-]+|[.\s-]+$/g, "");
  if (base.length > max) base = base.slice(0, max).trimEnd();
  return `${base || "Scan"}.pdf`;
}
