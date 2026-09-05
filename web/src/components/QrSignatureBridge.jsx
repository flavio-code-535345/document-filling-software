import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../api/client.js';
import { useSignatureSocket } from '../hooks/useSignatureSocket.js';

/**
 * QrSignatureBridge — desktop side of the live phone-signature flow.
 *
 * 1. Creates a signature session via REST (gets sessionId + tokens + signerUrl).
 * 2. Renders signerUrl as a QR code.
 * 3. Joins the socket room as 'host' and waits.
 * 4. When the phone submits, the signature data-URL arrives via
 *    'signature:applied' and is handed to onApply instantly.
 */
export default function QrSignatureBridge({ fieldLabel, onApply, onClose }) {
  const [session, setSession] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [initError, setInitError] = useState(null);
  const [received, setReceived] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await api.createSignatureSession({ label: fieldLabel });
        if (cancelled) return;
        setSession(s);
        setQrDataUrl(await QRCode.toDataURL(s.signerUrl, { width: 260, margin: 1 }));
      } catch (err) {
        if (!cancelled) setInitError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [fieldLabel]);

  const { status, error, requestSignature, ackSignature, closeSession } = useSignatureSocket({
    sessionId: session?.sessionId,
    token: session?.hostToken,
    role: 'host',
    onSignature: (sig) => {
      setReceived(sig);
      onApply?.(sig.dataUrl);
    },
  });

  const isLocalhost = session && /^(https?:\/\/)?(localhost|127\.0\.0\.1)/.test(session.signerUrl);

  return (
    <div className="qr-bridge">
      {initError && <p className="error">Could not create session: {initError}</p>}

      {session && (
        <>
          <div className="qr-stage">
            {qrDataUrl && <img src={qrDataUrl} alt="Scan to sign" className="qr-image" />}
            <div className={`qr-status status-${status}`}>
              {status === 'connecting' && 'Connecting…'}
              {status === 'ready' && 'Waiting for phone — scan the QR code'}
              {status === 'paired' && 'Phone connected — sign on your device'}
              {status === 'signed' && 'Signature received'}
              {status === 'closed' && 'Session closed'}
              {status === 'error' && (error || 'Connection error')}
            </div>
          </div>

          {isLocalhost && (
            <p className="hint">
              Your phone cannot reach <code>localhost</code>. Open this app via your computer's
              LAN IP (e.g. <code>http://192.168.x.x:5173</code>) so the QR link works.
            </p>
          )}

          <div className="row gap">
            <button onClick={() => requestSignature(fieldLabel)} disabled={status !== 'paired'}>
              Prompt phone to sign
            </button>
            <button className="ghost" onClick={() => { ackSignature(false); closeSession(); onClose?.(); }}>
              Discard
            </button>
            {received && (
              <button className="primary" onClick={() => { ackSignature(true); closeSession(); onClose?.(); }}>
                Keep signature
              </button>
            )}
          </div>

          {received && (
            <div className="qr-received">
              <img src={received.dataUrl} alt="Received signature" />
            </div>
          )}

          <details className="qr-debug">
            <summary>Manual link</summary>
            <code>{session.signerUrl}</code>
          </details>
        </>
      )}
    </div>
  );
}
