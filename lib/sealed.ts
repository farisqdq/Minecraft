import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "crypto";

/**
 * Small secrets at rest — today, each account's authenticator-app secret.
 *
 * AES-256-GCM with a key derived (HKDF) from NEXTAUTH_SECRET. Someone with a
 * copy of the database but not the deployment's environment gets ciphertext
 * they can't turn into login codes. GCM also detects tampering: a modified
 * value fails to open rather than decrypting to something else.
 */

const VERSION = "v1";

function keyFrom(secret: string): Buffer {
  if (!secret) throw new Error("No key material for sealing.");
  return Buffer.from(hkdfSync("sha256", secret, "rent-roll", "sealed-secrets/v1", 32));
}

export function sealWith(secret: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), body.toString("base64url"), tag.toString("base64url")].join(".");
}

/** The plaintext, or null if it was sealed with another key or altered. */
export function openWith(secret: string, sealed: string): string | null {
  const [version, iv, body, tag] = sealed.split(".");
  if (version !== VERSION || !iv || !body || !tag) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

const envSecret = () => process.env.NEXTAUTH_SECRET ?? "";
export const seal = (plaintext: string) => sealWith(envSecret(), plaintext);
export const open = (sealed: string) => openWith(envSecret(), sealed);
