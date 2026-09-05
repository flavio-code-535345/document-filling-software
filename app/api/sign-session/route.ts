import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { jsonError, jsonErrorFor } from "@/lib/api";
import { createSignSession } from "@/lib/sign-sessions";

export const runtime = "nodejs";

/** Desktop creates a phone-sign session (login required). */
export async function POST() {
  try {
    const session = await getSession();
    if (!session) return jsonError("Bitte anmelden.", 401);
    const signSession = createSignSession();
    return NextResponse.json({ id: signSession.id, expiresAt: new Date(signSession.expiresAt).toISOString() }, { status: 201 });
  } catch (err) {
    return jsonErrorFor(err);
  }
}
