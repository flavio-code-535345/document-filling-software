import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { readStore, templatePdfPath } from "@/lib/store";
import { getSession } from "@/lib/session";
import { jsonError, jsonErrorFor, parseJsonBody } from "@/lib/api";
import { buildFilenameParts, fillPdf } from "@/lib/pdf/fill";
import { expandPdfPages, repeatPerPage } from "@/lib/pdf/expand";
import { expandFieldsForRepeat } from "@/lib/editor-utils";
import { buildOutputFilename, contentDispositionFilename } from "@/lib/pdf/sanitize";
import { sendFilledPdfEmail } from "@/lib/email";
import type { FillValues, PageRotation, StoredTemplate } from "@/lib/types";

export const runtime = "nodejs";

const MAX_WEEK_BLOCKS = 10;

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) return jsonError("Bitte anmelden.", 401);

    const body = await parseJsonBody<{
      templateId?: string;
      values?: FillValues;
      sendEmail?: boolean;
      /** "Endlos-Modus", but just for this download — not persisted (see
       * FillForm.tsx). 1 = the template as stored; each extra block repeats
       * its entire page set once more, same as the admin repeat-pages route. */
      weekBlocks?: number;
    }>(req);

    const templateId = body.templateId;
    const values = body.values ?? {};
    if (!templateId) return jsonError("Vorlage fehlt.", 400);

    const store = await readStore();
    const stored = store.templates.find((t) => t.id === templateId);
    if (!stored) return jsonError("Vorlage nicht gefunden.", 404);

    const weekBlocks = Math.round(Number(body.weekBlocks) || 1);
    if (!Number.isInteger(weekBlocks) || weekBlocks < 1 || weekBlocks > MAX_WEEK_BLOCKS) {
      return jsonError(`weekBlocks muss zwischen 1 und ${MAX_WEEK_BLOCKS} liegen.`, 400);
    }
    const times = weekBlocks - 1;

    let template: StoredTemplate = stored;
    let pdfBytes: Uint8Array | Buffer = await readFile(templatePdfPath(stored.fileName));
    if (times > 0) {
      const originalRotations: PageRotation[] =
        stored.pageRotations ?? Array.from({ length: stored.pageCount }, () => 0 as PageRotation);
      template = {
        ...stored,
        pageCount: stored.pageCount * weekBlocks,
        pageSizes: repeatPerPage(stored.pageSizes, times),
        pageRotations: repeatPerPage(originalRotations, times),
        fields: expandFieldsForRepeat(stored.fields, stored.pageCount, times),
      };
      pdfBytes = await expandPdfPages(pdfBytes, stored.pageCount, times);
    }

    // Server-side required validation: every required field must have a
    // value — except a disabled one, which the fill form never even shows,
    // so it can never have collected a value for the admin to require.
    const missing = template.fields.find(
      (f) => f.required && !f.disabled && isEmpty(values[f.id])
    );
    if (missing) {
      return jsonError(`Bitte fülle das Feld „${missing.label || "?"}" aus.`, 400);
    }

    const out = await fillPdf(template, values, pdfBytes);

    const filename = buildOutputFilename(
      template.name,
      buildFilenameParts(template, values)
    );

    const res = new NextResponse(new Uint8Array(out), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDispositionFilename(filename),
        "Cache-Control": "no-store",
      },
    });

    // Email is best-effort: never blocks or fails the download.
    if (body.sendEmail) {
      const target = session.user.email || store.settings.pdf.emailTo;
      if (store.settings.pdf.emailEnabled && target) {
        void sendFilledPdfEmail(store.settings, target, filename, out, template.name);
      }
    }

    return res;
  } catch (err) {
    return jsonErrorFor(err);
  }
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (typeof value === "boolean") return false;
  if (typeof value === "object") return Object.values(value).every((v) => v !== true);
  return false;
}
