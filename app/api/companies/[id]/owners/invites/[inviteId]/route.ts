import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";
import { requireCompany } from "@/lib/access";
import { siteOrigin } from "@/lib/site";
import { resendOwnerInvite, revokeOwnerInvite } from "@/lib/owners-db";

type Params = { params: Promise<{ id: string; inviteId: string }> };

/** A fresh link for a waiting invite. The old link stops working. */
export async function POST(req: Request, { params }: Params) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, inviteId } = await params;
  if (!(await requireCompany(userId, id, "owner"))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const result = await resendOwnerInvite(id, inviteId, siteOrigin(req.url));
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json(result);
}

/** Withdraw an invite before it's accepted. */
export async function DELETE(_req: Request, { params }: Params) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, inviteId } = await params;
  if (!(await requireCompany(userId, id, "owner"))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await revokeOwnerInvite(id, inviteId))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
