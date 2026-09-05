import http from 'node:http';
import { Server as SocketServer } from 'socket.io';
import config from './config.js';
import { createApp } from './app.js';
import { store } from './store/fileStore.js';
import { attachSignatureGateway } from './sockets/signatureGateway.js';

async function main() {
  await store.init();

  const app = createApp();
  const server = http.createServer(app);

  const io = new SocketServer(server, {
    cors: { origin: true },
    maxHttpBufferSize: 4 * 1024 * 1024, // signatures are ~100KB; 4MB is generous headroom
  });
  attachSignatureGateway(io);

  server.listen(config.port, () => {
    console.log(`[docflow] server listening on http://localhost:${config.port}`);
    console.log(`[docflow] websocket signature gateway ready`);
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
