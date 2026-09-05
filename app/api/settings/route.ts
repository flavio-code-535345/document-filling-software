import { NextResponse } from "next/server";
import { getSession, isAdmin } from "@/lib/session";
import { jsonError, jsonErrorFor } from "@/lib/api";
import { readStore, withStore } from "@/lib/store";
import type { Settings } from "@/lib/types";

export const runtime = "nodejs";

/** Non-admins get only { appName }; admins get the full settings object. */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) return jsonError("Bitte anmelden.", 401);
    const store = await readStore();
    if (!isAdmin(session.user, store)) {
      return NextResponse.json({ appName: store.settings.general.appName });
    }
    return NextResponse.json(store.settings);
  } catch (err) {
    return jsonErrorFor(err);
  }
}

export async function PUT(req: Request) {
  try {
    const session = await getSession();
    if (!session) return jsonError("Bitte anmelden.", 401);
    const store = await readStore();
    if (!isAdmin(session.user, store)) return jsonError("Keine Berechtigung.", 403);

    const body = await req.json().catch(() => ({}));
    await withStore((s) => {
      s.settings = mergeSettings(s.settings, body as Partial<Settings>);
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonErrorFor(err);
  }
}

function mergeSettings(current: Settings, patch: Partial<Settings>): Settings {
  return {
    general: { ...current.general, ...(patch.general ?? {}) },
    smtp: {
      ...current.smtp,
      ...(patch.smtp ?? {}),
      port: Number(patch.smtp?.port ?? current.smtp.port),
      secure: Boolean(patch.smtp?.secure ?? current.smtp.secure),
    },
    pdf: {
      ...current.pdf,
      ...(patch.pdf ?? {}),
      defaultFontSize: Number(patch.pdf?.defaultFontSize ?? current.pdf.defaultFontSize),
      emailEnabled: Boolean(patch.pdf?.emailEnabled ?? current.pdf.emailEnabled),
    },
  };
}
