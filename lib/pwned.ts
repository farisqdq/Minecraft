import { createHash } from "crypto";

/**
 * Have I Been Pwned "range" check (k-anonymity): only the first 5 hex
 * characters of the password's SHA-1 ever leave this server, never the
 * password or its full hash. Returns an error message when the password
 * shows up in a known breach, or null when it doesn't.
 *
 * If the service is slow or down, the check is skipped (returns null) so
 * nobody is locked out of setting a password; the length rule still holds.
 */
export async function breachedPasswordProblem(password: unknown): Promise<string | null> {
  if (typeof password !== "string" || !password) return null;
  const sha1 = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true", "User-Agent": "eqal.rentals password check" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = await res.text();
    for (const line of body.split("\n")) {
      const [hashSuffix, count] = line.trim().split(":");
      if (hashSuffix === suffix && Number(count) > 0) {
        return "That password has shown up in a known data breach. Please choose a different one.";
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
