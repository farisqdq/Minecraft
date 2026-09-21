/**
 * The arithmetic behind sign-in throttling, kept free of any database import
 * so it can be tested on its own. lib/throttle.ts wraps it with storage.
 *
 * The rules are plain: ten wrong passwords for one account inside fifteen
 * minutes and that account is paused for fifteen minutes; forty wrong
 * passwords from one address inside fifteen minutes, across any accounts,
 * and that address is paused the same way. A right password clears the
 * account's count.
 *
 * Pausing by account is a trade: someone who knows your email can pause your
 * sign-in on purpose by getting your password wrong ten times. The pause is
 * kept short for exactly that reason — fifteen minutes is an annoyance, not
 * a lockout — and the door stays shut to guessing meanwhile, which is the
 * outcome that matters. A tenant who is stuck can be handed a fresh code by
 * their landlord; a landlord can wait a quarter of an hour.
 */

export const WINDOW_MS = 15 * 60 * 1000;
export const LOCK_MS = 15 * 60 * 1000;
export const MAX_PER_ACCOUNT = 10;
export const MAX_PER_IP = 40;

export type ThrottleRow = {
  failures: number;
  windowStart: Date;
  lockedUntil: Date | null;
};

/** Seconds until a row's pause lifts, or 0 when it isn't paused. */
export function lockedFor(row: ThrottleRow | null, now = new Date()): number {
  if (!row?.lockedUntil) return 0;
  const remaining = row.lockedUntil.getTime() - now.getTime();
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

/**
 * The row as it should look after one more failure: a failure outside the
 * window starts a fresh count, one inside it adds up, and reaching `max`
 * sets the pause.
 */
export function afterFailure(row: ThrottleRow | null, max: number, now = new Date()): ThrottleRow {
  const inWindow = row !== null && now.getTime() - row.windowStart.getTime() < WINDOW_MS;
  const failures = inWindow ? row.failures + 1 : 1;
  return {
    failures,
    windowStart: inWindow ? row.windowStart : now,
    lockedUntil: failures >= max ? new Date(now.getTime() + LOCK_MS) : (row?.lockedUntil ?? null),
  };
}

/** "user" and "tenant" are the two sign-in doors; the address rule is shared. */
export type ThrottleKind = "user" | "tenant";

export function accountKey(kind: ThrottleKind, email: string) {
  return `${kind}:${email.trim().toLowerCase()}`;
}

export function ipKey(ip: string | null) {
  return ip ? `ip:${ip}` : null;
}

/**
 * The client's address as the platform reports it. On Vercel the first entry
 * of x-forwarded-for is the real client; anything after it is infrastructure.
 * A local Next dev server fills it in with 127.0.0.1, so the address rule
 * engages there too. Null only when there is no header at all, which simply
 * skips the per-address rule rather than failing closed.
 */
export function clientIp(headers: Headers | Record<string, unknown> | undefined | null): string | null {
  if (!headers) return null;
  const raw =
    headers instanceof Headers
      ? headers.get("x-forwarded-for")
      : (headers["x-forwarded-for"] ?? headers["X-Forwarded-For"]);
  const first = typeof raw === "string" ? raw.split(",")[0]?.trim() : "";
  return first ? first.slice(0, 64) : null;
}

/** "Try again in 12 minutes" — never "in 0 minutes". */
export function pauseMessage(seconds: number) {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `Too many attempts. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
}
