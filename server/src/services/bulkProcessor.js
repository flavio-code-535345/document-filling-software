import path from 'node:path';
import fsp from 'node:fs/promises';
import { store } from '../store/fileStore.js';
import { renderDocument, mergeDocuments } from './pdfEngine.js';
import { interpolate, sanitizeFilename } from '../utils/text.js';
import { audit } from '../utils/audit.js';
import { dispatchJob } from './dispatch.js';

/**
 * Bulk processor — maps structured rows onto a template schema and renders
 * one PDF per row. Jobs run async in-process; the manifest on disk is the
 * progress source of truth (polled by the frontend). For horizontal scale,
 * this runner can be moved into a worker consuming from a queue (BullMQ/SQS)
 * without touching the engine.
 *
 * options:
 *   mapping      { csvColumn: tag }  — how incoming columns map to field tags
 *   defaults     { tag: value }      — values applied when a row has none
 *   filenamePattern  e.g. "contract-{{client_name}}" (interpolated)
 *   combine      boolean — also emit one merged PDF
 *   emailTo      optional column/tag containing recipient addresses
 */
export async function runBulkJob(jobId, { templateId, rows, options = {} }) {
  const manifest = await store.getJob(jobId);
  const jobDir = store.jobDir(jobId);
  const docsDir = path.join(jobDir, 'documents');

  try {
    manifest.status = 'running';
    manifest.total = rows.length;
    await store.saveJob(manifest);

    const schema = await store.getTemplate(templateId);
    const templateBytes = await store.readTemplatePdf(templateId);
    const allBytes = [];

    for (let i = 0; i < rows.length; i++) {
      const rawRow = rows[i];
      const row = applyMapping(rawRow, options.mapping, options.defaults);
      try {
        const bytes = await renderDocument(templateBytes, schema, row);
        const base = sanitizeFilename(
          interpolate(options.filenamePattern || '{{_index}}', { ...row, _index: String(i + 1).padStart(4, '0') })
        );
        const fileName = `${base}.pdf`;
        await fsp.writeFile(path.join(docsDir, fileName), bytes);
        manifest.files.push({ file: `documents/${fileName}`, row: i + 1 });
        if (options.combine) allBytes.push(bytes);
        manifest.completed += 1;
      } catch (err) {
        manifest.failed += 1;
        manifest.errors.push({ row: i + 1, message: err.message });
      }
      // Persist progress every row (cheap) so the UI can poll live status.
      if (i % 5 === 0 || i === rows.length - 1) await store.saveJob(manifest);
    }

    if (options.combine && allBytes.length > 0) {
      const combined = await mergeDocuments(allBytes);
      await fsp.writeFile(path.join(jobDir, 'combined.pdf'), combined);
      manifest.combinedFile = 'combined.pdf';
    }

    manifest.status = manifest.failed === manifest.total && manifest.total > 0 ? 'failed' : 'done';
    await store.saveJob(manifest);
    audit('job.completed', { jobId, templateId, total: manifest.total, failed: manifest.failed });

    // Fire-and-forget post-processing (email / webhook). Errors are logged,
    // never fail the job retroactively.
    dispatchJob(manifest, { jobDir, options }).catch((err) =>
      console.error(`[dispatch] job ${jobId}:`, err.message)
    );

    return manifest;
  } catch (err) {
    manifest.status = 'failed';
    manifest.errors.push({ row: null, message: err.message });
    await store.saveJob(manifest);
    audit('job.failed', { jobId, templateId, message: err.message });
    throw err;
  }
}

function applyMapping(rawRow, mapping = {}, defaults = {}) {
  const row = { ...defaults };
  for (const [col, value] of Object.entries(rawRow)) {
    const tag = mapping[col] ?? col; // unmapped columns pass through by name
    if (tag && value !== undefined && value !== '') row[tag] = value;
  }
  return row;
}
