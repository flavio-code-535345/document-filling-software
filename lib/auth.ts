// Dependency-free auth: scrypt password hashing + HMAC session tokens (node:crypto only).
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHmac,
  randomUUID,
} from "node:crypto";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const COOKIE_NAME = "vw_session";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

export function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "AUTH_SECRET ist nicht gesetzt oder zu kurz (min. 32 Zeichen)."
    );
  }
  return secret;
}

export function createSessionToken(username: string): string {
  const expiry = Date.now() + SESSION_TTL_MS;
  const payload = `${username}.${expiry}`;
  const signature = createHmac("sha256", getAuthSecret()).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

export function verifySessionToken(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [username, expiryStr, signature] = parts;
    const payload = `${username}.${expiryStr}`;
    const expected = createHmac("sha256", getAuthSecret()).update(payload).digest("hex");
    const a = Buffer.from(signature, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    if (Number(expiryStr) < Date.now()) return null;
    return username;
  } catch {
    return null;
  }
}

export const sessionCookie = {
  name: COOKIE_NAME,
  get maxAge() {
    return SESSION_TTL_MS / 1000;
  },
};

export function newId(): string {
  return randomUUID();
}
