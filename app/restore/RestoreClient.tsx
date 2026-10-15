"use client";

import BackupBrowser, { type BrowserUrls } from "../components/BackupBrowser";

/**
 * What a staff member sees when they open a restore link. No sign-in, no app
 * chrome — just their phone's backup to look through and download. Photos and
 * videos show as a gallery; contacts and texts download as files they put
 * back with the usual phone tools.
 */
export default function RestoreClient({ d, e, s }: { d: string; e: string; s: string }) {
  const tok = `d=${encodeURIComponent(d)}&e=${encodeURIComponent(e)}&s=${encodeURIComponent(s)}`;
  const urls: BrowserUrls = {
    listUrl: (dir) => `/api/restore/list?${tok}&dir=${encodeURIComponent(dir)}`,
    fileUrl: (path, download) => `/api/restore/file?${tok}&p=${encodeURIComponent(path)}${download ? "&download=1" : ""}`,
  };
  return (
    <main style={{ minHeight: "100vh", background: "#F6F5F1", color: "#23281F", font: "16px system-ui, sans-serif" }}>
      <header style={{ background: "#2E6A48", color: "#fff", padding: "20px 18px" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto", display: "flex", alignItems: "center", gap: 12 }}>
          <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true"><path fill="#fff" d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM10 13V9h4v4h3l-5 5-5-5h3z"/></svg>
          <div>
            <h1 style={{ margin: 0, fontSize: 19, fontWeight: 650 }}>Your backup</h1>
            <p style={{ margin: "1px 0 0", fontSize: 13, opacity: 0.85 }}>Download your photos, videos, files and more</p>
          </div>
        </div>
      </header>
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "18px 16px 48px" }}>
        <div style={{ background: "#fff", border: "1px solid #E4E2DA", borderRadius: 12, padding: "12px 14px", marginBottom: 16, fontSize: 14, color: "#4a4f45" }}>
          Tap a photo or video to view it, or use the download links. Contacts come as a
          <code style={code}> .vcf</code> file you open to add them back; texts and call history come as
          <code style={code}> .xml</code> files the free &quot;SMS Backup &amp; Restore&quot; app puts back. This link expires on its own.
        </div>
        <BackupBrowser urls={urls} />
      </div>
    </main>
  );
}

const code: React.CSSProperties = { background: "#F2F1EC", padding: "1px 5px", borderRadius: 5, border: "1px solid #E4E2DA", fontSize: 13 };
