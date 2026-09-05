import { sessionStore } from '../store/sessionStore.js';
import { audit } from '../utils/audit.js';

/**
 * SignatureGateway — Socket.io bridge between the desktop editor (host) and a
 * phone (signer) paired through a QR code.
 *
 * Pairing flow
 * ------------
 * 1. Host (desktop editor) calls POST /api/signature-sessions and receives
 *    { sessionId, hostToken, signerToken, signerUrl, expiresAt }.
 *    The QR code encodes `signerUrl` (contains sessionId + signerToken).
 * 2. Host opens a socket and emits  "session:join" { sessionId, token: hostToken, role: 'host' }.
 *    Server puts the socket into room `sig:<sessionId>` and confirms with "session:state".
 * 3. Phone scans the QR -> opens the mobile page -> emits
 *    "session:join" { sessionId, token: signerToken, role: 'signer' }.
 *    Server marks the session "paired" and notifies the host with "session:peer-joined".
 * 4. Host may emit "signature:request" { label } which is forwarded to the signer
 *    ("signature:requested") so the phone shows a prompt ("Sign: Contract page 1").
 * 5. Signer draws and emits "signature:submit" { sessionId, token, dataUrl }.
 *    Server validates session + token + payload, stores it, then emits
 *    "signature:applied" { dataUrl, mime, receivedAt } to the HOST socket only.
 *    The desktop canvas injects the signature instantly.
 * 6. Host acknowledges with "signature:ack" { accepted } -> signer receives
 *    "signature:ack" so the phone shows "Delivered" or offers to re-sign.
 * 7. Either side may emit "session:close"; expiry is enforced by the store TTL.
 *
 * Security notes
 * --------------
 * - hostToken and signerToken are separate 128-bit random credentials; the QR
 *   only ever carries the signer token, so a phone can never act as host.
 * - Tokens are single-session, time-boxed (TTL), and never exposed by the
 *   REST status endpoint.
 * - Signature payloads are size-capped and must be PNG/JPEG data URLs.
 */

const MAX_DATAURL_BYTES = 2.5 * 1024 * 1024; // 2.5 MB
const DATAURL_RE = /^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/=]+$/i;

export function attachSignatureGateway(io) {
  io.on('connection', (socket) => {
    let bound = null; // { sessionId, role }

    socket.on('session:join', ({ sessionId, token, role } = {}, cb) => {
      const session = sessionStore.get(sessionId);
      if (!session) return fail(cb, socket, 'SESSION_NOT_FOUND', 'Session expired or unknown.');
      if (role !== 'host' && role !== 'signer') return fail(cb, socket, 'BAD_ROLE', 'Role must be host or signer.');

      const expected = role === 'host' ? session.hostToken : session.signerToken;
      if (token !== expected) return fail(cb, socket, 'BAD_TOKEN', 'Invalid token for this session.');

      bound = { sessionId, role };
      socket.join(room(sessionId));

      if (role === 'host') {
        sessionStore.update(sessionId, { hostSocketId: socket.id });
      } else {
        sessionStore.update(sessionId, { signerSocketId: socket.id, status: 'paired' });
        io.to(room(sessionId)).emit('session:peer-joined', { role: 'signer' });
        audit('signature.paired', { sessionId });
      }

      cb?.({ ok: true, session: sessionStore.publicView(sessionStore.get(sessionId)) });
      socket.emit('session:state', sessionStore.publicView(sessionStore.get(sessionId)));
    });

    socket.on('signature:request', ({ label } = {}) => {
      if (!bound || bound.role !== 'host') return;
      const session = sessionStore.get(bound.sessionId);
      if (!session?.signerSocketId) return;
      io.to(session.signerSocketId).emit('signature:requested', { label: label || session.context?.label || 'Signature' });
    });

    socket.on('signature:submit', ({ sessionId, token, dataUrl } = {}, cb) => {
      const session = sessionStore.get(sessionId);
      if (!session) return fail(cb, socket, 'SESSION_NOT_FOUND', 'Session expired or unknown.');
      if (token !== session.signerToken) return fail(cb, socket, 'BAD_TOKEN', 'Invalid signer token.');
      if (session.status === 'closed') return fail(cb, socket, 'SESSION_CLOSED', 'Session is closed.');
      if (typeof dataUrl !== 'string' || dataUrl.length > MAX_DATAURL_BYTES || !DATAURL_RE.test(dataUrl)) {
        return fail(cb, socket, 'BAD_PAYLOAD', 'Signature must be a PNG/JPEG data URL under 2.5MB.');
      }

      const mime = dataUrl.slice(5, dataUrl.indexOf(';'));
      const signature = { dataUrl, mime, receivedAt: new Date().toISOString() };
      sessionStore.update(sessionId, { signature, status: 'signed' });
      audit('signature.received', { sessionId, bytes: dataUrl.length });

      // Deliver to the host only — never broadcast signature images to a room.
      if (session.hostSocketId) {
        io.to(session.hostSocketId).emit('signature:applied', signature);
      }
      cb?.({ ok: true, receivedAt: signature.receivedAt });
    });

    socket.on('signature:ack', ({ accepted } = {}) => {
      if (!bound || bound.role !== 'host') return;
      const session = sessionStore.get(bound.sessionId);
      if (session?.signerSocketId) {
        io.to(session.signerSocketId).emit('signature:ack', { accepted: Boolean(accepted) });
      }
    });

    socket.on('session:close', () => {
      if (!bound) return;
      sessionStore.close(bound.sessionId);
      io.to(room(bound.sessionId)).emit('session:closed');
      audit('signature.closed', { sessionId: bound.sessionId });
    });

    socket.on('disconnect', () => {
      if (!bound) return;
      const session = sessionStore.get(bound.sessionId);
      if (!session) return;
      if (session.signerSocketId === socket.id) {
        sessionStore.update(bound.sessionId, { signerSocketId: null });
        io.to(room(bound.sessionId)).emit('session:peer-left', { role: 'signer' });
      }
      if (session.hostSocketId === socket.id) {
        sessionStore.update(bound.sessionId, { hostSocketId: null });
      }
    });
  });
}

function room(sessionId) {
  return `sig:${sessionId}`;
}

function fail(cb, socket, code, message) {
  cb?.({ ok: false, code, message });
  socket.emit('session:error', { code, message });
}
