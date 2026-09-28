import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { requireCompany } from "@/lib/access";
import { isThrottled, pauseMessage, recordFailure } from "@/lib/throttle";
import { siteOrigin } from "@/lib/site";
import { issueOwnerReset } from "@/lib/owner-reset-db";

/**
 * "Send password reset" from Property owners. Only an owner of the LLC, and
 * only for a property owner who can see one of this LLC's properties — an
 * owner id from some other LLC is a 404. The link is emailed; when email
 * isn't set up it comes back to show on screen, as invite links do.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; ownerId: string }> }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, ownerId } = await params;
  if (!(await requireCompany(me.id, id, "owner"))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const owner = await prisma.propertyOwner.findFirst({
    where: { id: ownerId, access: { some: { property: { companyId: id } } } },
    select: { id: true, email: true, sessionVersion: true },
  });
  if (!owner) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // A handful an hour per owner: enough to fix a typo, not enough to flood them.
  const key = `owner-reset-send:${owner.id}`;
  const paused = await isThrottled([key]);
  if (paused) return NextResponse.json({ error: pauseMessage(paused) }, { status: 429 });
  await recordFailure([{ key, max: 5 }]);

  const result = await issueOwnerReset({ owner, issuedBy: me.email, origin: siteOrigin(req.url) });
  return NextResponse.json({ sent: result?.sent ?? false, link: result && !result.sent ? result.link : "" });
}
