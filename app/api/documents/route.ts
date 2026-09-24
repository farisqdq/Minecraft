import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { companyIdsForUser, requireCompany, requireProperty, requireTenant, requireVendor } from "@/lib/access";
import { BLOB_SETUP_MESSAGE, blobConfigured, inspectUpload } from "@/lib/blob";
import { storeFile } from "@/lib/storage";
import { normalizeKind } from "@/lib/documents";
import { documentInclude, documentsWhere, parseDay, serializeDocument } from "@/lib/documents-db";

/** Documents across your companies, optionally for one property or vendor. */
export async function GET(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const propertyId = url.searchParams.get("property") ?? "";
  const vendors = url.searchParams.get("vendors") === "1";
  const companyIds = await companyIdsForUser(userId);

  return NextResponse.json(
    await documentsWhere({
      companyId: { in: companyIds },
      ...(propertyId ? { propertyId } : {}),
      ...(vendors ? { vendorId: { not: null } } : {}),
    })
  );
}

/**
 * Upload a document and file it against a property, a tenant or a vendor.
 *
 * Which LLC it belongs to is worked out from what it's attached to, never
 * taken from the form, so a document can't be filed into a company by
 * naming it.
 */
export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
  const field = (name: string) => {
    const v = form.get(name);
    return typeof v === "string" ? v.trim() : "";
  };

  const propertyId = field("propertyId");
  const tenantId = field("tenantId");
  const vendorId = field("vendorId");

  // Resolve the target and, through it, the company — each lookup is also
  // the membership check.
  let companyId = "";
  let target: { propertyId: string | null; tenantId: string | null; vendorId: string | null } | null = null;
  if (tenantId) {
    const t = await requireTenant(userId, tenantId);
    if (t) {
      companyId = t.property.companyId;
      target = { propertyId: t.propertyId, tenantId: t.id, vendorId: null };
    }
  } else if (vendorId) {
    const v = await requireVendor(userId, vendorId);
    if (v) {
      companyId = v.companyId;
      target = { propertyId: null, tenantId: null, vendorId: v.id };
    }
  } else if (propertyId) {
    const p = await requireProperty(userId, propertyId);
    if (p) {
      companyId = p.companyId;
      target = { propertyId: p.id, tenantId: null, vendorId: null };
    }
  }
  if (!target || !(await requireCompany(userId, companyId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
  }
  // The type is read from the file's bytes, not from what the browser said.
  const inspected = await inspectUpload(file);
  if ("error" in inspected) return NextResponse.json({ error: inspected.error }, { status: 400 });
  const { contentType } = inspected;

  // After the access check, so nothing about this deployment's setup is told
  // to someone who couldn't have uploaded here anyway.
  if (!blobConfigured()) {
    return NextResponse.json({ error: BLOB_SETUP_MESSAGE }, { status: 503 });
  }

  const title = field("title").slice(0, 120) || (file.name || "Document").replace(/\.[a-z0-9]+$/i, "");
  const rawExpiry = field("expiresOn");
  const expiresOn = parseDay(rawExpiry);
  if (rawExpiry && !expiresOn) {
    return NextResponse.json({ error: "That expiry date isn't a date." }, { status: 400 });
  }

  const safeName = (file.name || "document").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  let blob;
  try {
    // A lease can carry a tenant's SSN: private storage, a random name, and
    // only ever shown through /api/files.
    blob = await storeFile(`documents/${companyId}/${safeName}`, file, contentType);
  } catch (err) {
    console.error("Blob upload failed", err);
    return NextResponse.json(
      { error: "File storage rejected the upload. Check the Blob store in Vercel and try again." },
      { status: 502 }
    );
  }

  const doc = await prisma.document.create({
    data: {
      companyId,
      ...target,
      title,
      kind: normalizeKind(field("kind")),
      url: blob.url,
      pathname: blob.pathname,
      filename: file.name || safeName,
      contentType,
      size: file.size,
      expiresOn,
      note: field("note").slice(0, 500) || null,
      // Sharing only means anything for a tenant's own document.
      shared: Boolean(target.tenantId) && field("shared") === "1",
      uploadedById: userId,
    },
    include: documentInclude,
  });

  return NextResponse.json(serializeDocument(doc), { status: 201 });
}
