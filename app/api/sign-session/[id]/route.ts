import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { jsonError, jsonErrorFor, parseJsonBody } from "@/lib/api";
import { claimSignature, deleteSignSession, getSignSession } from "@/lib/sign-sessions";

export const runtime = "nodejs";

/** Desktop poll: returns the signature ONCE, then deletes the session. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) return jsonError("Bitte anmelden.", 401);
    const { id } = await params;
    const s = getSignSession(id);
    if (!s) return jsonError("Signatur-Sitzung nicht gefunden.", 404);
    if (!s.signature) return NextResponse.json({ pending: true });
    const signature = s.signature;
    deleteSignSession(id);
    return NextResponse.json({ signature });
  } catch (err) {
    return jsonErrorFor(err);
  }
}

/** Public: the phone submits the drawn signature (single-use, TTL-capped). */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await parseJsonBody<{ dataUrl?: string }>(req).catch(() => ({ dataUrl: undefined }));
    const result = claimSignature(id, body.dataUrl ?? "");
    if (!result.ok) return jsonError(result.error ?? "Ungültige Signatur.", 400);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonErrorFor(err);
  }
}

/** Desktop cancels the flow (modal closed). */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) return jsonError("Bitte anmelden.", 401);
    const { id } = await params;
    deleteSignSession(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonErrorFor(err);
  }
}
