import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..'); // server/ (dev) or /app/server (container)
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(rootDir, 'data');

const config = {
  port: Number(process.env.PORT || 4000),
  rootDir,
  dataDir,
  uploadDir: path.join(dataDir, 'uploads'),
  templateDir: path.join(dataDir, 'templates'),
  jobDir: path.join(dataDir, 'jobs'),
  auditFile: path.join(dataDir, 'audit.log'),
  publicWebUrl: process.env.PUBLIC_WEB_URL || '',
  signSessionTtlMs: Number(process.env.SIGN_SESSION_TTL_MINUTES || 10) * 60 * 1000,
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 25),
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || '',
  },
  dispatchWebhookUrl: process.env.DISPATCH_WEBHOOK_URL || '',
  // Frontend static build. Resolves to: repo/web/dist (dev) or /app/web/dist (container)
  // because the runtime image mirrors the repo layout (server/ and web/ as siblings).
  webDist: process.env.WEB_DIST ? path.resolve(process.env.WEB_DIST) : path.resolve(rootDir, '..', 'web', 'dist'),
};

export default config;
