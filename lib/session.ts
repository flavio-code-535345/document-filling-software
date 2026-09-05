// Session helpers for server components and route handlers.
import { cookies } from "next/headers";
import { sessionCookie, verifySessionToken } from "./auth";
import { readStore } from "./store";
import type { PublicUser, Store, User } from "./types";

export interface Session {
  user: User;
}

export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookie.name)?.value;
  if (!token) return null;
  const username = verifySessionToken(token);
  if (!username) return null;
  const store = await readStore();
  const user = store.users.find((u) => u.username === username);
  if (!user) return null;
  return { user };
}

export function isAdmin(user: User, store: Store): boolean {
  return user.isAdmin || store.adminUserId === user.id;
}

/** Throws a Response-like error object handled by route helpers. */
export function unauthorized(): never {
  throw Object.assign(new Error("Bitte anmelden."), { status: 401 });
}

export function forbidden(): never {
  throw Object.assign(new Error("Keine Berechtigung."), { status: 403 });
}

export function toPublicUser(user: User, store: Store): PublicUser {
  return {
    id: user.id,
    username: user.username,
    isAdmin: isAdmin(user, store),
    email: user.email,
    hasDefaultSignature: Boolean(user.defaultSignature),
  };
}
