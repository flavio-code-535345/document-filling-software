import { NextResponse } from "next/server";
import { withStore, readStore } from "@/lib/store";
import { getSession, isAdmin } from "@/lib/session";
import { jsonError, jsonErrorFor, notFound } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) return jsonError("Bitte anmelden.", 401);
    const { id } = await params;
    const store = await readStore();
    const template = store.templates.find((t) => t.id === id);
    if (!template) return jsonError("Vorlage nicht gefunden.", 404);

    // Email availability for the fill form (per user + global settings).
    const userEmail = session.user.email || "";
    const emailEnabled = store.settings.pdf.emailEnabled;
    const emailTo = store.settings.pdf.emailTo || "";
    const emailTarget = userEmail || emailTo;
    const emailAvailable = emailEnabled && emailTarget.length > 0;

    return NextResponse.json({
      template: { ...template, pdfUrl: `/api/templates/${template.id}/pdf?v=${template.updatedAt}` },
      emailAvailable,
      emailTarget,
    });
  } catch (err) {
    return jsonErrorFor(err);
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) return jsonError("Bitte anmelden.", 401);
    const { id } = await params;
    const store = await readStore();
    if (!isAdmin(session.user, store)) return jsonError("Keine Berechtigung.", 403);
    if (!store.templates.some((t) => t.id === id)) return jsonError("Vorlage nicht gefunden.", 404);

    const body = await req.json();
    await withStore((s) => {
      const t = s.templates.find((x) => x.id === id)!;
      if (typeof body.name === "string" && body.name.trim()) t.name = body.name.trim();
      if (Array.isArray(body.fields)) t.fields = body.fields;
      if (typeof body.pageCount === "number") t.pageCount = body.pageCount;
      if (Array.isArray(body.pageSizes)) t.pageSizes = body.pageSizes;
      t.updatedAt = new Date().toISOString();
    });
    const updated = (await readStore()).templates.find((t) => t.id === id);
    return NextResponse.json({ template: updated });
  } catch (err) {
    if ((err as { status?: number }).status === 404) return jsonErrorFor(err);
    return jsonErrorFor(err);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) return jsonError("Bitte anmelden.", 401);
    const { id } = await params;
    const store = await readStore();
    if (!isAdmin(session.user, store)) return jsonError("Keine Berechtigung.", 403);
    const template = store.templates.find((t) => t.id === id);
    if (!template) notFound("Vorlage nicht gefunden.");
    const { unlink } = await import("node:fs/promises");
    await unlink((await import("@/lib/store")).templatePdfPath(template.fileName)).catch(() => {});
    await withStore((s) => {
      s.templates = s.templates.filter((t) => t.id !== id);
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonErrorFor(err);
  }
}
