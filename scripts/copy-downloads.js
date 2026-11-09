// Copies the phone-backup downloads (the backup server's Windows program,
// its installer script, the phone app and its version file) from
// phone-backup/dist/ into public/dl/, so this site serves them at
// https://www.eqal.rentals/dl/…. The backup server updates itself from
// there, and the installer and the app look there, so none of them depend
// on the GitHub repo being public. Copied at build time rather than
// committed twice.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const src = path.join(root, "phone-backup", "dist");
const out = path.join(root, "public", "dl");
const files = ["rentroll-backup.exe", "install-backup-server.ps1", "rentroll.apk", "latest.json"];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of files) {
  const from = path.join(src, f);
  if (!fs.existsSync(from)) {
    console.warn(`copy-downloads: ${f} is missing; skipping it.`);
    continue;
  }
  fs.copyFileSync(from, path.join(out, f));
}
console.log(`copy-downloads: ${files.length} files copied to public/dl/`);
