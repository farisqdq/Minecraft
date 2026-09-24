import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { accountUser, unauthorized } from "@/lib/account";

/**
 * End every session for this account — phones, laptops, a browser left open
 * at the office — and forget every trusted device. The one making the
 * request is signed out too; signing back in is the proof it was you.
 */
export async function POST() {
  const user = await accountUser();
  if (!user) return unauthorized();
  await prisma.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } });
  return NextResponse.json({ ok: true, signedOut: true });
}
