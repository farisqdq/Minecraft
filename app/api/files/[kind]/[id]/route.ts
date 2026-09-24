import { NextResponse } from "next/server";
import { viewableFile } from "@/lib/file-access";
import { fetchFile } from "@/lib/storage";
import { sniffContentType } from "@/lib/blob";

/**
 * Every stored file the app shows — receipts, repair photos, leases — comes
 * through here. The storage URL never reaches the browser; this checks the
 * session against the file first (lib/file-access), then streams it.
 *
 * The file is served as what its bytes say it is, not what was recorded at
 * upload or claimed in a restored backup. Anything that isn't one of the
 * image or PDF formats uploads accept goes out as a download, never as a
 * page this site would render.
 */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const file = await viewableFile(kind, id);
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const bytes = await fetchFile(file.url);
  if (!bytes) return NextResponse.json({ error: "That file is missing from storage." }, { status: 404 });

  const type = sniffContentType(bytes.subarray(0, 16));
  const download = !type || new URL(req.url).searchParams.get("download") === "1";

  const headers = new Headers({
    "Content-Type": type ?? "application/octet-stream",
    "Content-Length": String(bytes.byteLength),
    "Content-Disposition": disposition(download ? "attachment" : "inline", file.filename),
    "X-Content-Type-Options": "nosniff",
    // Signing out should leave nothing of these behind on a shared computer.
    "Cache-Control": "private, no-store",
    "Cross-Origin-Resource-Policy": "same-origin",
  });
  // An image opened on its own gets a document with no powers at all. PDFs
  // are left out: Chrome won't open its viewer inside a sandbox.
  if (type?.startsWith("image/")) {
    headers.set("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  }
  return new Response(new Uint8Array(bytes), { status: 200, headers });
}

/** A Content-Disposition any browser reads, whatever the file was called. */
function disposition(how: "inline" | "attachment", filename: string) {
  const name = (filename || "file").replace(/[\r\n"\\]/g, "").slice(0, 150);
  const ascii = name.replace(/[^\x20-\x7e]/g, "_");
  return `${how}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
