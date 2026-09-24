import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { IN_PUBLIC_STORE, fileScope, publicFileCount } from "@/lib/file-moves";
import { copyToPrivate, privateStorageReady } from "@/lib/storage";
import { releaseBlob } from "@/lib/blob-release";

/**
 * Moving files uploaded before the private store existed.
 *
 * Those files sit in the public store, where anyone with the exact URL can
 * open them — the app stopped handing those URLs out, but they may still be
 * in old browser histories or backups. This copies each one into the
 * private store, points every row in your LLCs at the copy, and deletes the
 * original once nothing anywhere still links to it.
 *
 * It works in batches, so a big backlog can't run into the function time
 * limit; the page calls it again with the cursor until it's done. A file
 * that can't be read (already gone from storage) is skipped, not retried
 * forever.
 */

const BATCH = 20;

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ publicFiles: await publicFileCount(userId), privateReady: privateStorageReady() });
}

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!privateStorageReady()) {
    return NextResponse.json(
      { error: "Connect a private Blob store to this project in Vercel first, then redeploy." },
      { status: 409 }
    );
  }

  const body = await req.json().catch(() => null);
  const after = typeof body?.after === "string" ? body.after.slice(0, 1000) : "";
  const where = await fileScope(userId);
  const page = { url: { ...IN_PUBLIC_STORE, gt: after } };
  const pick = { select: { url: true }, orderBy: { url: "asc" as const }, take: BATCH, distinct: ["url" as const] };

  const [a, p, d] = await Promise.all([
    prisma.attachment.findMany({ where: { ...where.attachment, ...page }, ...pick }),
    prisma.maintenancePhoto.findMany({ where: { ...where.photo, ...page }, ...pick }),
    prisma.document.findMany({ where: { ...where.document, ...page }, ...pick }),
  ]);
  const urls = [...new Set([...a, ...p, ...d].map((r) => r.url))].sort().slice(0, BATCH);

  let moved = 0;
  let skipped = 0;
  for (const url of urls) {
    const copy = await copyToPrivate(url).catch(() => null);
    if (!copy) {
      skipped++;
      continue;
    }
    const to = { url: copy.url, pathname: copy.pathname };
    await prisma.$transaction([
      prisma.attachment.updateMany({ where: { ...where.attachment, url }, data: to }),
      prisma.maintenancePhoto.updateMany({ where: { ...where.photo, url }, data: to }),
      prisma.document.updateMany({ where: { ...where.document, url }, data: to }),
    ]);
    // Deleted only if no row anywhere still links to the old URL — another
    // account that restored a copy of your backup keeps its link working.
    await releaseBlob(url);
    moved++;
  }

  return NextResponse.json({
    moved,
    skipped,
    // Where the next batch starts; null when this was the last one.
    next: urls.length === BATCH ? urls[urls.length - 1] : null,
  });
}
