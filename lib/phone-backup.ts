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
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      ...init,
      headers: { ...(init?.headers || {}), Authorization: `Bearer ${SECRET}` },
      cache: "no-store",
      // The VPS can be slow or asleep; don't hang the page forever.
      signal: AbortSignal.timeout(20000),
    });
  } catch {
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
