import { NextResponse } from "next/server";
import { newId } from "@/lib/auth";
import { readStore, withStore } from "@/lib/store";
import { getSession, isAdmin } from "@/lib/session";
import { jsonError, jsonErrorFor, notFound, parseJsonBody } from "@/lib/api";
import type { User } from "@/lib/types";

export const runtime = "nodejs";

/** Approve or reject an access request. Approve creates the user with the requested password. */
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

    const request = store.requests.find((r) => r.id === id);
    if (!request) notFound("Anfrage nicht gefunden.");

    const body = await parseJsonBody<{ action?: string }>(req);
    const action = body.action;

    if (action === "approve") {
      const current = await readStore();
      if (current.users.some((u) => u.username === request.username)) {
        await withStore((s) => {
          s.requests = s.requests.filter((r) => r.id !== id);
        });
        return jsonError("Der Benutzername ist inzwischen vergeben.", 409);
      }
      const user: User = {
        id: newId(),
        username: request.username,
        passwordHash: request.passwordHash,
        isAdmin: false,
        createdAt: new Date().toISOString(),
      };
      await withStore((s) => {
        s.users.push(user);
        s.requests = s.requests.filter((r) => r.id !== id);
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "reject") {
      await withStore((s) => {
        s.requests = s.requests.filter((r) => r.id !== id);
      });
      return NextResponse.json({ ok: true });
    }

    return jsonError("Ungültige Aktion.", 400);
  } catch (err) {
    return jsonErrorFor(err);
  }
}
