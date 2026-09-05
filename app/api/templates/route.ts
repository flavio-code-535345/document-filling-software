import { NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { newId } from "@/lib/auth";
import { ensureDirs, templatePdfPath, withStore } from "@/lib/store";
import { getSession, isAdmin } from "@/lib/session";
import { jsonError, jsonErrorFor } from "@/lib/api";
import type { StoredTemplate } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return jsonError("Bitte anmelden.", 401);
    const templates = await withStore((s) =>
      s.templates.map((t) => ({
        id: t.id,
        name: t.name,
        pageCount: t.pageCount,
        fieldCount: t.fields.length,
        updatedAt: t.updatedAt,
      }))
    );
    return NextResponse.json({ templates });
  } catch (err) {
    return jsonErrorFor(err);
  }
}

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) return jsonError("Bitte anmelden.", 401);
    const store = await import("@/lib/store").then((m) => m.readStore());
    if (!isAdmin(session.user, store)) return jsonError("Keine Berechtigung.", 403);

    const form = await req.formData();
    const name = String(form.get("name") || "").trim();
    const file = form.get("pdf") as File | null;
    if (!name) return jsonError("Bitte einen Namen für die Vorlage angeben.", 400);
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

    const id = newId();
    const fileName = `${id}.pdf`;
    await ensureDirs();
    const { writeFile } = await import("node:fs/promises");
    await writeFile(templatePdfPath(fileName), bytes);

    const now = new Date().toISOString();
    const template: StoredTemplate = {
      id,
      name,
      fileName,
      pageCount,
      pageSizes,
      fields: [],
      createdAt: now,
      updatedAt: now,
    };
    await withStore((s) => {
      s.templates.push(template);
    });
    return NextResponse.json({ template }, { status: 201 });
  } catch (err) {
    return jsonErrorFor(err);
  }
}
