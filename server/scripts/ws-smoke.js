/**
 * WebSocket smoke test — simulates the full QR signature flow against a real
 * server instance started on an ephemeral port:
 *   REST session create -> host joins -> signer joins -> signature:submit ->
 *   host receives signature:applied -> host acks -> signer receives ack.
 *   node scripts/ws-smoke.js
 */
import http from 'node:http';
import assert from 'node:assert';
import { Server as SocketServer } from 'socket.io';
import { io as ioc } from 'socket.io-client';
import { createApp } from '../src/app.js';
import { store } from '../src/store/fileStore.js';
import { attachSignatureGateway } from '../src/sockets/signatureGateway.js';

const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function main() {
  await store.init();
  const app = createApp();
  const server = http.createServer(app);
  // Same maxHttpBufferSize as production so oversized payloads reach the handler
  const io = new SocketServer(server, { cors: { origin: true }, maxHttpBufferSize: 4 * 1024 * 1024 });
  attachSignatureGateway(io);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  console.log(`test server on ${base}`);

  // 1. create session via REST
  const res = await fetch(`${base}/api/signature-sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: { label: 'Contract signature' } }),
  });
  assert.equal(res.status, 201);
  const { sessionId, hostToken, signerToken, signerUrl } = await res.json();
  assert.ok(signerUrl.includes(`session=${sessionId}`));
  console.log('  PASS  session created, signerUrl encodes signer credentials');

  // 2. bad token is rejected
  const intruder = ioc(base, { transports: ['websocket'] });
  const rejected = await new Promise((r) => intruder.emit('session:join', { sessionId, token: 'wrong', role: 'signer' }, r));
  assert.equal(rejected.ok, false);
  console.log('  PASS  invalid token rejected');

  // 3. host + signer join
  const host = ioc(base, { transports: ['websocket'] });
  const signer = ioc(base, { transports: ['websocket'] });
  const hostJoin = await new Promise((r) => host.emit('session:join', { sessionId, token: hostToken, role: 'host' }, r));
  assert.equal(hostJoin.ok, true);
  const peerJoined = new Promise((r) => host.on('session:peer-joined', r));
  const signerJoin = await new Promise((r) => signer.emit('session:join', { sessionId, token: signerToken, role: 'signer' }, r));
  assert.equal(signerJoin.ok, true);
  await peerJoined;
  console.log('  PASS  host + signer paired, host notified');

  // 4. host requests, phone gets prompt
  const requested = new Promise((r) => signer.on('signature:requested', r));
  host.emit('signature:request', { label: 'Page 1 signature' });
  assert.equal((await requested).label, 'Page 1 signature');
  console.log('  PASS  signature request forwarded to phone');

  // 5. signer submits, host receives applied, ack round-trips
  const applied = new Promise((r) => host.on('signature:applied', r));
  const acked = new Promise((r) => signer.on('signature:ack', r));
  const submit = await new Promise((r) => signer.emit('signature:submit', { sessionId, token: signerToken, dataUrl: PNG_1PX }, r));
  assert.equal(submit.ok, true);
  const sig = await applied;
  assert.equal(sig.dataUrl, PNG_1PX);
  host.emit('signature:ack', { accepted: true });
  assert.equal((await acked).accepted, true);
  console.log('  PASS  signature relayed host<-signer and ack returned');

  // 6. oversized payload rejected (with timeout guard so a dropped frame can't hang the test)
  const big = 'data:image/png;base64,' + 'A'.repeat(3 * 1024 * 1024);
  const tooBig = await Promise.race([
    new Promise((r) => signer.emit('signature:submit', { sessionId, token: signerToken, dataUrl: big }, r)),
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout waiting for rejection')), 5000)),
  ]);
  assert.equal(tooBig.ok, false);
  console.log('  PASS  oversized payload rejected');

  host.close(); signer.close(); intruder.close(); io.close(); server.close();
  console.log('\nWebSocket smoke test passed.\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('\nWS SMOKE TEST FAILED:', err);
  process.exit(1);
});
