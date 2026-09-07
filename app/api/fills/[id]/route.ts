import { NextResponse } from "next/server";
import { withStore } from "@/lib/store";
import { getSession } from "@/lib/session";
import { jsonError, jsonErrorFor } from "@/lib/api";

export const runtime = "nodejs";

/** Delete one of the current user's saved fills. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) return jsonError("Bitte anmelden.", 401);
    const { id } = await params;

    let deleted = false;
    await withStore((s) => {
      const before = s.savedFills.length;
      s.savedFills = s.savedFills.filter(
        (f) => !(f.id === id && f.userId === session.user.id)
      );
      deleted = s.savedFills.length < before;
    });

    if (!deleted) return jsonError("Entwurf nicht gefunden.", 404);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonErrorFor(err);
  }
}
