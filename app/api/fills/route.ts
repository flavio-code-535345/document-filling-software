import { NextResponse } from "next/server";
import { newId } from "@/lib/auth";
import { readStore, withStore } from "@/lib/store";
import { getSession } from "@/lib/session";
import { jsonError, jsonErrorFor, parseJsonBody } from "@/lib/api";
import type { FillValues, SavedFill } from "@/lib/types";

export const runtime = "nodejs";

/** List the current user's saved fills (optionally scoped to a template). */
export async function GET(req: Request) {
  try {
    const session = await getSession();
    if (!session) return jsonError("Bitte anmelden.", 401);
    const url = new URL(req.url);
    const templateId = url.searchParams.get("templateId") ?? undefined;

    const store = await readStore();
    const fills = store.savedFills
      .filter((f) => f.userId === session.user.id && (!templateId || f.templateId === templateId))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return NextResponse.json({ fills });
  } catch (err) {
    return jsonErrorFor(err);
  }
}

/** Create or update a named saved fill for the current user. */
export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) return jsonError("Bitte anmelden.", 401);

    const body = await parseJsonBody<{
      id?: string;
      templateId?: string;
      name?: string;
      values?: FillValues;
    }>(req);

    const templateId = body.templateId?.trim();
    const name = (body.name ?? "").trim();
    if (!templateId) return jsonError("Vorlage fehlt.", 400);
    if (!name) return jsonError("Bitte einen Namen angeben.", 400);

    const values = body.values ?? {};

    let saved: SavedFill | undefined;
    await withStore((s) => {
      const existing = body.id
        ? s.savedFills.find((f) => f.id === body.id && f.userId === session.user.id)
        : undefined;
      if (body.id && !existing) throw Object.assign(new Error("Entwurf nicht gefunden."), { status: 404 });

      if (existing) {
        existing.name = name;
        existing.values = values;
        existing.updatedAt = new Date().toISOString();
        saved = existing;
      } else {
        const now = new Date().toISOString();
        const fill: SavedFill = {
          id: newId(),
          templateId,
          userId: session.user.id,
          name,
          values,
          createdAt: now,
          updatedAt: now,
        };
        s.savedFills.push(fill);
        saved = fill;
      }
    });

    return NextResponse.json({ fill: saved }, { status: 200 });
  } catch (err) {
    if ((err as { status?: number }).status === 404) return jsonErrorFor(err);
    return jsonErrorFor(err);
  }
}
