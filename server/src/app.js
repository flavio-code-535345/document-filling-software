import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import config from './config.js';
import { templatesRouter } from './routes/templates.js';
import { generateRouter } from './routes/generate.js';
import { signatureRouter } from './routes/signatureSessions.js';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '15mb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'docflow-server', time: new Date().toISOString() }));

  app.use('/api/templates', templatesRouter);
  app.use('/api', generateRouter); // defines /generate, /generate/preview, /jobs/:id
  app.use('/api/signature-sessions', signatureRouter);

  // In production (web/dist built), serve the SPA from the same port so the
  // phone only ever talks to one origin.
  if (fs.existsSync(config.webDist)) {
    app.use(express.static(config.webDist));
    app.get('*', (_req, res) => res.sendFile('index.html', { root: config.webDist }));
  }

  // Central error handler
  app.use((err, _req, res, _next) => {
    console.error('[http]', err);
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `File too large (max ${config.maxUploadMb}MB).` });
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  });

  return app;
}
