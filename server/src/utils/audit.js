import fs from 'node:fs';
import config from '../config.js';

/** Append-only JSONL audit trail for compliance-relevant events. */
export function audit(event, details = {}) {
  const entry = { ts: new Date().toISOString(), event, ...details };
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.appendFileSync(config.auditFile, JSON.stringify(entry) + '\n');
  } catch (err) {
    console.error('[audit] write failed:', err.message);
  }
  return entry;
}
