import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { readStore, templatePdfPath } from "@/lib/store";
import { getSession } from "@/lib/session";
import { jsonError, jsonErrorFor, parseJsonBody } from "@/lib/api";
import { buildFilenameParts, fillPdf } from "@/lib/pdf/fill";
import { buildOutputFilename, contentDispositionFilename } from "@/lib/pdf/sanitize";
import { sendFilledPdfEmail } from "@/lib/email";
import type { FillValues } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) return jsonError("Bitte anmelden.", 401);

    const body = await parseJsonBody<{
      templateId?: string;
      values?: FillValues;
      sendEmail?: boolean;
    }>(req);

    const templateId = body.templateId;
    const values = body.values ?? {};
    if (!templateId) return jsonError("Vorlage fehlt.", 400);

    const store = await readStore();
    const template = store.templates.find((t) => t.id === templateId);
    if (!template) return jsonError("Vorlage nicht gefunden.", 404);

    // Server-side required validation: every required field must have a value.
    const missing = template.fields.find(
      (f) => f.required && isEmpty(values[f.id])
    );
    if (missing) {
      return jsonError(`Bitte fülle das Feld „${missing.label || "?"}" aus.`, 400);
    }

    const pdfBytes = await readFile(templatePdfPath(template.fileName));
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
