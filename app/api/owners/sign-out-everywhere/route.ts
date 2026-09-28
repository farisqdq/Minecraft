import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwnerSession } from "@/lib/owner-access";

/**
 * End every session for this owner login — every phone and laptop, this
 * one included. Bumping sessionVersion is what does it: every request
 * compares the token's copy against the account's.
 */
export async function POST() {
  const me = await requireOwnerSession();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prisma.propertyOwner.update({ where: { id: me.ownerId }, data: { sessionVersion: { increment: 1 } } });
  return NextResponse.json({ ok: true, signedOut: true });
}
