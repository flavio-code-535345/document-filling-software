import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import archiver from 'archiver';
import Papa from 'papaparse';
import rateLimit from 'express-rate-limit';
import config from '../config.js';
import { store } from '../store/fileStore.js';
import { renderDocument } from '../services/pdfEngine.js';
import { runBulkJob } from '../services/bulkProcessor.js';
import { audit } from '../utils/audit.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024 },
});

const generateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

export const generateRouter = Router();

/**
 * Start a bulk generation job.
 * Accepts either:
 *   - multipart with a CSV file (field "csv") + JSON "options"
 *   - JSON body { templateId, rows: [...], options: {...} }
 * Returns { jobId } immediately; poll GET /api/jobs/:id for progress.
 */
generateRouter.post('/generate', generateLimiter, upload.single('csv'), async (req, res, next) => {
  try {
    let templateId, rows, options;

    if (req.file) {
      templateId = req.body.templateId;
      options = req.body.options ? JSON.parse(req.body.options) : {};
      const parsed = Papa.parse(req.file.buffer.toString('utf8'), { header: true, skipEmptyLines: true });
      if (parsed.errors.length > 0 && parsed.data.length === 0) {
        return res.status(400).json({ error: `CSV parse error: ${parsed.errors[0].message}` });
      }
      rows = parsed.data;
    } else {
      ({ templateId, rows, options = {} } = req.body || {});
    }

    if (!templateId) return res.status(400).json({ error: 'templateId is required.' });
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'At least one data row is required.' });
    if (rows.length > 5000) return res.status(400).json({ error: 'Max 5000 rows per job.' });

    await store.getTemplate(templateId); // 404 if unknown

    const job = await store.createJob({ templateId, options });
    audit('job.created', { jobId: job.id, templateId, rows: rows.length });

    // Run async; errors are captured in the manifest by the processor.
    runBulkJob(job.id, { templateId, rows, options: { ...options, rows } }).catch(() => {});
    res.status(202).json({ jobId: job.id, status: job.status });
  } catch (err) { next(err); }
});

/** Single-document preview (editor "test fill"). Body: { templateId, row } */
generateRouter.post('/generate/preview', generateLimiter, async (req, res, next) => {
  try {
    const { templateId, row = {} } = req.body || {};
    const schema = await store.getTemplate(templateId);
    const bytes = await store.readTemplatePdf(templateId);
    const pdf = await renderDocument(bytes, schema, row);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="preview.pdf"');
    res.send(Buffer.from(pdf));
  } catch (err) { next(err); }
});

generateRouter.get('/jobs/:id', async (req, res) => {
  try { res.json(await store.getJob(req.params.id)); } catch { res.status(404).json({ error: 'Job not found.' }); }
});

/** Download a single produced file or a zip of the whole job. */
generateRouter.get('/jobs/:id/download', async (req, res) => {
  try {
    const job = await store.getJob(req.params.id);
    const jobDir = store.jobDir(job.id);

    if (req.query.file === 'combined' && job.combinedFile) {
      return res.download(path.join(jobDir, job.combinedFile));
    }
    if (req.query.file) {
      const safe = path.normalize(req.query.file).replace(/^(\.\.[/\\])+/, '');
      const full = path.join(jobDir, safe);
      if (!full.startsWith(jobDir) || !fs.existsSync(full)) return res.status(404).json({ error: 'File not found.' });
      return res.download(full);
    }

    // Zip everything
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="docflow-${job.id}.zip"`);
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', () => res.status(500).end());
    archive.pipe(res);
    archive.directory(path.join(jobDir, 'documents'), 'documents');
    if (job.combinedFile) archive.file(path.join(jobDir, job.combinedFile), { name: 'combined.pdf' });
    archive.append(JSON.stringify(job, null, 2), { name: 'manifest.json' });
    await archive.finalize();
  } catch { res.status(404).json({ error: 'Job not found.' }); }
});
