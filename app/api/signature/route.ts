import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { jsonError, jsonErrorFor, parseJsonBody } from "@/lib/api";
import { withStore } from "@/lib/store";

export const runtime = "nodejs";

/** Current user's stored default signature. */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) return jsonError("Bitte anmelden.", 401);
    return NextResponse.json({ signature: session.user.defaultSignature ?? null });
  } catch (err) {
    return jsonErrorFor(err);
  }
}

/** Save the user's default signature (PNG data URL). */
export async function PUT(req: Request) {
  try {
    const session = await getSession();
    if (!session) return jsonError("Bitte anmelden.", 401);
    const body = await parseJsonBody<{ signature?: string }>(req);
    if (!body.signature || !body.signature.startsWith("data:image/png;base64,")) {
      return jsonError("Ungültige Signatur.", 400);
    }
    if (body.signature.length > 2_500_000) {
      return jsonError("Signatur ist zu groß.", 413);
    }
    await withStore((s) => {
      const u = s.users.find((x) => x.id === session.user.id);
      if (u) u.defaultSignature = body.signature;
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonErrorFor(err);
  }
}

/** Delete the stored default signature. */
export async function DELETE() {
  try {
    const session = await getSession();
    if (!session) return jsonError("Bitte anmelden.", 401);
    await withStore((s) => {
      const u = s.users.find((x) => x.id === session.user.id);
      if (u) u.defaultSignature = undefined;
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonErrorFor(err);
  }
}
