import path from 'node:path';
import nodemailer from 'nodemailer';
import config from '../config.js';
import { audit } from '../utils/audit.js';

/**
 * Dispatch service — automated delivery after a generation job finishes.
 *
 * Channels:
 *   email   — sends each generated PDF to the address found in the row's
 *             `emailTo` tag (requires SMTP_* env config). Disabled otherwise.
 *   webhook — POSTs the job manifest to DISPATCH_WEBHOOK_URL so downstream
 *             systems (CRM, DMS, Slack) can react.
 *
 * This is the seam where a full workflow engine (schedules, approval chains,
 * e-sign providers) would plug in later.
 */

function smtpConfigured() {
  return Boolean(config.smtp.host && config.smtp.from);
}

export async function dispatchJob(manifest, { jobDir, options }) {
  const results = { email: null, webhook: null };

  if (options.emailTo && smtpConfigured()) {
    results.email = await dispatchEmails(manifest, jobDir, options).catch((err) => ({ error: err.message }));
  }

  if (config.dispatchWebhookUrl) {
    results.webhook = await fetch(config.dispatchWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'job.completed', job: manifest }),
    })
      .then((r) => ({ status: r.status }))
      .catch((err) => ({ error: err.message }));
  }

  audit('job.dispatched', { jobId: manifest.id, results });
  return results;
}

async function dispatchEmails(manifest, jobDir, options) {
  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });

  let sent = 0;
  const rows = options.rows || [];
  for (let i = 0; i < manifest.files.length; i++) {
    const recipient = rows[manifest.files[i].row - 1]?.[options.emailTo];
    if (!recipient) continue;
    await transporter.sendMail({
      from: config.smtp.from,
      to: recipient,
      subject: options.emailSubject || 'Your document',
      text: options.emailBody || 'Please find your document attached.',
      attachments: [{ filename: path.basename(manifest.files[i].file), path: path.join(jobDir, manifest.files[i].file) }],
    });
    sent += 1;
  }
  return { sent };
}
