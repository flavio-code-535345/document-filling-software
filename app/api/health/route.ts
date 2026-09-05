import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Liveness probe for Docker HEALTHCHECK / monitoring. */
export async function GET() {
  return NextResponse.json({ ok: true, service: "docflow", time: new Date().toISOString() });
}
