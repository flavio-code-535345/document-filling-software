// Copies the pdfjs-dist v6 worker into public/ so the browser can load it from a stable path.
// Runs automatically via `postinstall` (and therefore during `npm ci` in the Docker deps stage).
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const candidates = [
  "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",
];

const source = candidates.map((c) => join(root, c)).find((p) => existsSync(p));

if (!source) {
  console.warn("[copy-pdf-worker] worker file not found — run npm install first.");
  process.exit(0);
}

mkdirSync(join(root, "public"), { recursive: true });
copyFileSync(source, join(root, "public", "pdf.worker.min.mjs"));
console.log("[copy-pdf-worker] copied pdf.worker.min.mjs to public/");
