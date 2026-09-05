import { NextResponse } from "next/server";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { newId } from "@/lib/auth";
import { readStore, templatePdfPath, withStore } from "@/lib/store";
import { getSession, isAdmin } from "@/lib/session";
import { jsonError, jsonErrorFor } from "@/lib/api";

export const runtime = "nodejs";

/** Raw template PDF bytes. Requires a session. Never cached (version via ?v= busts browser cache). */
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
    const bytes = await readFile(templatePdfPath(template.fileName));
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return jsonErrorFor(err);
  }
}

/** Swap the underlying PDF of a template, keeping all fields. */
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

    const form = await req.formData();
    const file = form.get("pdf") as File | null;
    if (!file) return jsonError("Bitte eine PDF-Datei hochladen.", 400);
    if (file.size > 30 * 1024 * 1024) return jsonError("Die PDF ist zu groß (max. 30 MB).", 413);

    const bytes = Buffer.from(await file.arrayBuffer());
    let pageCount = 0;
    let pageSizes: { width: number; height: number }[] = [];
    try {
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
      pageCount = doc.getPageCount();
      pageSizes = doc.getPages().map((p) => {
        const { width, height } = p.getSize();
        return { width, height };
      });
    } catch {
      return jsonError("Die Datei ist keine gültige PDF.", 400);
    }

    const newFileName = `${newId()}.pdf`;
    await writeFile(templatePdfPath(newFileName), bytes);
    await unlink(templatePdfPath(template.fileName)).catch(() => {});
    await withStore((s) => {
      const t = s.templates.find((x) => x.id === id)!;
      t.fileName = newFileName;
      t.pageCount = pageCount;
      t.pageSizes = pageSizes;
      t.updatedAt = new Date().toISOString();
    });
    const updated = (await readStore()).templates.find((t) => t.id === id);
    return NextResponse.json({ template: updated });
  } catch (err) {
    return jsonErrorFor(err);
  }
}
