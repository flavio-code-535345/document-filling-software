// Shared helpers for API route handlers.
import { NextResponse } from "next/server";

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export function jsonErrorFor(err: unknown): NextResponse {
  const e = err as { status?: number; message?: string };
  const status = e?.status || 500;
  const message =
    status >= 500
      ? "Interner Serverfehler. Bitte später erneut versuchen."
      : e?.message || "Unbekannter Fehler.";
  return jsonError(message, status);
}

export function parseJsonBody<T>(req: Request): Promise<T> {
  return req.json().catch(() => {
    throw Object.assign(new Error("Ungültige Anfrage."), { status: 400 });
  });
}

export function badRequest(message: string): never {
  throw Object.assign(new Error(message), { status: 400 });
}

export function notFound(message = "Nicht gefunden."): never {
  throw Object.assign(new Error(message), { status: 404 });
}
