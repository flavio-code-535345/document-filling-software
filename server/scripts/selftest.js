/**
 * Self-test: exercises the PDF engine end-to-end without a running server.
 *   node scripts/selftest.js
 * Verifies:
 *   1. interpolation, date formatting, conditions
 *   2. AcroForm auto-detection on a generated fillable PDF
 *   3. renderDocument with text/date/checkbox/signature fields (3 rows)
 *   4. mergeDocuments (combined PDF page count)
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import assert from 'node:assert';
import { interpolate, formatDate, evalCondition } from '../src/utils/text.js';
import { detectAcroFormFields } from '../src/services/autodetect.js';
import { renderDocument, mergeDocuments, readPageInfo } from '../src/services/pdfEngine.js';

const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let passed = 0;
function ok(name) { passed++; console.log(`  PASS  ${name}`); }

async function makeFillablePdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Client onboarding form', { x: 72, y: 720, size: 16, font });
  page.drawText('Name:', { x: 72, y: 680, size: 11, font });
  page.drawText('Date:', { x: 72, y: 650, size: 11, font });
  const form = doc.getForm();
  const nameField = form.createTextField('client_name');
  nameField.addToPage(page, { x: 120, y: 672, width: 200, height: 18 });
  const dateField = form.createTextField('contract_date');
  dateField.addToPage(page, { x: 120, y: 642, width: 120, height: 18 });
  const vipBox = form.createCheckBox('is_vip');
  vipBox.addToPage(page, { x: 120, y: 612, width: 14, height: 14 });
  return doc.save();
}

async function main() {
  console.log('\n[1] text utils');
  assert.equal(interpolate('Hi {{name}} (#{{id}})', { name: 'Ada', id: 7 }), 'Hi Ada (#7)');
  assert.equal(interpolate('{{missing | "n/a"}}', {}), 'n/a');
  assert.equal(formatDate('2026-09-05T10:00:00Z', 'DD.MM.YYYY'), '05.09.2026');
  assert.equal(evalCondition({ when: 'country', equals: 'DE' }, { country: 'DE' }), true);
  assert.equal(evalCondition({ when: 'country', equals: 'DE' }, { country: 'FR' }), false);
  ok('interpolate / formatDate / evalCondition');

  console.log('\n[2] auto-detection (AcroForm)');
  const templateBytes = await makeFillablePdf();
  const info = await readPageInfo(templateBytes);
  assert.equal(info.pageCount, 1);
  const detected = await detectAcroFormFields(templateBytes);
  const tags = detected.map((f) => f.tag).sort();
  assert.deepEqual(tags, ['client_name', 'contract_date', 'is_vip']);
  assert.equal(detected.find((f) => f.tag === 'contract_date').type, 'date');
  ok(`detected ${detected.length} fields (${tags.join(', ')})`);

  console.log('\n[3] renderDocument (3 rows, all field types)');
  const schema = {
    id: 'tpl_test',
    fields: [
      ...detected,
      { id: 'f_sig', tag: 'signature', type: 'signature', page: 0, x: 120, y: 500, w: 180, h: 60 },
      { id: 'f_note', tag: 'note', type: 'text', page: 0, x: 72, y: 300, w: 300, h: 16, template: 'Hello {{client_name}}!', conditions: [{ when: 'is_vip', op: 'equals', equals: 'true' }] },
    ],
  };
  const rows = [
    { client_name: 'Ada Lovelace', contract_date: '2026-09-05', is_vip: 'true', signature: PNG_1PX },
    { client_name: 'Alan Turing with a very long name to shrink', contract_date: '2026-01-01', is_vip: 'false', signature: PNG_1PX },
    { client_name: 'Grace Hopper', contract_date: 'invalid-date', is_vip: 'true', signature: PNG_1PX },
  ];
  const outputs = [];
  for (const row of rows) {
    const bytes = await renderDocument(templateBytes, schema, row);
    const check = await PDFDocument.load(bytes);
    assert.equal(check.getPageCount(), 1);
    outputs.push(bytes);
  }
  ok('rendered 3 documents without error');

  console.log('\n[4] mergeDocuments');
  const combined = await mergeDocuments(outputs);
  const combinedDoc = await PDFDocument.load(combined);
  assert.equal(combinedDoc.getPageCount(), 3);
  ok('combined PDF has 3 pages');

  console.log(`\nAll self-tests passed (${passed} groups).\n`);
}

main().catch((err) => {
  console.error('\nSELF-TEST FAILED:', err);
  process.exit(1);
});
