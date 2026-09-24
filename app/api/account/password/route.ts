import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { passwordProblem } from "@/lib/portal";
import { accountUser, bad, checkPassword, reauthPaused, unauthorized } from "@/lib/account";

/**
 * Change the password. Every session ends with it — including this one — and
 * every trusted device is forgotten, because the reason to change a password
 * is usually that someone else might know it.
 */
export async function POST(req: Request) {
  const user = await accountUser();
  if (!user) return unauthorized();
  const paused = await reauthPaused(user.id);
  if (paused) return paused;

  const body = await req.json().catch(() => null);
  if (!(await checkPassword(user, body?.current))) return bad("Your current password isn't right.", 403);

  const next = typeof body?.next === "string" ? body.next : "";
  const problem = passwordProblem(next);
  if (problem) return bad(problem);
  if (next.length > 200) return bad("That's too long.");
  if (await bcrypt.compare(next, user.passwordHash)) return bad("That's the password you have now.");

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(next, 12), sessionVersion: { increment: 1 } },
  });
  return NextResponse.json({ ok: true, signedOut: true });
}
