import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";
import { requireCompany } from "@/lib/access";
import { emailProblem } from "@/lib/portal";
import { siteOrigin } from "@/lib/site";
import { createOwnerInvite } from "@/lib/owners-db";

/**
 * Invite an email address to the owner portal for some of this LLC's
 * properties. The link goes by email when the site can send it; either
 * way it comes back in the response so the landlord can hand it over
 * themselves, the way tenant codes are handed over.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requireCompany(userId, id, "owner"))) {
    return NextResponse.json({ error: "Only an owner of this LLC can invite property owners." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase().slice(0, 200) : "";
  const problem = emailProblem(email);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 120) : "";

  const result = await createOwnerInvite({
    companyId: id,
    email,
    name,
    propertyIds: body?.propertyIds,
    invitedById: userId,
    origin: siteOrigin(req.url),
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result, { status: 201 });
}
