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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type AlignOp = "left" | "right" | "top" | "bottom";

/** Align the selected fields to the chosen edge of their bounding box. */
export function alignFields(
  fields: TemplateField[],
  ids: string[],
  op: AlignOp
): TemplateField[] {
  const selected = fields.filter((f) => ids.includes(f.id));
  if (selected.length < 2) return fields;

  let target: number;
  if (op === "left") target = Math.min(...selected.map((f) => f.x));
  else if (op === "right") target = Math.max(...selected.map((f) => f.x + f.width));
  else if (op === "top") target = Math.min(...selected.map((f) => f.y));
  else target = Math.max(...selected.map((f) => f.y + f.height));

  return fields.map((f) => {
    if (!ids.includes(f.id)) return f;
    if (op === "left") return { ...f, x: round2(target) };
    if (op === "right") return { ...f, x: round2(target - f.width) };
    if (op === "top") return { ...f, y: round2(target) };
    return { ...f, y: round2(target - f.height) };
  });
}

/** Distribute the selected fields evenly along an axis (left/top edges). */
export function distributeFields(
  fields: TemplateField[],
  ids: string[],
  axis: "x" | "y"
): TemplateField[] {
  const selected = fields.filter((f) => ids.includes(f.id));
  if (selected.length < 3) return fields;

  const sorted = [...selected].sort((a, b) => a[axis] - b[axis]);
  const first = sorted[0][axis];
  const last = sorted[sorted.length - 1][axis];
  const step = (last - first) / (sorted.length - 1);
  const positions = new Map(sorted.map((f, i) => [f.id, first + i * step]));

  return fields.map((f) => {
    const v = positions.get(f.id);
    if (v === undefined) return f;
    return { ...f, [axis]: round2(v) };
  });
}

/** Link the selected fields into one group (share a linkKey). */
export function linkFields(fields: TemplateField[], ids: string[]): TemplateField[] {
  if (ids.length < 2) return fields;
  const selected = fields.filter((f) => ids.includes(f.id));
  const key = selected.find((f) => f.linkKey)?.linkKey ?? newFieldId();
  return fields.map((f) => (ids.includes(f.id) ? { ...f, linkKey: key } : f));
}

/** Remove the selected fields from any link group. */
export function unlinkFields(fields: TemplateField[], ids: string[]): TemplateField[] {
  return fields.map((f) => (ids.includes(f.id) ? { ...f, linkKey: undefined } : f));
}
