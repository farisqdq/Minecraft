export const BLOB_SETUP_MESSAGE =
  "File storage isn't set up yet. In Vercel, open this project's Storage tab, add Blob, " +
  "and redeploy — then proof photos will upload here.";

export function blobConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export const ALLOWED_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/gif",
  "application/pdf",
];

const EXTENSION_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  gif: "image/gif",
  pdf: "application/pdf",
};

/**
 * Phone browsers sometimes hand over a file with an empty or unfamiliar MIME
 * type, so fall back to the extension before turning a real photo away.
 */
export function resolveContentType(type: string, filename: string) {
  if (ALLOWED_TYPES.includes(type)) return type;
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return EXTENSION_TYPES[ext] ?? null;
}

// Serverless request bodies cap out around 4.5 MB; the browser shrinks photos
// well below this before they ever get here.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * What a file actually is, from its first bytes — not what the browser said.
 *
 * The declared type and the file name are both chosen by whoever uploads,
 * so either can call a web page, a script or a program "photo.jpg". The
 * leading bytes of every format accepted here are fixed, so reading them
 * decides. Returns the real type, or null for anything else.
 */
export function sniffContentType(head: Uint8Array): string | null {
  const at = (i: number, ...bytes: number[]) => bytes.every((b, j) => head[i + j] === b);
  const ascii = (i: number, s: string) => at(i, ...Array.from(s, (c) => c.charCodeAt(0)));

  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (ascii(0, "GIF87a") || ascii(0, "GIF89a")) return "image/gif";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  if (ascii(0, "%PDF-")) return "application/pdf";
  // HEIC/HEIF (iPhone photos): an ISO box whose "ftyp" brand is one of these.
  if (ascii(4, "ftyp")) {
    const brand = String.fromCharCode(...head.slice(8, 12));
    if (["heic", "heix", "hevc", "hevx", "heim", "heis"].includes(brand)) return "image/heic";
    if (["mif1", "msf1"].includes(brand)) return "image/heif";
  }
  return null;
}

/**
 * Everything an upload route needs to decide on a file: the type is read
 * from the bytes, it must be one this route takes, and it must fit.
 */
export async function inspectUpload(
  file: File,
  opts: { imagesOnly?: boolean } = {}
): Promise<{ contentType: string } | { error: string }> {
  if (file.size > MAX_UPLOAD_BYTES) return { error: "That file is too large — keep it under 4 MB." };
  if (file.size === 0) return { error: "That file is empty." };
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const contentType = sniffContentType(head);
  if (!contentType || (opts.imagesOnly && !contentType.startsWith("image/"))) {
    return {
      error: opts.imagesOnly
        ? "Attach a photo (JPG, PNG, HEIC or WebP)."
        : "Attach a photo (JPG, PNG, HEIC, WebP) or a PDF.",
    };
  }
  return { contentType };
}
