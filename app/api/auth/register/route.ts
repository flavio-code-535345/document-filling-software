import { NextResponse } from "next/server";
import { createSessionToken, hashPassword, newId, sessionCookie } from "@/lib/auth";
import { readStore, withStore } from "@/lib/store";
import { jsonError, parseJsonBody } from "@/lib/api";
import type { AccessRequest, User } from "@/lib/types";

export const runtime = "nodejs";

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,40}$/;

export async function POST(req: Request) {
  const body = await parseJsonBody<{ username?: string; password?: string }>(req);
  const { username, password } = body;

  if (!username || !USERNAME_RE.test(username)) {
    return jsonError(
      "Benutzername muss 3–40 Zeichen lang sein (Buchstaben, Zahlen, . _ -).",
      400
    );
  }
  if (!password || password.length < 8) {
    return jsonError("Passwort muss mindestens 8 Zeichen lang sein.", 400);
  }

  const store = await readStore();

  if (store.users.some((u) => u.username === username)) {
    return jsonError("Dieser Benutzername ist bereits vergeben.", 409);
  }
  if (store.requests.some((r) => r.username === username)) {
    return jsonError("Für diesen Benutzernamen liegt bereits eine Anfrage vor.", 409);
  }

  const isFirstUser = store.users.length === 0 && store.requests.length === 0;

  if (isFirstUser) {
    const user: User = {
      id: newId(),
      username,
      passwordHash: hashPassword(password),
      isAdmin: true,
      createdAt: new Date().toISOString(),
    };
    await withStore((s) => {
      s.users.push(user);
      if (!s.adminUserId) s.adminUserId = user.id;
    });
    const res = NextResponse.json({ ok: true, firstUser: true });
    res.cookies.set(sessionCookie.name, createSessionToken(username), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: sessionCookie.maxAge,
      secure: process.env.COOKIE_SECURE === "true",
    });
    return res;
  }

  const request: AccessRequest = {
    id: newId(),
    username,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
  };
  await withStore((s) => {
    s.requests.push(request);
  });
  return NextResponse.json({ ok: true, pending: true });
}
