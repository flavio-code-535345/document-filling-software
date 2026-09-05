import { NextResponse } from "next/server";
import { createSessionToken, sessionCookie, verifyPassword } from "@/lib/auth";
import { readStore } from "@/lib/store";
import { jsonError, parseJsonBody } from "@/lib/api";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { username, password } = await parseJsonBody<{
    username?: string;
    password?: string;
  }>(req).catch(() => ({ username: undefined, password: undefined }));

  if (!username || !password) {
    return jsonError("Benutzername und Passwort sind erforderlich.", 400);
  }

  const store = await readStore();
  const user = store.users.find((u) => u.username === username);

  if (!user || !verifyPassword(password, user.passwordHash)) {
    return jsonError("Benutzername oder Passwort ist falsch.", 401);
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookie.name, createSessionToken(username), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: sessionCookie.maxAge,
    secure: process.env.COOKIE_SECURE === "true",
  });
  return res;
}
