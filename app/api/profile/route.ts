import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { jsonError, jsonErrorFor, parseJsonBody } from "@/lib/api";
import { withStore } from "@/lib/store";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Current user's profile (own email address). */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) return jsonError("Bitte anmelden.", 401);
    return NextResponse.json({ email: session.user.email ?? "" });
  } catch (err) {
    return jsonErrorFor(err);
  }
}

export async function PUT(req: Request) {
  try {
    const session = await getSession();
    if (!session) return jsonError("Bitte anmelden.", 401);
    const body = await parseJsonBody<{ email?: string }>(req);
    const email = (body.email ?? "").trim();
    if (email && !EMAIL_RE.test(email)) {
      return jsonError("Bitte eine gültige E-Mail-Adresse angeben.", 400);
    }
    await withStore((s) => {
      const u = s.users.find((x) => x.id === session.user.id);
      if (u) u.email = email.length > 0 ? email : undefined;
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonErrorFor(err);
  }
}
