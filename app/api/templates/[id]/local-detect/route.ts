import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { readStore, templatePdfPath, withStore } from "@/lib/store";
import { getSession, isAdmin } from "@/lib/session";
import { jsonError, jsonErrorFor } from "@/lib/api";
import { detectLocalFields } from "@/lib/ai/local";

export const runtime = "nodejs";

/**
 * Local field scan: reads the PDF's embedded AcroForm widgets (no cloud AI).
 * Body: { autoAdd?: boolean }. With autoAdd=true the proposals are merged into
 * the template and saved.
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

    const body = await req.json().catch(() => ({}));
    const autoAdd = Boolean(body?.autoAdd);

    const bytes = await readFile(templatePdfPath(template.fileName));
    const proposals = await detectLocalFields(bytes);

    if (autoAdd && proposals.length > 0) {
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
    return jsonErrorFor(err);
  }
}
