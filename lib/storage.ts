import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";
import { del, get, put } from "@vercel/blob";
import { storageAccessOf } from "@/lib/file-links";
import { sniffContentType } from "@/lib/blob";

/**
 * Where uploaded files are kept, and the one way in and out of there.
 *
 * Two Vercel Blob stores can be connected:
 *
 *   PRIVATE_BLOB_READ_WRITE_TOKEN — a *private* store. Nothing in it can be
 *     read without this token, so a file's storage URL is useless on its
 *     own. New uploads go here whenever it's set up.
 *   BLOB_READ_WRITE_TOKEN — the original public store. Files there are
 *     readable by anyone holding the exact URL. Used for new uploads only
 *     until a private store exists; "Move old files" copies what's here
 *     into the private store and deletes the originals.
 *
 * Either way the browser is only ever given /api/files links (see
 * lib/file-links), which check the session first.
 *
 * LOCAL_STORAGE_DIR switches to a folder on disk, for testing without
 * Vercel. It refuses to run on Vercel.
 */

const privateToken = () => process.env.PRIVATE_BLOB_READ_WRITE_TOKEN ?? "";
const publicToken = () => process.env.BLOB_READ_WRITE_TOKEN ?? "";

function localDir(): string | null {
  const dir = process.env.LOCAL_STORAGE_DIR;
  if (!dir) return null;
  if (process.env.VERCEL) throw new Error("LOCAL_STORAGE_DIR is for local testing only.");
  return dir;
}

/** A private store is connected, so new files are private and old ones can move. */
export function privateStorageReady(): boolean {
  return Boolean(localDir() || privateToken());
}

export type StoredFile = { url: string; pathname: string };

/* ---- local folder, for tests ---- */

const LOCAL_STORE = "localtest";

function localPath(url: string): string {
  const { pathname } = new URL(url);
  const safe = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const root = path.resolve(localDir()!);
  const full = path.resolve(root, storageAccessOf(url) ?? "x", `.${safe}`);
  if (!full.startsWith(`${root}${path.sep}`)) throw new Error("Outside the local store.");
  return full;
}

async function localPut(pathname: string, bytes: Buffer, access: "private" | "public"): Promise<StoredFile> {
  const withSuffix = `${pathname}-${randomBytes(12).toString("hex")}`;
  const url = `https://${LOCAL_STORE}.${access}.blob.vercel-storage.com/${withSuffix}`;
  const file = localPath(url);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
  return { url, pathname: withSuffix };
}

/* ---- the API the routes use ---- */

/**
 * Keep a file. Private whenever a private store exists; the name always
 * gets a random suffix so no URL can be worked out from another.
 */
export async function storeFile(pathname: string, file: Blob, contentType: string): Promise<StoredFile> {
  if (localDir()) {
    return localPut(pathname, Buffer.from(await file.arrayBuffer()), privateStorageReady() ? "private" : "public");
  }
  const token = privateToken() || publicToken();
  const access = privateToken() ? "private" : "public";
  const blob = await put(pathname, file, { access, token, contentType, addRandomSuffix: true });
  return { url: blob.url, pathname: blob.pathname };
}

/**
 * The store a read-write token belongs to, as it appears in that store's
 * hostnames. Tokens look like vercel_blob_rw_<storeId>_<secret>.
 */
const storeIdOf = (token: string) => (token.split("_")[3] ?? "").toLowerCase();

/** Whether a URL is in the store this token opens — the only place the token is ever sent. */
function inStore(url: string, token: string, access: "private" | "public"): boolean {
  const id = storeIdOf(token);
  return Boolean(id) && new URL(url).hostname.toLowerCase() === `${id}.${access}.blob.vercel-storage.com`;
}

const isLocalUrl = (url: string) => new URL(url).hostname.toLowerCase().startsWith(`${LOCAL_STORE}.`);

/**
 * Uploads are capped at 4 MB, but a restored backup can link to any public
 * Blob URL at all. Reading stops here rather than buffering whatever
 * someone pointed it at.
 */
export const MAX_SERVE_BYTES = 20 * 1024 * 1024;

async function readCapped(stream: ReadableStream<Uint8Array>): Promise<Buffer | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_SERVE_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** A stored file's bytes, from whichever store it's in, or null. */
export async function fetchFile(url: string): Promise<Buffer | null> {
  const access = storageAccessOf(url);
  if (!access) return null;
  if (isLocalUrl(url)) {
    if (!localDir()) return null;
    try {
      return await readFile(localPath(url));
    } catch {
      return null;
    }
  }

  if (access === "private") {
    const token = privateToken();
    if (!token || !inStore(url, token, "private")) return null;
    const result = await get(url, { access: "private", token }).catch(() => null);
    if (!result || result.statusCode !== 200) return null;
    return readCapped(result.stream);
  }

  // A public file needs no credentials, so none are sent — not even to our
  // own public store.
  const res = await fetch(url, { redirect: "error", cache: "no-store" }).catch(() => null);
  if (!res?.ok || !res.body) return null;
  return readCapped(res.body);
}

/**
 * Delete a stored file, if it's in one of our stores. Callers go through
 * releaseBlob, which checks nobody else still links to it.
 */
export async function deleteFile(url: string): Promise<void> {
  const access = storageAccessOf(url);
  if (!access) return;
  if (isLocalUrl(url)) {
    if (!localDir()) return;
    try {
      await rm(localPath(url), { force: true });
    } catch {
      /* outside the store, or already gone */
    }
    return;
  }
  const token = access === "private" ? privateToken() : publicToken();
  if (token && inStore(url, token, access)) await del(url, { token }).catch(() => undefined);
}

/**
 * Copy a file into the private store; the original is left for the caller
 * to release. The type is read from the bytes, like an upload's.
 */
export async function copyToPrivate(url: string): Promise<StoredFile | null> {
  if (!privateStorageReady()) return null;
  const bytes = await fetchFile(url);
  if (!bytes) return null;
  const contentType = sniffContentType(bytes.subarray(0, 16)) ?? "application/octet-stream";
  // Keep the readable part of the name, drop the old random suffix; a new one is added.
  const name =
    decodeURIComponent(new URL(url).pathname.replace(/^\//, "")).replace(/-[A-Za-z0-9]{20,}(?=\.[a-z0-9]+$|$)/, "") ||
    "file";
  if (localDir()) return localPut(name, bytes, "private");
  const blob = await put(name, new Blob([new Uint8Array(bytes)], { type: contentType }), {
    access: "private",
    token: privateToken(),
    contentType,
    addRandomSuffix: true,
  });
  return { url: blob.url, pathname: blob.pathname };
}
