import { useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import DrawPad from '../components/DrawPad.jsx';

/**
 * MobileSign — the page a phone lands on after scanning the editor's QR code.
 * URL: /#/sign?session=<id>&token=<signerToken>
 *
 * Flow: join socket room as 'signer' -> wait for (optional) prompt ->
 * draw signature -> 'signature:submit' -> wait for host ack.
 */
export default function MobileSign() {
  const params = useMemo(() => new URLSearchParams(window.location.hash.split('?')[1] || ''), []);
  const sessionId = params.get('session');
  const token = params.get('token');

  const [state, setState] = useState('connecting'); // connecting | ready | requested | sending | sent | delivered | rejected | error | closed
  const [error, setError] = useState(null);
  const [label, setLabel] = useState('Signature');
  const [socket, setSocket] = useState(null);
  const [dataUrl, setDataUrl] = useState(null);

  useMemo(() => {
    if (!sessionId || !token) {
      setError('Invalid signing link — missing session or token.');
      setState('error');
      return;
    }
    const s = io({ transports: ['websocket', 'polling'] });
    setSocket(s);
    s.on('connect', () => {
      s.emit('session:join', { sessionId, token, role: 'signer' }, (res) => {
        if (!res?.ok) { setError(res?.message || 'Could not join session.'); setState('error'); }
        else setState('ready');
      });
    });
    s.on('signature:requested', (p) => { setLabel(p.label || 'Signature'); setState('requested'); });
    s.on('signature:ack', ({ accepted }) => setState(accepted ? 'delivered' : 'rejected'));
    s.on('session:closed', () => setState('closed'));
    s.on('session:error', (e) => { setError(e.message); setState('error'); });
    s.on('disconnect', () => setState((prev) => (['delivered', 'error', 'closed'].includes(prev) ? prev : 'connecting')));
  }, [sessionId, token]);

  const submit = () => {
    if (!socket || !dataUrl) return;
    setState('sending');
    socket.emit('signature:submit', { sessionId, token, dataUrl }, (res) => {
      if (!res?.ok) { setError(res?.message || 'Submit failed.'); setState('error'); }
      else setState('sent');
    });
  };

  return (
    <div className="mobile-sign">
      <header>
        <h1>DocFlow Sign</h1>
        <p className="hint">{label}</p>
      </header>

      {state === 'connecting' && <p className="big-status">Connecting…</p>}
      {state === 'error' && <p className="big-status error">{error || 'Something went wrong.'}</p>}
      {state === 'closed' && <p className="big-status">This signing session was closed.</p>}
      {state === 'delivered' && <p className="big-status ok">Delivered — you can close this page.</p>}
      {state === 'rejected' && <p className="big-status error">The sender asked for a new signature. Please sign again.</p>}

      {['ready', 'requested', 'sending', 'sent', 'rejected'].includes(state) && (
        <>
          {state === 'sent' ? (
            <p className="big-status">Sent — waiting for confirmation…</p>
          ) : (
            <>
              <DrawPad height={260} onChange={setDataUrl} />
              <button className="primary big" disabled={!dataUrl || state === 'sending'} onClick={submit}>
                {state === 'sending' ? 'Sending…' : 'Send signature'}
              </button>
            </>
          )}
        </>
      )}

      <footer className="hint">Your signature is transmitted only to the paired desktop session and expires with it.</footer>
    </div>
  );
}
