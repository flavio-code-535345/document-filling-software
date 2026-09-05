// Pure helpers for the visual editor.
import type { FieldKind, TemplateField } from "@/lib/types";

export function newFieldId(): string {
  return `f${crypto.randomUUID().replaceAll("-", "")}`;
}

export const DEFAULT_SIZES: Record<FieldKind, { width: number; height: number }> = {
  text: { width: 180, height: 18 },
  multiline: { width: 200, height: 72 },
  date: { width: 90, height: 18 },
  checkbox: { width: 16, height: 16 },
  signature: { width: 180, height: 64 },
  matrix: { width: 120, height: 60 },
};

export const KIND_LABELS: Record<FieldKind, string> = {
  text: "Text",
  multiline: "Mehrzeilig",
  date: "Datum",
  checkbox: "Kästchen",
  signature: "Unterschrift",
  matrix: "Matrix",
};

export function isUniqueLabel(label: string, fields: TemplateField[], excludeId: string): boolean {
  return !fields.some((f) => f.id !== excludeId && f.label === label);
}

/** Consistent auto-numbering for copies of a field. */
export function uniqueCopyLabel(label: string, fields: TemplateField[]): string {
  const base = label.replace(/\s*\(\d+\)$/, "");
  let n = 1;
  let candidate = base;
  while (fields.some((f) => f.label === candidate)) {
    n++;
    candidate = `${base} (${n})`;
  }
  return candidate;
}

/** Copy a field with +8pt offset, fresh id, run conditions: same page. */
export function copyField(field: TemplateField, all: TemplateField[]): TemplateField {
  return {
    ...field,
    id: newFieldId(),
    x: field.x + 8,
    y: field.y + 8,
    label: uniqueCopyLabel(field.label, all),
  };
}

export function createField(
  kind: FieldKind,
  page: number,
  x: number,
  y: number,
  all: TemplateField[],
  fontSizes: number
): TemplateField {
  const size = DEFAULT_SIZES[kind];
  const existing = all.filter((f) => f.kind === kind);
  const base = {
    id: newFieldId(),
    label: `${KIND_LABELS[kind]} ${existing.length + 1}`,
    kind,
    page,
    x: Math.round(x),
    y: Math.round(y),
    width: size.width,
    height: size.height,
    fontSize: fontSizes,
    required: false,
  };
  if (kind === "matrix") {
    return {
      ...base,
      matrixRows: ["1", "2", "3"],
      matrixCols: ["a", "b", "c"],
      matrixCellWidth: 24,
      matrixCellHeight: 24,
    };
  }
  return base;
}

/** Build a "repair" helper target: fields on a page index >= pageCount → 0. */
export function clampPageIndex(page: number, pageCount: number): number {
  return Math.min(Math.max(0, page), Math.max(0, pageCount - 1));
}
