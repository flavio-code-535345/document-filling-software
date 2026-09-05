import { NextResponse } from "next/server";
import { readStore, withStore } from "@/lib/store";
import { getSession, isAdmin } from "@/lib/session";
import { jsonError, jsonErrorFor, notFound, parseJsonBody } from "@/lib/api";

export const runtime = "nodejs";

/**
 * User administration: promote/demote and delete with guards:
 * can't touch yourself, can't remove the last admin.
 */
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

    const target = store.users.find((u) => u.id === id);
    if (!target) notFound("Benutzer nicht gefunden.");
    if (target.id === session.user.id) {
      return jsonError("Du kannst dich nicht selbst ändern.", 400);
    }

    const body = await parseJsonBody<{ isAdmin?: boolean }>(req);
    if (typeof body.isAdmin === "boolean") {
      if (body.isAdmin === false) {
        const adminCount = store.users.filter((u) => isAdmin(u, store)).length;
        if (isAdmin(target, store) && adminCount <= 1) {
          return jsonError("Der letzte Administrator kann nicht entfernt werden.", 400);
        }
      }
    }

    await withStore((s) => {
      const u = s.users.find((x) => x.id === id);
      if (u && typeof body.isAdmin === "boolean") u.isAdmin = body.isAdmin;
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
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

    const target = store.users.find((u) => u.id === id);
    if (!target) notFound("Benutzer nicht gefunden.");
    if (target.id === session.user.id) {
      return jsonError("Du kannst dich nicht selbst löschen.", 400);
    }
    if (isAdmin(target, store)) {
      const adminCount = store.users.filter((u) => isAdmin(u, store)).length;
      if (adminCount <= 1) {
        return jsonError("Der letzte Administrator kann nicht gelöscht werden.", 400);
      }
    }

    await withStore((s) => {
      s.users = s.users.filter((u) => u.id !== id);
      if (s.adminUserId === id) delete s.adminUserId;
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonErrorFor(err);
  }
}
