import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { readStore, templatePdfPath, withStore } from "@/lib/store";
import { getSession, isAdmin } from "@/lib/session";
import { jsonError, jsonErrorFor, parseJsonBody } from "@/lib/api";
import { detectFieldsWithAI, type AIScanRegion } from "@/lib/ai/detect";
import { resolveAIConfig } from "@/lib/ai/config";

export const runtime = "nodejs";

/**
 * AI scan of a template PDF: proposes fillable fields via the configured
 * provider (Gemini / ChatGPT / Claude).
 * Body: { autoAdd?: boolean, region?: { page, x, y, width, height } } —
 * region restricts scanning to a marked rectangle (PDF points, top-left).
 * With autoAdd=true the proposals are merged into the template and saved.
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

    const body = await parseJsonBody<{ autoAdd?: boolean; region?: AIScanRegion }>(req).catch(() => ({
      autoAdd: undefined,
      region: undefined,
    }));

    const region = sanitizeRegion(body.region, template.pageSizes);
    const ai = resolveAIConfig(store.settings);

    const bytes = await readFile(templatePdfPath(template.fileName));
    const proposals = await detectFieldsWithAI(bytes, template.pageSizes, {
      provider: ai.provider,
      apiKey: ai.apiKey,
      model: ai.model,
      region,
      ollamaUrl: ai.ollamaUrl,
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

function sanitizeRegion(
  raw: AIScanRegion | undefined,
  pageSizes: { width: number; height: number }[]
): AIScanRegion | undefined {
  if (!raw) return undefined;
  const page = Math.min(Math.max(0, Math.floor(Number(raw.page) || 0)), Math.max(0, pageSizes.length - 1));
  const pageW = pageSizes[page]?.width ?? 612;
  const pageH = pageSizes[page]?.height ?? 792;
  const x = Math.max(0, Math.min(Number(raw.x) || 0, pageW - 4));
  const y = Math.max(0, Math.min(Number(raw.y) || 0, pageH - 4));
  const width = Math.max(8, Math.min(Number(raw.width) || 8, pageW - x));
  const height = Math.max(8, Math.min(Number(raw.height) || 8, pageH - y));
  return { page, x, y, width, height };
}
