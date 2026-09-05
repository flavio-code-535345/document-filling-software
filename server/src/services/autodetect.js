import { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup } from 'pdf-lib';
import config from '../config.js';
import { rid } from '../utils/text.js';

/**
 * Field auto-detection.
 *
 * Strategy 1 (offline, always available): AcroForm introspection.
 *   Many real-world PDFs already contain fillable form widgets. We read each
 *   widget's rectangle and map it to a DocFlow field — zero manual drawing.
 *
 * Strategy 2 (optional, AI): a multimodal model inspects page renders and
 *   proposes fields for scanned/flat PDFs. Enabled when OPENAI_API_KEY is set.
 *   The provider is intentionally isolated so a different vision backend
 *   (Azure Document Intelligence, Google Document AI) can be plugged in.
 */

const TYPE_MAP = [
  [PDFTextField, 'text'],
  [PDFCheckBox, 'checkbox'],
  [PDFDropdown, 'text'],
  [PDFRadioGroup, 'checkbox'],
];

function guessSemanticType(name) {
  const n = name.toLowerCase();
  if (/sign|unterschrift|signature/.test(n)) return 'signature';
  if (/date|datum|_at$/.test(n)) return 'date';
  if (/check|box|agree|yes/.test(n)) return 'checkbox';
  return null;
}

export async function detectAcroFormFields(templateBytes) {
  const doc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
  const form = doc.getForm();
  const fields = [];
  const pages = doc.getPages();

  for (const formField of form.getFields()) {
    let type = null;
    for (const [cls, t] of TYPE_MAP) {
      if (formField instanceof cls) { type = t; break; }
    }
    const name = formField.getName();
    type = guessSemanticType(name) || type || 'text';

    const widgets = formField.acroField.getWidgets();
    for (const widget of widgets) {
      const rect = widget.getRectangle();
      // Widget rect is bottom-left origin -> convert to top-left origin.
      let pageIndex = 0;
      const pageRef = widget.P?.();
      if (pageRef) {
        const idx = pages.findIndex((p) => p.ref === pageRef);
        if (idx >= 0) pageIndex = idx;
      }
      const pageHeight = pages[pageIndex]?.getSize().height ?? 792;
      fields.push({
        id: rid('fld'),
        tag: name.replace(/[^\w.-]/g, '_'),
        type,
        page: pageIndex,
        x: Math.round(rect.x),
        y: Math.round(pageHeight - (rect.y + rect.height)),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
        fontSize: Math.min(12, Math.max(8, Math.round(rect.height * 0.6))),
        source: 'acroform',
      });
    }
  }
  return fields;
}

/**
 * AI vision provider (optional). Renders nothing server-side; instead it sends
 * the raw PDF to a multimodal endpoint that accepts PDF input and asks for
 * field proposals as JSON. Disabled unless OPENAI_API_KEY is configured.
 */
export async function detectFieldsWithAI(templateBytes, pageSizes) {
  if (!config.openaiApiKey) {
    const err = new Error('AI provider not configured (set OPENAI_API_KEY)');
    err.code = 'AI_NOT_CONFIGURED';
    throw err;
  }
  const prompt = `You are a form-field detector for a PDF templating system.
Inspect the attached PDF and return ONLY JSON: an array of fillable blanks.
Each item: { "tag": snake_case_name, "type": "text|date|signature|checkbox",
"page": 0-based index, "x": number, "y": number, "w": number, "h": number }.
Coordinates are PDF points with TOP-LEFT origin. Page sizes (pt): ${JSON.stringify(pageSizes)}.
Detect underlined blanks, labeled boxes, date lines and signature lines.`;

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.openaiModel,
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: prompt },
          {
            type: 'input_file',
            filename: 'template.pdf',
            file_data: `data:application/pdf;base64,${Buffer.from(templateBytes).toString('base64')}`,
          },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`AI provider error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const text = data.output_text || '';
  const json = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1));
  return json.map((f) => ({ id: rid('fld'), fontSize: 11, source: 'ai', ...f }));
}

/** Combined entry point: AcroForm first, AI as opt-in fallback/augmentation. */
export async function autoDetectFields(templateBytes, pageSizes, { useAI = false } = {}) {
  const acro = await detectAcroFormFields(templateBytes).catch(() => []);
  if (acro.length > 0 || !useAI) return { fields: acro, provider: acro.length ? 'acroform' : 'none' };
  const ai = await detectFieldsWithAI(templateBytes, pageSizes);
  return { fields: ai, provider: 'ai' };
}
