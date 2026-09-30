// Copies pdf.js's worker and the data it fetches at run time into
// public/pdfjs/, so the in-app file viewer (app/components/FileViewer.tsx)
// loads them from this site: the Content-Security-Policy allows workers from
// here and nowhere else. Copied from node_modules on every install and build
// rather than committed, so the worker is always the exact version of the
// pdf.js the page bundles — a mismatched pair refuses to start.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
let src;
try {
  src = path.dirname(require.resolve("pdfjs-dist/package.json", { paths: [root] }));
} catch {
  console.warn("copy-pdfjs: pdfjs-dist is not installed yet; skipping.");
  process.exit(0);
}
const out = path.join(root, "public", "pdfjs");

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(src, "legacy", "build", "pdf.worker.min.mjs"), path.join(out, "pdf.worker.min.mjs"));
for (const dir of ["standard_fonts", "wasm"]) {
  fs.cpSync(path.join(src, dir), path.join(out, dir), { recursive: true });
}
const { version } = require(path.join(src, "package.json"));
console.log(`copy-pdfjs: pdf.js ${version} worker and data copied to public/pdfjs/`);
