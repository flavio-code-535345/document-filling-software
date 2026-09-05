import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config = {
  port: Number(process.env.PORT || 4000),
  rootDir: path.resolve(__dirname, '..'),
  dataDir: path.resolve(__dirname, '..', 'data'),
  uploadDir: path.resolve(__dirname, '..', 'data', 'uploads'),
  templateDir: path.resolve(__dirname, '..', 'data', 'templates'),
  jobDir: path.resolve(__dirname, '..', 'data', 'jobs'),
  auditFile: path.resolve(__dirname, '..', 'data', 'audit.log'),
  publicWebUrl: process.env.PUBLIC_WEB_URL || '',
  signSessionTtlMs: Number(process.env.SIGN_SESSION_TTL_MINUTES || 10) * 60 * 1000,
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 25),
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || '',
  },
  dispatchWebhookUrl: process.env.DISPATCH_WEBHOOK_URL || '',
  webDist: path.resolve(__dirname, '..', '..', 'web', 'dist'),
};

export default config;
