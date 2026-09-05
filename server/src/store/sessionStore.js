import { rid } from '../utils/text.js';
import config from '../config.js';

/**
 * Signature session store.
 *
 * In-memory implementation with TTL sweeper. The interface mirrors what a
 * Redis adapter would expose (create/get/update/delete + expiry), so swapping
 * to Redis for multi-instance deployments is a drop-in change:
 *   - create()  -> SET session:<id> <json> PX <ttl>
 *   - get()     -> GET session:<id> (+ JSON.parse)
 *   - update()  -> SET session:<id> <json> PX <remaining ttl>
 *
 * Session shape:
 * {
 *   id, hostToken, signerToken, context: { templateId?, fieldId?, label? },
 *   status: 'pending' | 'paired' | 'signed' | 'closed',
 *   createdAt, expiresAt, hostSocketId, signerSocketId, signature: null | { dataUrl, mime, receivedAt }
 * }
 */
class SessionStore {
  constructor(ttlMs) {
    this.ttlMs = ttlMs;
    this.sessions = new Map();
    this.sweeper = setInterval(() => this.sweep(), 30_000);
    this.sweeper.unref?.();
  }

  create(context = {}) {
    const now = Date.now();
    const session = {
      id: rid('sig'),
      hostToken: rid('host'),
      signerToken: rid('signer'),
      context,
      status: 'pending',
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.ttlMs).toISOString(),
      hostSocketId: null,
      signerSocketId: null,
      signature: null,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id) {
    const s = this.sessions.get(id);
    if (!s) return null;
    if (Date.parse(s.expiresAt) < Date.now()) {
      this.sessions.delete(id);
      return null;
    }
    return s;
  }

  update(id, patch) {
    const s = this.get(id);
    if (!s) return null;
    Object.assign(s, patch);
    return s;
  }

  close(id) {
    const s = this.get(id);
    if (s) s.status = 'closed';
    return s;
  }

  delete(id) {
    this.sessions.delete(id);
  }

  sweep() {
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      if (Date.parse(s.expiresAt) < now) this.sessions.delete(id);
    }
  }

  /** Public view that never leaks tokens. */
  publicView(s) {
    if (!s) return null;
    return {
      id: s.id,
      status: s.status,
      context: s.context,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      hasSignature: Boolean(s.signature),
    };
  }
}

export const sessionStore = new SessionStore(config.signSessionTtlMs);
