import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/tenant-access";

/**
 * The tenant's own say over how they're reminded, and the number to reach
 * them on. Scoped by the session; nothing here takes an id.
 */
export async function PATCH(req: Request) {
  const me = await requireTenantSession();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const data: { emailReminders?: boolean; pushReminders?: boolean; phone?: string | null } = {};
  if (typeof body?.emailReminders === "boolean") data.emailReminders = body.emailReminders;
  if (typeof body?.pushReminders === "boolean") data.pushReminders = body.pushReminders;
  if (typeof body?.phone === "string") data.phone = body.phone.trim().slice(0, 40) || null;
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  const t = await prisma.tenant.update({
    where: { id: me.tenant.id },
    data,
    select: { emailReminders: true, pushReminders: true, phone: true },
  });
  return NextResponse.json({ emailReminders: t.emailReminders, pushReminders: t.pushReminders, phone: t.phone ?? "" });
}
