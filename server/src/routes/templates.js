import { Router } from 'express';
import multer from 'multer';
import config from '../config.js';
import { store } from '../store/fileStore.js';
import { readPageInfo } from '../services/pdfEngine.js';
import { autoDetectFields } from '../services/autodetect.js';
import { audit } from '../utils/audit.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024 },
});

export const templatesRouter = Router();

/** Upload a baseline PDF and create a template. */
templatesRouter.post('/', upload.single('pdf'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Missing PDF file (field "pdf").' });
    if (!req.file.buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      return res.status(400).json({ error: 'File is not a PDF.' });
    }
    const schema = await store.createTemplate({ name: req.body.name || req.file.originalname, pdfBuffer: req.file.buffer });
    const info = await readPageInfo(req.file.buffer);
    Object.assign(schema, info);
    await store.saveTemplate(schema);
    audit('template.created', { templateId: schema.id, name: schema.name });
    res.status(201).json(schema);
  } catch (err) { next(err); }
});

templatesRouter.get('/', async (_req, res, next) => {
  try { res.json(await store.listTemplates()); } catch (err) { next(err); }
});

templatesRouter.get('/:id', async (req, res, next) => {
  try { res.json(await store.getTemplate(req.params.id)); } catch { res.status(404).json({ error: 'Template not found.' }); }
});

/** Raw PDF bytes (used by the editor's pdf.js renderer). */
templatesRouter.get('/:id/pdf', async (req, res, next) => {
  try {
    res.setHeader('Content-Type', 'application/pdf');
    res.send(await store.readTemplatePdf(req.params.id));
  } catch { res.status(404).json({ error: 'Template not found.' }); }
});

/** Save field schema (visual editor state). */
templatesRouter.put('/:id/fields', async (req, res, next) => {
  try {
    const schema = await store.getTemplate(req.params.id);
    const fields = Array.isArray(req.body.fields) ? req.body.fields : [];
    schema.fields = fields.map(sanitizeField);
    await store.saveTemplate(schema);
    audit('template.fieldsSaved', { templateId: schema.id, fieldCount: fields.length });
    res.json(schema);
  } catch (err) { next(err); }
});

templatesRouter.delete('/:id', async (req, res, next) => {
  try {
    await store.deleteTemplate(req.params.id);
    audit('template.deleted', { templateId: req.params.id });
    res.status(204).end();
  } catch (err) { next(err); }
});

/**
 * Auto-detect fields. Body: { useAI?: boolean }
 * - AcroForm introspection always runs first (offline, instant).
 * - AI vision detection is used when requested and configured.
 */
templatesRouter.post('/:id/autodetect', async (req, res, next) => {
  try {
    const schema = await store.getTemplate(req.params.id);
    const bytes = await store.readTemplatePdf(req.params.id);
    const result = await autoDetectFields(bytes, schema.pageSizes, { useAI: Boolean(req.body?.useAI) });
    audit('template.autodetect', { templateId: schema.id, provider: result.provider, found: result.fields.length });
    res.json(result);
  } catch (err) {
    if (err.code === 'AI_NOT_CONFIGURED') return res.status(400).json({ error: err.message, code: err.code });
    next(err);
  }
});

function sanitizeField(f) {
  return {
    id: String(f.id),
    tag: String(f.tag || '').trim(),
    type: ['text', 'date', 'signature', 'checkbox', 'image'].includes(f.type) ? f.type : 'text',
    page: Math.max(0, Number(f.page) || 0),
    x: Number(f.x) || 0, y: Number(f.y) || 0,
    w: Math.max(4, Number(f.w) || 100), h: Math.max(4, Number(f.h) || 16),
    fontSize: Number(f.fontSize) || 11,
    color: typeof f.color === 'string' ? f.color : '#111111',
    align: ['left', 'center', 'right'].includes(f.align) ? f.align : 'left',
    bold: Boolean(f.bold),
    format: f.format ? String(f.format) : undefined,
    template: f.template ? String(f.template) : undefined,
    defaultValue: f.defaultValue !== undefined ? String(f.defaultValue) : undefined,
    required: Boolean(f.required),
    conditions: Array.isArray(f.conditions) ? f.conditions : [],
    source: f.source || 'manual',
  };
}
