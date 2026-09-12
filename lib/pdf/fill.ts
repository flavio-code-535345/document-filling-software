// Server-side PDF filling with pdf-lib. Coordinates: PDF points, top-left origin
// (converted to pdf-lib's bottom-left origin per draw call).
// Placement math comes from lib/geometry (shared with browser previews).
import { PDFDocument, PDFFont, StandardFonts, degrees, rgb, type RGB } from "pdf-lib";
import type { FillValues, StoredTemplate, TemplateField } from "../types";
import { evaluateFormulas } from "../formula";
import {
  baselineFromTop,
  digitBoxRects,
  fitDigitBoxFont,
  fitMultiline,
  fitSingleLine,
  formatGermanDate,
  matrixCellCenter,
  matrixMarkSize,
  multilineFirstBaseline,
  textAlignX,
} from "../geometry";

function isTruthy(value: string | boolean | undefined): boolean {
  return value === true || value === "true" || value === "1" || value === "on";
}

/** Resolve the StandardFonts name for a field's fontFamily/weight/style. */
function standardFontName(field: TemplateField): StandardFonts {
  const family = field.fontFamily ?? "Helvetica";
  const bold = field.fontWeight === "bold";
  const italic = field.fontStyle === "italic";
  switch (family) {
    case "Times-Roman":
      return italic
        ? bold ? StandardFonts.TimesRomanBoldItalic : StandardFonts.TimesRomanItalic
        : bold ? StandardFonts.TimesRomanBold : StandardFonts.TimesRoman;
    case "Courier":
      return italic
        ? bold ? StandardFonts.CourierBoldOblique : StandardFonts.CourierOblique
        : bold ? StandardFonts.CourierBold : StandardFonts.Courier;
    default:
      return italic
        ? bold ? StandardFonts.HelveticaBoldOblique : StandardFonts.HelveticaOblique
        : bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica;
  }
}

/** Parse a "#RRGGBB" (or "RRGGBB") string into a pdf-lib RGB color. */
function hexToRgb(hex: string | undefined): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? "").trim());
  if (!m) return rgb(0, 0, 0);
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export function wrapText(
  text: string,
  maxWidth: number,
  measure: (s: string) => number
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let current = words[0];
    for (let i = 1; i < words.length; i++) {
      const next = `${current} ${words[i]}`;
      if (measure(next) <= maxWidth) {
        current = next;
      } else {
        lines.push(current);
        current = words[i];
      }
    }
    lines.push(current);
  }
  return lines;
}

export async function fillPdf(
  template: StoredTemplate,
  values: FillValues,
  templatePdfBytes: Uint8Array | Buffer
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(templatePdfBytes, { ignoreEncryption: true });
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontCache = new Map<string, PDFFont>();
  const getFont = async (field: TemplateField): Promise<PDFFont> => {
    const name = standardFontName(field);
    let cached = fontCache.get(name);
    if (!cached) {
      cached = await doc.embedFont(name);
      fontCache.set(name, cached);
    }
    return cached;
  };
  const pages = doc.getPages();

  // Apply per-page display rotation (fields stay in media-box coordinates).
  const rotations = template.pageRotations ?? [];
  pages.forEach((page, i) => {
    const rot = rotations[i] ?? 0;
    if (rot) page.setRotation(degrees(rot));
  });

  // Compute formula fields server-side too (authoritative, independent of
  // whatever the client submitted for them).
  const computedValues = evaluateFormulas(template.fields, values);

  for (const field of template.fields) {
    const page = pages[field.page];
    if (!page) continue;
    const value = computedValues[field.id];
    if (value === undefined || value === null || value === "") continue;
    const { height: pageHeight } = page.getSize();

    switch (field.kind) {
      case "text": {
        const raw = String(value).trim();
        if (!raw) break;
        const font = await getFont(field);
        const measure = (s: string, sz: number) => font.widthOfTextAtSize(s, sz);

        if (field.digitBoxes && field.digitBoxes > 1) {
          const rects = digitBoxRects(field, field.digitBoxes);
          const chars = raw.slice(0, rects.length).split("");
          const boxWidth = rects[0]?.width ?? field.width;
          const size = fitDigitBoxFont(field, chars, boxWidth, measure, field.overflow);
          const baseline = baselineFromTop(field, size, field.valign);
          chars.forEach((ch, i) => {
            const rect = rects[i];
            const width = font.widthOfTextAtSize(ch, size);
            page.drawText(ch, {
              x: rect.x + (rect.width - width) / 2,
              y: pageHeight - field.y - baseline,
              size,
              font,
              color: hexToRgb(field.textColor),
            });
          });
          break;
        }

        const size = fitSingleLine(field, raw, measure, field.overflow);
        const width = font.widthOfTextAtSize(raw, size);
        page.drawText(raw, {
          x: textAlignX(field, width, field.align),
          y: pageHeight - field.y - baselineFromTop(field, size, field.valign),
          size,
          font,
          color: hexToRgb(field.textColor),
        });
        break;
      }
      case "date": {
        const raw = String(value).trim();
        if (!raw) break;
        const text = formatGermanDate(raw);
        const font = await getFont(field);
        const size = fitSingleLine(
          field,
          text,
          (s, sz) => font.widthOfTextAtSize(s, sz),
          field.overflow
        );
        const width = font.widthOfTextAtSize(text, size);
        page.drawText(text, {
          x: textAlignX(field, width, field.align),
          y: pageHeight - field.y - baselineFromTop(field, size, field.valign),
          size,
          font,
          color: hexToRgb(field.textColor),
        });
        break;
      }
      case "multiline": {
        const raw = String(value).trim();
        if (!raw) break;
        const font = await getFont(field);
        const { fontSize, lines } = fitMultiline(
          field,
          raw,
          (s, sz) => font.widthOfTextAtSize(s, sz),
          (t, w, sz) => wrapText(t, w, (s) => font.widthOfTextAtSize(s, sz)),
          field.overflow
        );
        const lineHeight = fontSize * 1.3;
        const firstBaseline = multilineFirstBaseline(field, fontSize, lines.length, field.valign);
        lines.forEach((line, i) => {
          const width = font.widthOfTextAtSize(line, fontSize);
          page.drawText(line, {
            x: textAlignX(field, width, field.align),
            y: pageHeight - field.y - firstBaseline - i * lineHeight,
            size: fontSize,
            font,
            color: hexToRgb(field.textColor),
          });
        });
        break;
      }
      case "checkbox": {
        if (!isTruthy(value as string | boolean)) break;
        const cx = field.x + field.width / 2;
        const cy = field.y + field.height / 2;
        const size = Math.min(field.width, field.height) * 0.8;
        page.drawText("X", {
          x: cx - boldFont.widthOfTextAtSize("X", size) / 2,
          y: pageHeight - cy - size * 0.35,
          size,
          font: boldFont,
          color: rgb(0, 0, 0),
        });
        break;
      }
      case "signature": {
        const dataUrl = String(value).trim();
        if (!dataUrl.startsWith("data:image/png;base64,")) break;
        const base64 = dataUrl.slice("data:image/png;base64,".length);
        let bytes: Uint8Array;
        try {
          bytes = Buffer.from(base64, "base64");
        } catch {
          break;
        }
        if (bytes.length === 0) break;
        const image = await doc.embedPng(bytes);
        page.drawImage(image, {
          x: field.x,
          y: pageHeight - field.y - field.height,
          width: field.width,
          height: field.height,
        });
        break;
      }
      case "matrix": {
        const selection = value as Record<string, boolean> | undefined;
        if (!selection) break;
        const markSize = matrixMarkSize(field);
        for (const [key, selected] of Object.entries(selection)) {
          if (!selected) continue;
          const [rowStr, colStr] = key.split(":");
          const row = Number(rowStr);
          const col = Number(colStr);
          if (Number.isNaN(row) || Number.isNaN(col)) continue;
          const { cx, cy } = matrixCellCenter(field, row, col);
          page.drawText("X", {
            x: cx - boldFont.widthOfTextAtSize("X", markSize) / 2,
            y: pageHeight - cy - markSize * 0.35,
            size: markSize,
            font: boldFont,
            color: rgb(0, 0, 0),
          });
        }
        break;
      }
    }
  }

  doc.setProducer("DocFlow");
  return doc.save();
}

export function buildFilenameParts(
  template: StoredTemplate,
  values: FillValues
): { label: string; value: string }[] {
  const computed = evaluateFormulas(template.fields, values);
  return template.fields
    .filter((f) => f.inFileName)
    .map((f) => ({ label: f.label, value: String(computed[f.id] ?? "") }));
}
