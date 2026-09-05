/**
 * End-to-end API test: boots the real server on an ephemeral port and walks
 * the complete pipeline — upload template, auto-detect, save schema, bulk
 * generate from CSV, poll job, download combined PDF, single preview.
 *   node scripts/e2e-api.js
 */
import http from 'node:http';
import assert from 'node:assert';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createApp } from '../src/app.js';
import { store } from '../src/store/fileStore.js';

async function makeTemplatePdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Service Agreement', { x: 72, y: 730, size: 18, font });
  const form = doc.getForm();
  form.createTextField('client_name').addToPage(page, { x: 120, y: 680, width: 220, height: 18 });
  form.createTextField('contract_date').addToPage(page, { x: 120, y: 650, width: 140, height: 18 });
  return doc.save();
}

async function main() {
  await store.init();
  const server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;

  // health
  const health = await (await fetch(`${base}/api/health`)).json();
  assert.equal(health.ok, true);
  console.log('  PASS  GET /api/health');

  // upload template
  const pdfBytes = await makeTemplatePdf();
  const fd = new FormData();
  fd.append('pdf', new Blob([pdfBytes], { type: 'application/pdf' }), 'agreement.pdf');
  fd.append('name', 'Service Agreement');
  const upRes = await fetch(`${base}/api/templates`, { method: 'POST', body: fd });
  assert.equal(upRes.status, 201);
  const template = await upRes.json();
  assert.equal(template.pageCount, 1);
  console.log('  PASS  POST /api/templates (upload + page info)');

  // autodetect
  const ad = await (await fetch(`${base}/api/templates/${template.id}/autodetect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
  assert.ok(ad.fields.length >= 2);
  console.log(`  PASS  autodetect found ${ad.fields.length} fields (${ad.provider})`);

  // save schema
  const putRes = await fetch(`${base}/api/templates/${template.id}/fields`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: ad.fields }),
  });
  assert.equal(putRes.status, 200);
  console.log('  PASS  PUT /api/templates/:id/fields');

  // bulk generate from CSV
  const csv = 'client_name,contract_date\nAda Lovelace,2026-09-05\nAlan Turing,2026-09-06\nGrace Hopper,2026-09-07\n';
  const fd2 = new FormData();
  fd2.append('templateId', template.id);
  fd2.append('csv', new Blob([csv], { type: 'text/csv' }), 'clients.csv');
  fd2.append('options', JSON.stringify({ filenamePattern: 'agreement-{{client_name}}', combine: true }));
  const genRes = await fetch(`${base}/api/generate`, { method: 'POST', body: fd2 });
  assert.equal(genRes.status, 202);
  const { jobId } = await genRes.json();
  console.log('  PASS  POST /api/generate (job accepted)');

  // poll job
  let job;
  for (let i = 0; i < 50; i++) {
    job = await (await fetch(`${base}/api/jobs/${jobId}`)).json();
    if (job.status === 'done' || job.status === 'failed') break;
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.equal(job.status, 'done');
  assert.equal(job.completed, 3);
  assert.equal(job.files.length, 3);
  assert.ok(job.combinedFile);
  console.log('  PASS  job completed: 3 PDFs + combined');

  // download combined
  const dl = await fetch(`${base}/api/jobs/${jobId}/download?file=combined`);
  assert.equal(dl.status, 200);
  const combinedBytes = await dl.arrayBuffer();
  const combinedDoc = await PDFDocument.load(combinedBytes);
  assert.equal(combinedDoc.getPageCount(), 3);
  console.log('  PASS  combined download is a valid 3-page PDF');

  // preview
  const pv = await fetch(`${base}/api/generate/preview`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templateId: template.id, row: { client_name: 'Preview Person', contract_date: '2026-09-05' } }),
  });
  assert.equal(pv.status, 200);
  assert.ok((await pv.arrayBuffer()).byteLength > 500);
  console.log('  PASS  POST /api/generate/preview');

  server.close();
  console.log('\nE2E API test passed.\n');
  process.exit(0);
}

main().catch((err) => { console.error('\nE2E API TEST FAILED:', err); process.exit(1); });
