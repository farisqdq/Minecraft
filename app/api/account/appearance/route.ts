import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { appearanceFrom, parseAppearancePatch } from "@/lib/appearance";

/** Saves the signed-in landlord's own layout / mode / accent (Settings > Appearance). */
export async function PATCH(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const patch = parseAppearancePatch(await req.json().catch(() => null));
  if (!patch) return NextResponse.json({ error: "That isn't a choice on the Appearance page." }, { status: 400 });
  const row = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(patch.layout ? { uiLayout: patch.layout } : {}),
      ...(patch.theme ? { uiTheme: patch.theme } : {}),
      ...("accent" in patch ? { uiAccent: patch.accent } : {}),
    },
    select: { uiLayout: true, uiTheme: true, uiAccent: true },
  });
  return NextResponse.json(appearanceFrom(row));
}
