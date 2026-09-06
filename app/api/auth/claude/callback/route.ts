import { NextResponse } from "next/server";
import { readStore, withStore } from "@/lib/store";
import { getSession, isAdmin } from "@/lib/session";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const session = await getSession();
    if (!session) return jsonError("Bitte anmelden.", 401);

    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (!code) {
      return jsonError("Authentifizierung abgebrochen.", 400);
    }

    const store = await readStore();
    if (!isAdmin(session.user, store)) {
      return jsonError("Keine Berechtigung.", 403);
    }

    const codeVerifier = req.cookies.get("claude_pkce_verifier")?.value;
    const storedState = req.cookies.get("claude_oauth_state")?.value;

    if (!codeVerifier || state !== storedState) {
      return jsonError("PKCE-Validierung fehlgeschlagen.", 400);
    }

    // Exchange code for token
    const tokenRes = await fetch("https://console.anthropic.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: "50dd0d1c-4b95-484e-bfef-d44c895e4cbe",
        code,
        code_verifier: codeVerifier,
        redirect_uri: `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/api/auth/claude/callback`,
      }).toString(),
    });

    if (!tokenRes.ok) {
      const errorText = await tokenRes.text();
      return jsonError(`Token-Austausch fehlgeschlagen: ${errorText.slice(0, 100)}`, 500);
    }

    const tokenData = (await tokenRes.json()) as { access_token?: string };
    if (!tokenData.access_token) {
      return jsonError("Kein Zugriffs-Token erhalten.", 500);
    }

    // Save token to settings
    await withStore((s) => {
      s.settings.ai.providers.anthropic.cliToken = tokenData.access_token;
    });

    // Redirect back to settings with success message
    const response = NextResponse.redirect(
      `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/admin/settings?ai=success`
    );

    response.cookies.delete("claude_pkce_verifier");
    response.cookies.delete("claude_oauth_state");

    return response;
  } catch (err) {
    return jsonError(
      `OAuth-Callback-Fehler: ${err instanceof Error ? err.message : "Unbekannter Fehler"}`,
      500
    );
  }
}
