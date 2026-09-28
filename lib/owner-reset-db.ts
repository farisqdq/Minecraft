import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { hashToken, newResetToken, ownerResetLink, passwordProblem, plausibleToken, resetIsLive } from "@/lib/password-reset";
import { resetEmail, sendEmail } from "@/lib/email";
import { accountKey, clearFailures } from "@/lib/throttle";

/**
 * Owner-portal password resets: the landlord reset's rules (lib/password-
 * reset.ts) against the owner's own table, so an owner's link can only
 * reset an owner's password and always lands on the owner sign-in.
 */

/** A link this fresh is left standing: asking again neither retires it nor sends another. */
export const FRESH_MS = 5 * 60 * 1000;

/**
 * Make a new link for an owner, retiring any unused one, and email it.
 * Returns the link so a landlord can hand it over when email isn't set up.
 */
export async function issueOwnerReset(opts: {
  owner: { id: string; email: string; sessionVersion: number };
  issuedBy: string;
  origin: string;
  /** Leave a link younger than FRESH_MS alone (the self-service path). */
  respectFresh?: boolean;
}): Promise<{ link: string; sent: boolean } | null> {
  const { owner, issuedBy, origin } = opts;
  if (opts.respectFresh) {
    const recent = await prisma.ownerPasswordReset.findFirst({
      where: { ownerId: owner.id, usedAt: null, createdAt: { gt: new Date(Date.now() - FRESH_MS) } },
    });
    if (recent) return null;
  }
  const { token, tokenHash, expiresAt } = newResetToken();
  await prisma.$transaction([
    prisma.ownerPasswordReset.deleteMany({ where: { ownerId: owner.id, usedAt: null } }),
    prisma.ownerPasswordReset.create({
      data: { ownerId: owner.id, tokenHash, expiresAt, issuedBy, sessionVersion: owner.sessionVersion },
    }),
  ]);
  const link = ownerResetLink(origin, token);
  const result = await sendEmail({ to: owner.email, ...resetEmail(link, "Rent Roll owner portal") });
  return { link, sent: result.sent };
}

export type ResetOutcome = { ok: true } | { ok: false; error: string; status: number; badToken?: boolean };

const EXPIRED: ResetOutcome = {
  ok: false,
  error: "That link has expired or was already used. Ask for a new one.",
  status: 400,
  badToken: true,
};

/**
 * Set a new password from a link. Claims the token and changes the password
 * together, then signs the owner out everywhere by moving their session
 * version on — the old password's sessions end on their next click.
 */
export async function useOwnerReset(token: unknown, password: unknown): Promise<ResetOutcome> {
  const problem = passwordProblem(password);
  if (problem) return { ok: false, error: problem, status: 400 };
  if (!plausibleToken(token)) return EXPIRED;
  const reset = await prisma.ownerPasswordReset.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { owner: { select: { id: true, email: true, sessionVersion: true } } },
  });
  if (!reset || !resetIsLive(reset) || reset.sessionVersion !== reset.owner.sessionVersion) return EXPIRED;

  const passwordHash = await bcrypt.hash(password as string, 12);
  const done = await prisma.$transaction(async (tx) => {
    const claim = await tx.ownerPasswordReset.updateMany({
      where: { id: reset.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claim.count !== 1) return false;
    await tx.propertyOwner.update({
      where: { id: reset.ownerId },
      data: { passwordHash, sessionVersion: { increment: 1 } },
    });
    await tx.ownerPasswordReset.deleteMany({ where: { ownerId: reset.ownerId, id: { not: reset.id } } });
    return true;
  });
  if (!done) return EXPIRED;
  await clearFailures(accountKey("owner", reset.owner.email));
  return { ok: true };
}
