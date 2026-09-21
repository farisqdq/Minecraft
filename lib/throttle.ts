import { prisma } from "@/lib/prisma";
import { afterFailure, lockedFor } from "@/lib/throttle-rules";

export * from "@/lib/throttle-rules";

/**
 * Storage for the rules in throttle-rules.ts. It lives in the database rather
 * than in memory because the app runs on serverless functions — memory is
 * per-instance and gone between requests.
 */

/** Seconds of pause left across these keys, or 0 when none is paused. */
export async function isThrottled(keys: (string | null)[]): Promise<number> {
  const live = keys.filter((k): k is string => Boolean(k));
  if (live.length === 0) return 0;
  const rows = await prisma.loginThrottle.findMany({ where: { key: { in: live } } });
  const now = new Date();
  return rows.reduce((worst, r) => Math.max(worst, lockedFor(r, now)), 0);
}

/** One more wrong answer against each key, with each key's own ceiling. */
export async function recordFailure(entries: { key: string | null; max: number }[]) {
  const now = new Date();
  for (const { key, max } of entries) {
    if (!key) continue;
    const row = await prisma.loginThrottle.findUnique({ where: { key } });
    const next = afterFailure(row, max, now);
    await prisma.loginThrottle.upsert({
      where: { key },
      create: { key, ...next },
      update: next,
    });
  }
}

/**
 * A right answer wipes the account's slate. The address key is deliberately
 * left alone — one good login from a machine that has been guessing at forty
 * accounts is not a reason to trust it. Also sweeps rows nobody has touched
 * in a day, so the table can't grow without bound.
 */
export async function clearFailures(key: string) {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await prisma.$transaction([
    prisma.loginThrottle.deleteMany({ where: { key } }),
    prisma.loginThrottle.deleteMany({ where: { updatedAt: { lt: dayAgo } } }),
  ]);
}
