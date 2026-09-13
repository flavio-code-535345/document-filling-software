import { NextResponse } from "next/server";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { newId } from "@/lib/auth";
import { readStore, templatePdfPath, withStore } from "@/lib/store";
import { getSession, isAdmin } from "@/lib/session";
import { jsonError, jsonErrorFor, parseJsonBody } from "@/lib/api";
import { newFieldId, uniqueCopyLabel } from "@/lib/editor-utils";
import type { PageRotation, TemplateField } from "@/lib/types";

export const runtime = "nodejs";

const MAX_TIMES = 10;
const MAX_TOTAL_PAGES = 60;

/**
 * "Endless mode": repeats the template's entire current page set `times`
 * additional times, e.g. a 2-page Früh-/Spätschicht duplex sheet with
 * times=1 becomes 4 pages (4 weeks), times=3 becomes 8 pages (8 weeks).
 *
 * Duplicated fields keep their day/column labels as-is (KW/date
 * auto-numbering in FillForm.tsx is purely page-rank based, so it keeps
 * working unmodified across any number of pages) but get a "(2)", "(3)", …
 * suffix per block via the same `uniqueCopyLabel` the editor's own field-copy
 * tool uses — otherwise a duplicate's unlinked fields would collide with the
 * original's on FillForm's legacy `kind|label` grouping fallback and be
 * treated as the same field. Fields that already carry a `linkKey` (e.g.
 * Name/Vorname) keep it unchanged instead, so they stay one shared input
 * across every block, same as within a single duplex sheet.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) return jsonError("Bitte anmelden.", 401);
    const { id } = await params;
    const store = await readStore();
    if (!isAdmin(session.user, store)) return jsonError("Keine Berechtigung.", 403);
    const template = store.templates.find((t) => t.id === id);
    if (!template) return jsonError("Vorlage nicht gefunden.", 404);

    const body = await parseJsonBody<{ times?: number }>(req);
    const times = Math.round(Number(body.times));
    if (!Number.isInteger(times) || times < 1 || times > MAX_TIMES) {
      return jsonError(`Anzahl der Wiederholungen muss zwischen 1 und ${MAX_TIMES} liegen.`, 400);
    }

    const originalPageCount = template.pageCount;
    const newPageCount = originalPageCount * (times + 1);
    if (newPageCount > MAX_TOTAL_PAGES) {
      return jsonError(`Ergebnis hätte zu viele Seiten (max. ${MAX_TOTAL_PAGES}).`, 400);
    }

    const bytes = await readFile(templatePdfPath(template.fileName));
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const sourceIndices = Array.from({ length: originalPageCount }, (_, i) => i);
    for (let b = 0; b < times; b++) {
      const copied = await doc.copyPages(doc, sourceIndices);
      for (const p of copied) doc.addPage(p);
    }
    const newBytes = await doc.save();

    const newFileName = `${newId()}.pdf`;
    await writeFile(templatePdfPath(newFileName), newBytes);
    await unlink(templatePdfPath(template.fileName)).catch(() => {});

    const newPageSizes = doc.getPages().map((p) => {
      const { width, height } = p.getSize();
      return { width, height };
    });
    const originalRotations: PageRotation[] =
      template.pageRotations ?? Array.from({ length: originalPageCount }, () => 0 as PageRotation);
    const newPageRotations: PageRotation[] = Array.from(
      { length: newPageCount },
      (_, i) => originalRotations[i % originalPageCount] ?? 0
    );

    const newFields: TemplateField[] = [...template.fields];
    for (let b = 1; b <= times; b++) {
      for (const f of template.fields) {
        const copy: TemplateField = { ...f, id: newFieldId(), page: f.page + b * originalPageCount };
        if (!copy.linkKey) copy.label = uniqueCopyLabel(f.label, newFields);
        newFields.push(copy);
      }
    }

    await withStore((s) => {
      const t = s.templates.find((x) => x.id === id)!;
      t.fileName = newFileName;
      t.pageCount = newPageCount;
      t.pageSizes = newPageSizes;
      t.pageRotations = newPageRotations;
      t.fields = newFields;
      t.updatedAt = new Date().toISOString();
    });
    const updated = (await readStore()).templates.find((t) => t.id === id);
    return NextResponse.json({ template: updated, added: newFields.length - template.fields.length });
  } catch (err) {
    return jsonErrorFor(err);
  }
}
