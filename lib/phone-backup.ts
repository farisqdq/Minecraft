/**
 * Talks to the phone backup server on the VPS from Rent Roll's side.
 *
 * The VPS server (phone-backup/server) holds the phones' files and is reached
 * with a shared secret only this server knows. The browser never sees the
 * secret or the VPS directly: the admin's Phones page calls Rent Roll's own
 * /api/phones/*, these helpers add the secret and call the VPS, and file
 * downloads come back as short-lived signed links (HMAC matching downloadSig
 * in the Go server).
 */
import { createHmac } from "crypto";

const BASE = (process.env.PHONE_BACKUP_URL || "").replace(/\/+$/, "");
const SECRET = process.env.PHONE_BACKUP_SECRET || "";

/** True once both settings are in place; the page shows setup help otherwise. */
export function phoneBackupConfigured(): boolean {
  return BASE.length > 0 && SECRET.length >= 32;
}

export function phoneBackupHost(): string {
  try {
    return new URL(BASE).host;
  } catch {
    return BASE;
  }
}

class BackupDown extends Error {}

async function call(path: string, init?: RequestInit): Promise<any> {
  if (!phoneBackupConfigured()) throw new BackupDown("not configured");
  // Reads are safe to repeat, so a dropped connection to the VPS (it blips
  // now and then) gets two quick retries before the page calls it offline.
  // Writes (add/rename/delete) are tried once so they can't double up.
  const method = (init?.method || "GET").toUpperCase();
  const tries = method === "GET" ? 3 : 1;
  let res: Response | null = null;
  for (let i = 0; i < tries; i++) {
    try {
      res = await fetch(BASE + path, {
        ...init,
        headers: { ...(init?.headers || {}), Authorization: `Bearer ${SECRET}` },
        cache: "no-store",
        // The VPS can be slow or asleep; don't hang the page forever.
        signal: AbortSignal.timeout(8000),
      });
      break;
    } catch {
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  if (!res) {
    throw new BackupDown("The backup server on your VPS didn't answer. It may be off or offline.");
  }
  const text = await res.text();
  const data = text ? safeJson(text) : {};
  if (!res.ok) {
    throw new Error(data?.error || `The backup server answered ${res.status}.`);
  }
  return data;
}

function safeJson(t: string): any {
  try {
    return JSON.parse(t);
  } catch {
    return {};
  }
}

export function isBackupDown(e: unknown): boolean {
  return e instanceof BackupDown;
}

// ---- admin operations, mirrored from the Go server's /api/admin ----

export const getSummary = () => call("/api/admin/summary");
export const addPhone = (name: string) =>
  call("/api/admin/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
export const newCode = (id: string) => call(`/api/admin/devices/${encodeURIComponent(id)}/code`, { method: "POST" });
export const requestBackup = (id: string) => call(`/api/admin/devices/${encodeURIComponent(id)}/request`, { method: "POST" });
export const renamePhone = (id: string, name: string) =>
  call(`/api/admin/devices/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
export const removePhone = (id: string, withFiles: boolean) =>
  call(`/api/admin/devices/${encodeURIComponent(id)}${withFiles ? "?files=1" : ""}`, { method: "DELETE" });
export const listFiles = (id: string, dir: string) =>
  call(`/api/admin/devices/${encodeURIComponent(id)}/list?dir=${encodeURIComponent(dir)}`);

/** Downloads a (small) backed-up file's text, server-side, for parsing. */
export async function fetchFileText(deviceId: string, path: string, maxBytes = 25 * 1024 * 1024): Promise<string> {
  if (!phoneBackupConfigured()) throw new BackupDown("not configured");
  const res = await fetch(fileLink(deviceId, path, false), { cache: "no-store", signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Couldn't read the file (${res.status}).`);
  const len = Number(res.headers.get("content-length") || 0);
  if (len > maxBytes) throw new Error("That backup file is too large to open here.");
  return res.text();
}

/** The newest file in one of a phone's folders (e.g. "Texts"), or null. */
export async function newestIn(deviceId: string, folder: string): Promise<{ path: string; mtime: string } | null> {
  const { entries } = await listFiles(deviceId, folder);
  const files = (entries || []).filter((e: any) => !e.dir);
  if (files.length === 0) return null;
  files.sort((a: any, b: any) => (a.mtime < b.mtime ? 1 : -1));
  return { path: files[0].path, mtime: files[0].mtime };
}

/**
 * A link straight to one backed-up file on the VPS, good for 10 minutes.
 * download=true makes the browser save it rather than show it. The signature
 * must match downloadSig() in the Go server exactly.
 */
export function fileLink(deviceId: string, path: string, download: boolean): string {
  const exp = Math.floor(Date.now() / 1000) + 600;
  const sig = createHmac("sha256", SECRET).update(`dl\n${deviceId}\n${path}\n${exp}`).digest("hex");
  const q = new URLSearchParams({ d: deviceId, p: path, e: String(exp), s: sig });
  if (download) q.set("a", "1");
  return `${BASE}/dl?${q.toString()}`;
}

/**
 * Restore links. The admin makes one for a phone and sends it to whoever
 * holds that phone; they open it (no sign-in) and download that one phone's
 * backup until it expires. The token is an HMAC of the device and expiry
 * with the shared secret, so it can't be forged or pointed at another phone,
 * and it never carries the secret itself.
 */
function restoreSig(deviceId: string, exp: number): string {
  return createHmac("sha256", SECRET).update(`restore\n${deviceId}\n${exp}`).digest("hex");
}

/** A restore link valid for `days` days (default 7). */
export function restoreLink(origin: string, deviceId: string, days = 7): string {
  const exp = Math.floor(Date.now() / 1000) + days * 86400;
  const q = new URLSearchParams({ d: deviceId, e: String(exp), s: restoreSig(deviceId, exp) });
  return `${origin.replace(/\/+$/, "")}/restore?${q.toString()}`;
}

/** True when a restore token is for this device and hasn't expired. */
export function restoreTokenValid(deviceId: string, exp: string, sig: string): boolean {
  const n = Number(exp);
  if (!Number.isFinite(n) || Math.floor(Date.now() / 1000) > n) return false;
  const want = restoreSig(deviceId, n);
  // timing-safe compare
  if (want.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
