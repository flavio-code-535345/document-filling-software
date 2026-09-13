// Server-only PDF page repetition, shared by the persisted "Endlos-Modus"
// editor route and the temporary per-export "how many weeks" choice on the
// fill page (see lib/editor-utils.ts#expandFieldsForRepeat, which must be
// called with the same `times` to keep field ids/pages aligned with the
// pages this produces).
import { PDFDocument } from "pdf-lib";

/** Appends `times` more copies of the PDF's entire current page set to
 * itself (pdf-lib `copyPages`/`addPage`, same document as source and
 * destination) and returns the resulting bytes. */
export async function expandPdfPages(bytes: Uint8Array | Buffer, originalPageCount: number, times: number): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const sourceIndices = Array.from({ length: originalPageCount }, (_, i) => i);
  for (let b = 0; b < times; b++) {
    const copied = await doc.copyPages(doc, sourceIndices);
    for (const p of copied) doc.addPage(p);
  }
  return doc.save();
}

/** Repeats a page-sizes or page-rotations array to match `expandPdfPages`'s
 * output — every block is identical to the original page set. */
export function repeatPerPage<T>(original: T[], times: number): T[] {
  const originalPageCount = original.length;
  return Array.from({ length: originalPageCount * (times + 1) }, (_, i) => original[i % originalPageCount]);
}
