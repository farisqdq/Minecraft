import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";
import { requireCompany } from "@/lib/access";
import { revokeOwner, setOwnerAssignments } from "@/lib/owners-db";

type Params = { params: Promise<{ id: string; ownerId: string }> };

/** Change which of this LLC's properties an owner may read. */
export async function PATCH(req: Request, { params }: Params) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, ownerId } = await params;
  if (!(await requireCompany(userId, id, "owner"))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await req.json().catch(() => null);
  const result = await setOwnerAssignments(id, ownerId, body?.propertyIds);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.error === "Not found" ? 404 : 400 });
  }
  return NextResponse.json(result);
}

/** Take their access to this LLC's properties away. */
export async function DELETE(_req: Request, { params }: Params) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, ownerId } = await params;
  if (!(await requireCompany(userId, id, "owner"))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const result = await revokeOwner(id, ownerId);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, ...result });
}
