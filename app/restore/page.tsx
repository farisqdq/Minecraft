import { restoreTokenValid, phoneBackupConfigured } from "@/lib/phone-backup";
import RestoreClient from "./RestoreClient";

/**
 * The page a staff member reaches from a restore link the admin sent them.
 * No sign-in: the signed token in the link is what grants access, and only
 * to this one phone's backup until it expires. Everything is checked again on
 * the server for each folder and file, so a tampered link gets nothing.
 */
export default async function RestorePage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string; e?: string; s?: string }>;
}) {
  const { d = "", e = "", s = "" } = await searchParams;
  const ok = phoneBackupConfigured() && restoreTokenValid(d, e, s);

  if (!ok) {
    return (
      <main style={wrap}>
        <div style={card}>
          <h1 style={{ margin: "0 0 8px", fontSize: 20 }}>Restore link</h1>
          <p style={{ color: "#B23A3A", margin: 0 }}>
            This restore link isn&apos;t valid, or it has expired. Ask for a fresh link.
          </p>
        </div>
      </main>
    );
  }
  return <RestoreClient d={d} e={e} s={s} />;
}

const wrap: React.CSSProperties = {
  minHeight: "100vh", background: "#F6F5F1", display: "flex", justifyContent: "center",
  padding: "40px 16px", font: "16px system-ui, sans-serif", color: "#23281F",
};
const card: React.CSSProperties = {
  background: "#fff", border: "1px solid #E4E2DA", borderRadius: 14, padding: 20, maxWidth: 520, width: "100%", height: "fit-content",
};
