import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  try {
    const state = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
    const codeVerifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
    
    const encoder = new TextEncoder();
    const data = encoder.encode(codeVerifier);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const codeChallenge = btoa(String.fromCharCode(...hashArray)).replace(/[+/=]/g, (c) =>
      c === "+" ? "-" : c === "/" ? "_" : ""
    );

    const response = NextResponse.redirect(
      `https://claude.ai/oauth/authorize?client_id=50dd0d1c-4b95-484e-bfef-d44c895e4cbe&redirect_uri=${encodeURIComponent(
        `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/api/auth/claude/callback`
      )}&response_type=code&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256&scope=user%3Ainference`
    );

    response.cookies.set("claude_pkce_verifier", codeVerifier, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600,
    });

    response.cookies.set("claude_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600,
    });

    return response;
  } catch (err) {
    return NextResponse.json(
      { error: "OAuth authorization failed" },
      { status: 500 }
    );
  }
}
