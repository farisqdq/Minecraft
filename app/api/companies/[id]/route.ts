import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireCompany } from "@/lib/access";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requireCompany(userId, id, "owner"))) {
    return NextResponse.json({ error: "Only an owner can change this LLC." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const data: { name?: string; contactPhone?: string | null; contactEmail?: string | null } = {};

  if ("name" in body) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "Enter a name for the LLC." }, { status: 400 });
    data.name = name.slice(0, 120);
  }
  // The tenant-facing contact. Blank clears it, and the portal then shows no
  // contact card at all rather than an empty one.
  if ("contactPhone" in body) {
    const phone = typeof body.contactPhone === "string" ? body.contactPhone.trim().slice(0, 40) : "";
    data.contactPhone = phone || null;
  }
  if ("contactEmail" in body) {
    const email = typeof body.contactEmail === "string" ? body.contactEmail.trim().toLowerCase().slice(0, 200) : "";
    if (email && !email.includes("@")) {
      return NextResponse.json({ error: "That doesn't look like an email address." }, { status: 400 });
    }
    data.contactEmail = email || null;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const company = await prisma.company.update({ where: { id }, data });
  return NextResponse.json({
    id: company.id,
    name: company.name,
    contactPhone: company.contactPhone ?? "",
    contactEmail: company.contactEmail ?? "",
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requireCompany(userId, id, "owner"))) {
    return NextResponse.json({ error: "Only an owner can delete this LLC." }, { status: 403 });
  }

  await prisma.company.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
