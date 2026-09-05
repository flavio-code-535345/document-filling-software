import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import config from '../config.js';
import { sessionStore } from '../store/sessionStore.js';
import { audit } from '../utils/audit.js';

export const signatureRouter = Router();

const sessionLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Create a QR signature session.
 * Body: { context?: { templateId?, fieldId?, label? } }
 * Response: { sessionId, hostToken, signerToken, signerUrl, expiresAt }
 * `signerUrl` is what the QR code encodes — it points at the web app's
 * mobile signing route and carries ONLY the signer credential.
 */
signatureRouter.post('/', sessionLimiter, (req, res) => {
  const session = sessionStore.create(req.body?.context || {});

  const base = config.publicWebUrl || `${req.protocol}://${req.get('host')}`;
  const signerUrl = `${base}/#/sign?session=${encodeURIComponent(session.id)}&token=${encodeURIComponent(session.signerToken)}`;

  audit('signature.sessionCreated', { sessionId: session.id });
  res.status(201).json({
    sessionId: session.id,
    hostToken: session.hostToken,
    signerToken: session.signerToken,
    signerUrl,
    expiresAt: session.expiresAt,
  });
});

/** Public, token-free status check (no secrets exposed). */
signatureRouter.get('/:id', (req, res) => {
  const view = sessionStore.publicView(sessionStore.get(req.params.id));
  if (!view) return res.status(404).json({ error: 'Session expired or unknown.' });
  res.json(view);
});
