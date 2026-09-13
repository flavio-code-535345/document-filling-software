import { NextResponse } from "next/server";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { newId } from "@/lib/auth";
import { readStore, templatePdfPath, withStore } from "@/lib/store";
import { getSession, isAdmin } from "@/lib/session";
import { jsonError, jsonErrorFor, parseJsonBody } from "@/lib/api";
import { expandFieldsForRepeat } from "@/lib/editor-utils";
import { expandPdfPages, repeatPerPage } from "@/lib/pdf/expand";
import type { PageRotation } from "@/lib/types";

export const runtime = "nodejs";

const MAX_TIMES = 10;
const MAX_TOTAL_PAGES = 60;

/**
 * Permanently repeats the template's entire current page set `times`
 * additional times — e.g. a 2-page Früh-/Spätschicht duplex sheet with
 * times=1 becomes 4 pages (4 weeks), times=3 becomes 8 pages (8 weeks).
 * See lib/editor-utils.ts#expandFieldsForRepeat and lib/pdf/expand.ts for
 * the shared expansion logic (also used, without persisting anything, by
 * the temporary per-export "how many weeks" choice on the fill page).
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
    const newBytes = await expandPdfPages(bytes, originalPageCount, times);

    const newFileName = `${newId()}.pdf`;
    await writeFile(templatePdfPath(newFileName), newBytes);
    await unlink(templatePdfPath(template.fileName)).catch(() => {});

    const originalRotations: PageRotation[] =
      template.pageRotations ?? Array.from({ length: originalPageCount }, () => 0 as PageRotation);
    const newPageRotations = repeatPerPage(originalRotations, times);
    const newPageSizes = repeatPerPage(template.pageSizes, times);
    const newFields = expandFieldsForRepeat(template.fields, originalPageCount, times);

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
