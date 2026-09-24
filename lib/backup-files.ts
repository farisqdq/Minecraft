import { createHmac, timingSafeEqual } from "crypto";
import { storageAccessOf } from "./file-links.ts";

/**
 * A backup carries each file's storage URL so a restore can link it back up.
 * For a file in the private store, that URL is harmless on its own — but
 * the app will fetch it with its own credentials for whoever has a row
 * pointing at it. Without a check, anyone holding a copy of your backup
 * could import it into their own account and read your leases through it.
 *
 * So each private link in a backup is signed for the account that made it,
 * by email: that survives a restore into a fresh database, where every id
 * changes. On import, a private link comes back only with a signature
 * matching the account importing it. Public links need none — the URL
 * already opens the file for anyone.
 */

const LABEL = "rent-roll-backup-file";

export function backupFileKey(secret: string, email: string, url: string): string {
  return createHmac("sha256", secret)
    .update(`${LABEL}|${email.trim().toLowerCase()}|${url}`)
    .digest("base64url")
    .slice(0, 43);
}

/** Whether a file link from a backup may be restored into this account. */
export function acceptBackupFile(opts: { secret: string; email: string; url: string; key: string }): boolean {
  let parsed: URL;
  try {
    parsed = new URL(opts.url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const access = storageAccessOf(opts.url);
  if (access === "public") return true;
  if (access !== "private" || !opts.secret || !opts.key) return false;
  const expected = Buffer.from(backupFileKey(opts.secret, opts.email, opts.url));
  const given = Buffer.from(opts.key);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
