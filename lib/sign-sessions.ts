// In-memory single-use phone-signature sessions (globalThis Map, 10-minute TTL).
import { randomUUID } from "node:crypto";

const TTL_MS = 10 * 60 * 1000;
const MAX_DATAURL_LENGTH = 2_500_000; // ~2.5 MB

interface SignSession {
  id: string;
  createdAt: number;
  expiresAt: number;
  signature: string | null;
}

declare global {
  // eslint-disable-next-line no-var
  var __vwSignSessions: Map<string, SignSession> | undefined;
}

function sessions(): Map<string, SignSession> {
  if (!globalThis.__vwSignSessions) {
    globalThis.__vwSignSessions = new Map();
  }
  return globalThis.__vwSignSessions;
}

function sweep() {
  const now = Date.now();
  for (const [id, s] of sessions()) {
    if (s.expiresAt < now) sessions().delete(id);
  }
}

export function createSignSession(): SignSession {
  sweep();
  const now = Date.now();
  const session: SignSession = {
    id: randomUUID(),
    createdAt: now,
    expiresAt: now + TTL_MS,
    signature: null,
  };
  sessions().set(session.id, session);
  return session;
}

export function getSignSession(id: string): SignSession | null {
  sweep();
  const s = sessions().get(id);
  if (!s) return null;
  if (s.expiresAt < Date.now()) {
    sessions().delete(id);
    return null;
  }
  return s;
}

export function claimSignature(id: string, dataUrl: string): { ok: boolean; error?: string } {
  const s = getSignSession(id);
  if (!s) return { ok: false, error: "Sitzung abgelaufen oder unbekannt." };
  if (s.signature) return { ok: false, error: "Diese Sitzung wurde bereits verwendet." };
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png;base64,")) {
    return { ok: false, error: "Ungültiges Signaturformat." };
  }
  if (dataUrl.length > MAX_DATAURL_LENGTH) {
    return { ok: false, error: "Signatur ist zu groß." };
  }
  s.signature = dataUrl;
  return { ok: true };
}

export function deleteSignSession(id: string) {
  sessions().delete(id);
}
