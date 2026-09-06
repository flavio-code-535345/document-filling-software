import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { readStore, templatePdfPath, withStore } from "@/lib/store";
import { getSession, isAdmin } from "@/lib/session";
import { jsonError, jsonErrorFor, parseJsonBody } from "@/lib/api";
import { detectFieldsWithGemini } from "@/lib/ai/detect";

export const runtime = "nodejs";

/**
 * AI scan of a template PDF: proposes fillable fields via Gemini.
 * Body: { autoAdd?: boolean } — with autoAdd=true the proposals are merged
 * into the template and saved immediately.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) return jsonError("Bitte anmelden.", 401);
    const { id } = await params;
    const store = await readStore();
    if (!isAdmin(session.user, store)) return jsonError("Keine Berechtigung.", 403);
    const template = store.templates.find((t) => t.id === id);
    if (!template) return jsonError("Vorlage nicht gefunden.", 404);

    const body = await parseJsonBody<{ autoAdd?: boolean }>(req).catch(() => ({ autoAdd: undefined }));

    const ai = store.settings.ai ?? { enabled: false, apiKey: "", model: "gemini-2.0-flash" };
    const apiKey = ai.apiKey || process.env.GEMINI_API_KEY || "";
    const model = ai.model || process.env.GEMINI_MODEL || "gemini-2.0-flash";

    const bytes = await readFile(templatePdfPath(template.fileName));
    const proposals = await detectFieldsWithGemini(bytes, template.pageSizes, {
      apiKey,
      model,
    });

    if (body.autoAdd && proposals.length > 0) {
      await withStore((s) => {
        const t = s.templates.find((x) => x.id === id)!;
        t.fields = [...t.fields, ...proposals];
        t.updatedAt = new Date().toISOString();
      });
      const updated = (await readStore()).templates.find((t) => t.id === id);
      return NextResponse.json({ added: proposals.length, fields: proposals, template: updated });
    }

    return NextResponse.json({ added: 0, fields: proposals });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === "AI_NOT_CONFIGURED") {
      return jsonError("KI nicht konfiguriert. API-Schlüssel in den Einstellungen hinterlegen.", 400);
    }
    if (e.code === "AI_REQUEST_FAILED") {
      return jsonError(e.message || "KI-Scan fehlgeschlagen.", 502);
    }
    return jsonErrorFor(err);
  }
}
