// Local (no cloud AI) PDF field detection.
//
// Reads embedded AcroForm widgets (the interactive fields already present in a
// fillable PDF) via pdf-lib and maps them to TemplateField proposals in PDF
// points with a TOP-LEFT origin — matching lib/geometry exactly. This is fully
// deterministic and runs entirely in-process (works in the slim Docker image).
//
// Flat/scanned PDFs (no AcroForm fields) yield no proposals here; those need a
// vision model, which this module intentionally does not depend on.

import {
  PDFDocument,
  PDFField,
  PDFCheckBox,
  PDFRadioGroup,
  PDFTextField,
  PDFDropdown,
  PDFSignature,
} from "pdf-lib";
import type { FieldKind, TemplateField } from "../types";
import { newId } from "../auth";

function kindOf(field: PDFField): FieldKind | null {
  if (field instanceof PDFCheckBox || field instanceof PDFRadioGroup) return "checkbox";
  if (field instanceof PDFTextField) {
    return (field as PDFTextField).isMultiline() ? "multiline" : "text";
  }
  if (field instanceof PDFSignature) return "signature";
  if (field instanceof PDFDropdown) return "text";
  // Push buttons, option lists, etc. — not fillable text targets, skip.
  return null;
}

/** "topmostSubform[0].Page1[0].Name_Of_Field[0]" → "Name Of Field". */
function cleanLabel(name: string): string {
  const segments = name.split(".");
  let last = segments[segments.length - 1] || name;
  last = last.replace(/\[\d+\]/g, "");
  last = last.replace(/[_\s]+/g, " ").trim();
  if (!last) last = "Feld";
  last = last.replace(/([a-z])([A-Z])/g, "$1 $2");
  return last.charAt(0).toUpperCase() + last.slice(1);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Extract fillable fields from a PDF's AcroForm. Returns proposals with a
 * TOP-LEFT origin (0-based page index), ready to be attached to a template.
 */
export async function detectLocalFields(pdfBytes: Uint8Array): Promise<TemplateField[]> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pages = doc.getPages();
  const pageHeights = pages.map((p) => p.getSize().height);

  const refKey = (n: number, g: number) => `${n}:${g}`;
  const pageIndexByRef = new Map<string, number>();
  pages.forEach((p, i) =>
    pageIndexByRef.set(refKey(p.ref.objectNumber, p.ref.generationNumber), i)
  );

  const fields = doc.getForm().getFields();
  const proposals: TemplateField[] = [];
  const labelCounts = new Map<string, number>();

  for (const field of fields) {
    const kind = kindOf(field);
    if (!kind) continue;

    const baseLabel = cleanLabel(field.getName());

    for (const widget of field.acroField.getWidgets()) {
      let page = 0;
      const pageRef = widget.P();
      if (pageRef) {
        const idx = pageIndexByRef.get(refKey(pageRef.objectNumber, pageRef.generationNumber));
        if (idx !== undefined) page = idx;
      }

      const rect = widget.getRectangle();
      const pageHeight = pageHeights[page] ?? 792;
      const x = rect.x;
      const y = pageHeight - rect.y - rect.height;
      const width = rect.width;
      const height = rect.height;

      if (width < 4 || height < 4) continue;

      const count = labelCounts.get(baseLabel) ?? 0;
      labelCounts.set(baseLabel, count + 1);
      const label = count === 0 ? baseLabel : `${baseLabel} (${count + 1})`;

      proposals.push({
        id: newId(),
        label,
        kind,
        page,
        x: round(x),
        y: round(y),
        width: round(width),
        height: round(height),
        fontSize: kind === "checkbox" ? 8 : Math.min(12, Math.max(6, height - 2)),
        required: false,
      });
    }
  }

  return proposals;
}
