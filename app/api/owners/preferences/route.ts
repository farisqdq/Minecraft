import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwnerSession } from "@/lib/owner-access";

/** The owner's own say over the monthly email. Scoped by the session; nothing here takes an id. */
export async function PATCH(req: Request) {
  const me = await requireOwnerSession();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (typeof body?.monthlyEmail !== "boolean") {
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  }
  const row = await prisma.propertyOwner.update({
    where: { id: me.ownerId },
    data: { monthlyEmail: body.monthlyEmail },
    select: { monthlyEmail: true },
  });
  return NextResponse.json(row);
}
