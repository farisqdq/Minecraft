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
