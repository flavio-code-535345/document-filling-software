import { NextResponse } from "next/server";
import { hashPassword, newId } from "@/lib/auth";
import { readStore, withStore } from "@/lib/store";
import { getSession, isAdmin, toPublicUser } from "@/lib/session";
import { jsonError, jsonErrorFor, parseJsonBody } from "@/lib/api";
import type { User } from "@/lib/types";

export const runtime = "nodejs";

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,40}$/;

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return jsonError("Bitte anmelden.", 401);
    const store = await readStore();
    if (!isAdmin(session.user, store)) return jsonError("Keine Berechtigung.", 403);

    const users = store.users.map((u) => ({
      id: u.id,
      username: u.username,
      isAdmin: isAdmin(u, store),
      email: u.email ?? "",
      createdAt: u.createdAt,
      isSelf: u.id === session.user.id,
    }));
    const requests = store.requests.map((r) => ({
      id: r.id,
      username: r.username,
      createdAt: r.createdAt,
    }));
    return NextResponse.json({ users, requests });
  } catch (err) {
    return jsonErrorFor(err);
  }
}

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) return jsonError("Bitte anmelden.", 401);
    const store = await readStore();
    if (!isAdmin(session.user, store)) return jsonError("Keine Berechtigung.", 403);

    const body = await parseJsonBody<{ username?: string; password?: string; isAdmin?: boolean }>(req);
    const username = (body.username ?? "").trim();
    const password = body.password ?? "";

    if (!USERNAME_RE.test(username)) {
      return jsonError("Benutzername muss 3–40 Zeichen lang sein (Buchstaben, Zahlen, . _ -).", 400);
    }
    if (password.length < 8) return jsonError("Passwort muss mindestens 8 Zeichen lang sein.", 400);
    const current = await readStore();
    if (current.users.some((u) => u.username === username)) {
      return jsonError("Dieser Benutzername ist bereits vergeben.", 409);
    }

    const user: User = {
      id: newId(),
      username,
      passwordHash: hashPassword(password),
      isAdmin: Boolean(body.isAdmin),
      createdAt: new Date().toISOString(),
    };
    await withStore((s) => {
      s.users.push(user);
    });
    return NextResponse.json({ user: toPublicUser(user, await readStore()) }, { status: 201 });
  } catch (err) {
    return jsonErrorFor(err);
  }
}
