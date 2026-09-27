import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { readStore, templatePdfPath } from "@/lib/store";
import { getSession } from "@/lib/session";
import { jsonError, jsonErrorFor, parseJsonBody } from "@/lib/api";
import { buildFilenameParts, fillPdf } from "@/lib/pdf/fill";
import { expandPdfPages, repeatPerPage, selectPdfPages } from "@/lib/pdf/expand";
import { expandFieldsForRepeat } from "@/lib/editor-utils";
import { buildTimesheetOutput } from "@/lib/timesheet";
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

    const originalBytes = await readFile(templatePdfPath(stored.fileName));
    let template: StoredTemplate = stored;
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
    }

    // Server-side required validation: every required field must have a
    // value — except a disabled one, which the fill form never even shows,
    // so it can never have collected a value for the admin to require.
    // Runs on the weeks as submitted, before any month-end split below.
    const missing = template.fields.find(
      (f) => f.required && !f.disabled && isEmpty(values[f.id])
    );
    if (missing) {
      return jsonError(`Bitte fülle das Feld „${missing.label || "?"}" aus.`, 400);
    }

    // Filename from the weeks as submitted too — a split TN's copied fields
    // would otherwise repeat every "im Dateinamen" value once more.
    const filename = buildOutputFilename(
      template.name,
      buildFilenameParts(template, values)
    );

    // Tätigkeitsnachweis-Modus: a week that straddles a month change prints
    // as one TN per month, and days without work are struck — see
    // lib/timesheet.ts. The fill form's preview runs the exact same function
    // on the exact same fields and values, so it shows these same pages.
    let printTemplate = template;
    let printValues = values;
    let overrides: FillValues | undefined;
    let pageSources = Array.from({ length: template.pageCount }, (_, i) => i);
    let timesheetChanged = false;
    if (stored.autoCurrentWeek) {
      const ts = buildTimesheetOutput(template.fields, template.pageCount, values);
      if (ts.changed) {
        timesheetChanged = true;
        const rotations = template.pageRotations ?? [];
        printTemplate = {
          ...template,
          pageCount: ts.pages.length,
          pageSizes: ts.pages.map((p) => template.pageSizes[p.sourcePage]),
          pageRotations: ts.pages.map((p) => rotations[p.sourcePage] ?? 0),
          fields: ts.fields,
        };
        printValues = ts.values;
        overrides = ts.struck;
        pageSources = ts.pages.map((p) => p.sourcePage);
      }
    }

    // Every printed page is a copy of some page of the original file (an
    // Endlos-Modus block page, or a split TN's second sheet, is just the
    // same scanned page again).
    const pdfPages = pageSources.map((p) => p % stored.pageCount);
    const unchanged = pdfPages.length === stored.pageCount && pdfPages.every((p, i) => p === i);
    const pdfBytes = unchanged
      ? originalBytes
      : timesheetChanged
        ? await selectPdfPages(originalBytes, pdfPages)
        : await expandPdfPages(originalBytes, stored.pageCount, times);

    const out = await fillPdf(printTemplate, printValues, pdfBytes, overrides);

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
