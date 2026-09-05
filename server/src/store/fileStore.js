import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import config from '../config.js';
import { rid } from '../utils/text.js';

/**
 * Filesystem-backed store for templates and generation jobs.
 * A database can be swapped in later; the route layer only uses these functions.
 *
 * Layout:
 *   data/templates/<id>/template.pdf
 *   data/templates/<id>/schema.json
 *   data/jobs/<id>/manifest.json
 *   data/jobs/<id>/documents/*.pdf
 */

async function ensureDirs() {
  for (const dir of [config.dataDir, config.uploadDir, config.templateDir, config.jobDir]) {
    await fsp.mkdir(dir, { recursive: true });
  }
}

export const store = {
  async init() {
    await ensureDirs();
  },

  // ---------- Templates ----------
  async createTemplate({ name, pdfBuffer }) {
    const id = rid('tpl');
    const dir = path.join(config.templateDir, id);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'template.pdf'), pdfBuffer);
    const schema = {
      id,
      name: name || 'Untitled template',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pageCount: 0,
      pageSizes: [],
      fields: [],
    };
    await fsp.writeFile(path.join(dir, 'schema.json'), JSON.stringify(schema, null, 2));
    return schema;
  },

  async listTemplates() {
    await ensureDirs();
    const entries = await fsp.readdir(config.templateDir, { withFileTypes: true });
    const out = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      try {
        const schema = JSON.parse(await fsp.readFile(path.join(config.templateDir, e.name, 'schema.json'), 'utf8'));
        out.push({ id: schema.id, name: schema.name, updatedAt: schema.updatedAt, pageCount: schema.pageCount, fieldCount: schema.fields?.length ?? 0 });
      } catch { /* skip broken template dirs */ }
    }
    return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  },

  async getTemplate(id) {
    const schemaPath = path.join(config.templateDir, id, 'schema.json');
    const schema = JSON.parse(await fsp.readFile(schemaPath, 'utf8'));
    return schema;
  },

  async saveTemplate(schema) {
    schema.updatedAt = new Date().toISOString();
    const schemaPath = path.join(config.templateDir, schema.id, 'schema.json');
    await fsp.writeFile(schemaPath, JSON.stringify(schema, null, 2));
    return schema;
  },

  async deleteTemplate(id) {
    await fsp.rm(path.join(config.templateDir, id), { recursive: true, force: true });
  },

  templatePdfPath(id) {
    return path.join(config.templateDir, id, 'template.pdf');
  },

  async readTemplatePdf(id) {
    return fsp.readFile(this.templatePdfPath(id));
  },

  // ---------- Jobs ----------
  jobDir(id) {
    return path.join(config.jobDir, id);
  },

  async createJob(meta) {
    const id = rid('job');
    const dir = path.join(config.jobDir, id);
    await fsp.mkdir(path.join(dir, 'documents'), { recursive: true });
    const manifest = {
      id,
      status: 'queued', // queued | running | done | failed
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      total: 0,
      completed: 0,
      failed: 0,
      errors: [],
      files: [],
      combinedFile: null,
      ...meta,
    };
    await fsp.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    return manifest;
  },

  async getJob(id) {
    return JSON.parse(await fsp.readFile(path.join(config.jobDir, id, 'manifest.json'), 'utf8'));
  },

  async saveJob(manifest) {
    manifest.updatedAt = new Date().toISOString();
    await fsp.writeFile(path.join(config.jobDir, manifest.id, 'manifest.json'), JSON.stringify(manifest, null, 2));
    return manifest;
  },
};
