/**
 * Text utilities: tag interpolation, date formatting, filename sanitizing.
 *
 * Template values support mustache-style interpolation against a data row:
 *   "Invoice for {{client_name}} (#{{invoice_id}})"
 * Fallback filter:  {{ middle_name | "" }}
 * Conditions are handled in the engine, not here.
 */

const TAG_RE = /\{\{\s*([\w.-]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g;

/** Interpolate {{tag}} placeholders with row values. Missing tags fall back to filter or ''. */
export function interpolate(template, row) {
  if (template == null) return '';
  return String(template).replace(TAG_RE, (_m, tag, fallback) => {
    const val = row?.[tag];
    if (val !== undefined && val !== null && val !== '') return String(val);
    const fb = fallback?.replace(/^["']|["']$/g, ''); // strip surrounding quotes
    return fb ?? '';
  });
}

/** Extract all tag names referenced in a template string. */
export function extractTags(template) {
  const tags = new Set();
  if (!template) return tags;
  for (const m of String(template).matchAll(TAG_RE)) tags.add(m[1]);
  return tags;
}

/**
 * Minimal date formatter. Tokens: YYYY YY MM MMM DD HH mm ss.
 * Accepts Date, epoch ms, or date-ish string. Returns raw input if unparseable.
 */
export function formatDate(value, format = 'YYYY-MM-DD', locale = 'en-US') {
  if (value === undefined || value === null || value === '') return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const monthShort = d.toLocaleString(locale, { month: 'short' });
  const pad = (n) => String(n).padStart(2, '0');
  return format
    .replace(/YYYY/g, String(d.getFullYear()))
    .replace(/YY/g, String(d.getFullYear()).slice(-2))
    .replace(/MMM/g, monthShort)
    .replace(/MM/g, pad(d.getMonth() + 1))
    .replace(/DD/g, pad(d.getDate()))
    .replace(/HH/g, pad(d.getHours()))
    .replace(/mm/g, pad(d.getMinutes()))
    .replace(/ss/g, pad(d.getSeconds()));
}

/** Make a string safe for use as a file name. */
export function sanitizeFilename(name) {
  return String(name)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'document';
}

/** Evaluate a field-level visibility condition against a data row. */
export function evalCondition(cond, row) {
  if (!cond || !cond.when) return true;
  const left = row?.[cond.when];
  const right = cond.equals;
  switch (cond.op || 'equals') {
    case 'equals': return String(left ?? '') === String(right ?? '');
    case 'notEquals': return String(left ?? '') !== String(right ?? '');
    case 'contains': return String(left ?? '').includes(String(right ?? ''));
    case 'truthy': return Boolean(left) && left !== 'false' && left !== '0';
    case 'falsy': return !left || left === 'false' || left === '0';
    default: return true;
  }
}

/** Random URL-safe id with prefix. */
export function rid(prefix = 'id') {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const s = Buffer.from(bytes).toString('base64url');
  return `${prefix}_${s}`;
}
