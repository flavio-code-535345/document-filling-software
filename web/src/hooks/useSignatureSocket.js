import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';

/**
 * useSignatureSocket — shared socket lifecycle for the QR signature bridge.
 * Works for both roles: the desktop editor ('host') and the phone ('signer').
 *
 * @param {object} params
 * @param {string} params.sessionId
 * @param {string} params.token      hostToken (desktop) or signerToken (phone)
 * @param {'host'|'signer'} params.role
 * @param {(sig: {dataUrl: string, mime: string}) => void} params.onSignature  host-only: live signature arrival
 */
export function useSignatureSocket({ sessionId, token, role, onSignature }) {
  const [status, setStatus] = useState('connecting'); // connecting | ready | paired | signed | closed | error
  const [error, setError] = useState(null);
  const socketRef = useRef(null);
  const onSignatureRef = useRef(onSignature);
  onSignatureRef.current = onSignature;

  useEffect(() => {
    if (!sessionId || !token) return undefined;
    const socket = io({ transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('session:join', { sessionId, token, role }, (res) => {
        if (!res?.ok) {
          setError(res?.message || 'Could not join session.');
          setStatus('error');
          return;
        }
        setStatus(res.session?.status === 'paired' ? 'paired' : 'ready');
      });
    });

    socket.on('session:peer-joined', () => setStatus('paired'));
    socket.on('session:peer-left', () => setStatus('ready'));
    socket.on('session:closed', () => setStatus('closed'));
    socket.on('session:error', (e) => { setError(e.message); setStatus('error'); });
    socket.on('signature:applied', (sig) => {
      setStatus('signed');
      onSignatureRef.current?.(sig);
    });
    socket.on('disconnect', () => setStatus((s) => (s === 'closed' || s === 'error' ? s : 'connecting')));

    return () => { socket.close(); socketRef.current = null; };
  }, [sessionId, token, role]);

  const requestSignature = useCallback((label) => socketRef.current?.emit('signature:request', { label }), []);
  const ackSignature = useCallback((accepted) => socketRef.current?.emit('signature:ack', { accepted }), []);
  const closeSession = useCallback(() => socketRef.current?.emit('session:close'), []);

  return { status, error, requestSignature, ackSignature, closeSession };
}
