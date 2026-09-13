import { NextResponse } from "next/server";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { newId } from "@/lib/auth";
import { readStore, templatePdfPath, withStore } from "@/lib/store";
import { getSession, isAdmin } from "@/lib/session";
import { jsonError, jsonErrorFor, parseJsonBody } from "@/lib/api";

export const runtime = "nodejs";

/**
 * The undo for "Endlos-Modus" (repeat-pages): cuts a template back down to
 * its first `keepPages` pages, dropping every PDF page and every field
 * beyond that from both the file and the store. The inverse of repeat-pages
 * rather than a generic reorder/delete tool — good enough to recover from
 * "I repeated this too many times", not a replacement for the visual editor
 * for anything more surgical (e.g. removing a page from the middle).
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

    const body = await parseJsonBody<{ keepPages?: number }>(req);
    const keepPages = Math.round(Number(body.keepPages));
    if (!Number.isInteger(keepPages) || keepPages < 1 || keepPages >= template.pageCount) {
      return jsonError(`Anzahl muss zwischen 1 und ${template.pageCount - 1} liegen.`, 400);
    }

    const bytes = await readFile(templatePdfPath(template.fileName));
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    for (let i = doc.getPageCount() - 1; i >= keepPages; i--) doc.removePage(i);
    const newBytes = await doc.save();

    const newFileName = `${newId()}.pdf`;
    await writeFile(templatePdfPath(newFileName), newBytes);
    await unlink(templatePdfPath(template.fileName)).catch(() => {});

    const newPageSizes = template.pageSizes.slice(0, keepPages);
    const newPageRotations = (template.pageRotations ?? []).slice(0, keepPages);
    const newFields = template.fields.filter((f) => f.page < keepPages);
    const removedFields = template.fields.length - newFields.length;

    await withStore((s) => {
      const t = s.templates.find((x) => x.id === id)!;
      t.fileName = newFileName;
      t.pageCount = keepPages;
      t.pageSizes = newPageSizes;
      t.pageRotations = newPageRotations;
      t.fields = newFields;
      t.updatedAt = new Date().toISOString();
    });
    const updated = (await readStore()).templates.find((t) => t.id === id);
    return NextResponse.json({ template: updated, removed: removedFields });
  } catch (err) {
    return jsonErrorFor(err);
  }
}
