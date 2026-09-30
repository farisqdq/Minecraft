import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/tenant-access";
import { parsePortalThemePatch } from "@/lib/appearance";

/** The tenant's own light / dark / match-device choice. Scoped by the session; nothing here takes an id. */
export async function PATCH(req: Request) {
  const me = await requireTenantSession();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const theme = parsePortalThemePatch(await req.json().catch(() => null));
  if (!theme) return NextResponse.json({ error: "Pick Light, Dark or Match my device." }, { status: 400 });
  const row = await prisma.tenantAccount.update({
    where: { id: me.accountId },
    data: { uiTheme: theme },
    select: { uiTheme: true },
  });
  return NextResponse.json({ theme: row.uiTheme });
}
