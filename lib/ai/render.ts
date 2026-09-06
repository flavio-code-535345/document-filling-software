// Server-side PDF → PNG rendering via `pdftoppm` (poppler-utils).
//
// Ollama vision models cannot read PDF bytes directly — they need raster
// images. This helper shells out to `pdftoppm`, which is battle-tested in the
// slim alpine runtime image (added via `apk add poppler-utils`). Each page is
// returned as a base64 PNG string, sorted by page order.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

const DEFAULT_DPI = 150;

function pageNumber(name: string): number {
  const m = name.match(/(\d+)\.png$/);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * Render every page of the PDF to a base64 PNG. Returns one entry per page, in
 * document order. Throws if `pdftoppm` is missing (not installed in the image).
 */
export async function renderPdfPagesToPng(
  pdfBytes: Uint8Array,
  dpi: number = DEFAULT_DPI
): Promise<string[]> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "docflow-pdf-"));
  try {
    const input = path.join(dir, "in.pdf");
    await fsp.writeFile(input, pdfBytes);

    const prefix = path.join(dir, "page");
    await execFileAsync("pdftoppm", ["-png", "-r", String(dpi), input, prefix]);

    const files = (await fsp.readdir(dir))
      .filter((f) => f.startsWith("page") && f.endsWith(".png"))
      .sort((a, b) => pageNumber(a) - pageNumber(b));

    const result: string[] = [];
    for (const f of files) {
      const buf = await fsp.readFile(path.join(dir, f));
      result.push(buf.toString("base64"));
    }
    return result;
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
