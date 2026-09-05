import { NextResponse } from "next/server";
import { getSession, isAdmin, toPublicUser } from "@/lib/session";
import { jsonError, jsonErrorFor } from "@/lib/api";
import { readStore } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return jsonError("Nicht angemeldet.", 401);
    const store = await readStore();
    const pendingCount = isAdmin(session.user, store)
      ? store.requests.length
      : undefined;
    return NextResponse.json({
      user: toPublicUser(session.user, store),
      pendingRequests: pendingCount,
    });
  } catch (err) {
    return jsonErrorFor(err);
  }
}
