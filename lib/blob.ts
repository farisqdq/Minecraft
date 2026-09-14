export const BLOB_SETUP_MESSAGE =
  "File storage isn't set up yet. In Vercel, open this project's Storage tab, add Blob, " +
  "and redeploy — then proof photos will upload here.";

export function blobConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/gif",
  "application/pdf",
];

// Serverless request bodies cap out around 4.5 MB; the browser shrinks photos
// well below this before they ever get here.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
