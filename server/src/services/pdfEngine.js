import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { interpolate, formatDate, evalCondition } from '../utils/text.js';

/**
 * pdfEngine — renders a field schema + data row onto a template PDF.
 *
 * Coordinate system: the visual editor stores fields in TOP-LEFT origin
 * (browser convention, PDF points). pdf-lib uses BOTTOM-LEFT origin, so every
 * rect is converted with: pdfY = pageHeight - (y + height).
 *
 * Field types:
 *   text      — interpolated string, auto-shrinking font to fit the box width
 *   date      — value formatted with field.format tokens (YYYY MM DD ...)
 *   signature — PNG/JPEG data-URL drawn contain-fit inside the box
 *   checkbox  — truthy value draws a check glyph (ZapfDingbats)
 *
 * Conditional logic: a field may carry `conditions: [{ when, op, equals }]`.
 * All conditions must pass, otherwise the field is skipped for that row —
 * this enables data-driven documents (e.g. only print "VAT ID" when
 * row.country === 'DE').
 */

const FONT_CACHE_KEY = Symbol('fonts');

async function embedFonts(doc) {
  if (!doc[FONT_CACHE_KEY]) {
    doc[FONT_CACHE_KEY] = {
      regular: await doc.embedFont(StandardFonts.Helvetica),
      bold: await doc.embedFont(StandardFonts.HelveticaBold),
    };
  }
  return doc[FONT_CACHE_KEY];
}

function hexToRgb(hex, fallback = { r: 0.07, g: 0.07, b: 0.07 }) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return rgb(fallback.r, fallback.g, fallback.b);
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function parseDataUrl(dataUrl) {
  const m = /^data:(image\/(?:png|jpe?g));base64,(.+)$/i.exec(dataUrl || '');
  if (!m) return null;
  return { mime: m[1].toLowerCase(), bytes: Buffer.from(m[2], 'base64') };
}

/** Shrink font size until the text fits the box width (min 5pt). */
function fitFontSize(font, text, baseSize, maxWidth) {
  let size = baseSize;
  while (size > 5 && font.widthOfTextAtSize(text, size) > maxWidth) size -= 0.5;
  return size;
}

async function drawField(doc, page, field, row, fonts) {
  const { height: pageHeight } = page.getSize();
  const pdfY = pageHeight - (field.y + field.h);
  const color = hexToRgb(field.color);

  switch (field.type) {
    case 'date': {
      const raw = row[field.tag] ?? field.defaultValue ?? '';
      const text = formatDate(raw, field.format || 'YYYY-MM-DD');
      if (!text) return;
      const font = field.bold ? fonts.bold : fonts.regular;
      const size = fitFontSize(font, text, field.fontSize || 11, field.w);
      page.drawText(text, { x: field.x, y: pdfY + (field.h - size) / 2, size, font, color });
      break;
    }
    case 'text': {
      const text = interpolate(field.template ?? `{{${field.tag}}}`, row) || field.defaultValue || '';
      if (!text) return;
      const font = field.bold ? fonts.bold : fonts.regular;
      const size = fitFontSize(font, text, field.fontSize || 11, field.w);
      const width = font.widthOfTextAtSize(text, size);
      let x = field.x;
      if (field.align === 'center') x = field.x + Math.max(0, (field.w - width) / 2);
      if (field.align === 'right') x = field.x + Math.max(0, field.w - width);
      page.drawText(text, { x, y: pdfY + (field.h - size) / 2, size, font, color });
      break;
    }
    case 'checkbox': {
      const v = row[field.tag];
      const truthy = v === true || v === 'true' || v === '1' || v === 'yes' || v === 'x' || v === 'X';
      if (!truthy) return;
      // Draw a tick as vector lines (font-independent, works with any PDF).
      const s = Math.min(field.h, field.w);
      const x0 = field.x, y0 = pdfY;
      page.drawLine({
        start: { x: x0 + s * 0.15, y: y0 + s * 0.5 },
        end: { x: x0 + s * 0.4, y: y0 + s * 0.2 },
        thickness: Math.max(1.2, s * 0.12), color,
      });
      page.drawLine({
        start: { x: x0 + s * 0.4, y: y0 + s * 0.2 },
        end: { x: x0 + s * 0.9, y: y0 + s * 0.85 },
        thickness: Math.max(1.2, s * 0.12), color,
      });
      break;
    }
    case 'signature':
    case 'image': {
      const raw = row[field.tag] ?? field.defaultValue ?? '';
      const parsed = parseDataUrl(raw);
      if (!parsed) return;
      const img = parsed.mime === 'image/png'
        ? await doc.embedPng(parsed.bytes)
        : await doc.embedJpg(parsed.bytes);
      // contain-fit inside the box, keep aspect ratio
      const scale = Math.min(field.w / img.width, field.h / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, {
        x: field.x + (field.w - w) / 2,
        y: pdfY + (field.h - h) / 2,
        width: w,
        height: h,
      });
      break;
    }
    default:
      break;
  }
}

/**
 * Render a single filled document.
 * @param {Buffer} templateBytes raw PDF bytes of the template
 * @param {object} schema template schema ({ fields: [...] })
 * @param {object} row data record (tag -> value)
 * @returns {Promise<Uint8Array>} filled PDF bytes
 */
export async function renderDocument(templateBytes, schema, row) {
  const doc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
  const fonts = await embedFonts(doc);
  const pages = doc.getPages();

  for (const field of schema.fields || []) {
    const page = pages[field.page];
    if (!page) continue;
    const visible = (field.conditions || []).every((c) => evalCondition(c, row));
    if (!visible) continue;
    await drawField(doc, page, field, row, fonts);
  }

  doc.setProducer('DocFlow');
  doc.setModificationDate(new Date());
  return doc.save();
}

/** Merge multiple PDF byte arrays into one combined document. */
export async function mergeDocuments(pdfBytesList) {
  const out = await PDFDocument.create();
  for (const bytes of pdfBytesList) {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return out.save();
}

/** Read page sizes (PDF points) for editor calibration. */
export async function readPageInfo(templateBytes) {
  const doc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
  return {
    pageCount: doc.getPageCount(),
    pageSizes: doc.getPages().map((p) => {
      const { width, height } = p.getSize();
      return { width, height };
    }),
  };
}
