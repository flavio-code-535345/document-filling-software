// Server-side PDF filling with pdf-lib. Coordinates: PDF points, top-left origin
// (converted to pdf-lib's bottom-left origin per draw call).
// Placement math comes from lib/geometry (shared with browser previews).
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { FillValues, StoredTemplate } from "../types";
import {
  baselineFromTop,
  formatGermanDate,
  matrixCellCenter,
  matrixMarkSize,
} from "../geometry";

function isTruthy(value: string | boolean | undefined): boolean {
  return value === true || value === "true" || value === "1" || value === "on";
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
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();

  for (const field of template.fields) {
    const page = pages[field.page];
    if (!page) continue;
    const value = values[field.id];
    if (value === undefined || value === null || value === "") continue;
    const { height: pageHeight } = page.getSize();

    switch (field.kind) {
      case "text":
      case "date": {
        const raw = String(value).trim();
        if (!raw) break;
        const text = field.kind === "date" ? formatGermanDate(raw) : raw;
        page.drawText(text, {
          x: field.x,
          y: pageHeight - baselineFromTop(field),
          size: field.fontSize,
          font,
          color: rgb(0, 0, 0),
        });
        break;
      }
      case "multiline": {
        const raw = String(value).trim();
        if (!raw) break;
        const lines = wrapText(raw, field.width, (s) => font.widthOfTextAtSize(s, field.fontSize));
        const lineHeight = field.fontSize * 1.3;
        let lineIndex = 0;
        for (const line of lines) {
          const baselineTop = baselineFromTop(field) + lineIndex * lineHeight;
          if (baselineTop + field.fontSize * 0.72 > field.height) break;
          page.drawText(line, {
            x: field.x,
            y: pageHeight - baselineTop,
            size: field.fontSize,
            font,
            color: rgb(0, 0, 0),
          });
          lineIndex++;
        }
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
  return template.fields
    .filter((f) => f.inFileName)
    .map((f) => ({ label: f.label, value: String(values[f.id] ?? "") }));
}
