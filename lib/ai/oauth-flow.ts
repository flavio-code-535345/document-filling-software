import crypto from "node:crypto";

const ANTHROPIC_OAUTH_CLIENT_ID = "50dd0d1c-4b95-484e-bfef-d44c895e4cbe";
const ANTHROPIC_AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const ANTHROPIC_TOKEN_URL = "https://console.anthropic.com/oauth/token";

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function generatePKCEChallenge(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = base64UrlEncode(crypto.randomBytes(32));
  const codeChallenge = base64UrlEncode(crypto.createHash("sha256").update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

export function getAuthorizationUrl(redirectUri: string, state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    client_id: ANTHROPIC_OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
    scope: "profile api-key inference",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${ANTHROPIC_AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeCodeForToken(
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
  const res = await fetch(ANTHROPIC_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: ANTHROPIC_OAUTH_CLIENT_ID,
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    }).toString(),
  });

  if (!res.ok) {
    throw new Error(`OAuth failed: ${res.status}`);
  }

  return res.json();
}

export function getRedirectUri(host: string): string {
  const protocol = host.includes("localhost") || host.includes("127.0.0.1") ? "http" : "https";
  return `${protocol}://${host}/api/auth/claude-callback`;
}
