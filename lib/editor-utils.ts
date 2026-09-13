// Pure helpers for the visual editor.
import type {
  FieldKind,
  FontFamily,
  FontStyle,
  FontWeight,
  OverflowMode,
  TemplateField,
  TextAlign,
  VerticalAlign,
} from "@/lib/types";

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

/**
 * Repeats an entire page set `times` additional times — e.g. a 2-page
 * duplex sheet with times=3 becomes 8 pages. Copied fields keep their
 * page-rank-based day/column labels working unmodified (KW/date
 * auto-numbering in FillForm.tsx is purely page-rank based) but get a
 * "(2)", "(3)", … suffix per block via `uniqueCopyLabel` unless they already
 * carry a `linkKey` (e.g. Name/Vorname), which is preserved as-is so those
 * stay one shared input across every block.
 *
 * IDs are derived deterministically (`${originalId}::rep${block}`) rather
 * than random — this is what lets the temporary, per-export "how many
 * weeks" choice on the fill page work at all: the browser expands the
 * field list to build its own form state (values keyed by these ids), and
 * later the server *independently* expands the same original fields with
 * the same `times` to know what to fill — since neither side sends the
 * other its expanded field list, the ids have to line up on their own.
 * (The persisted "Endlos-Modus" editor route reuses this too, where the
 * determinism doesn't matter but the one shared implementation does.)
 */
export function expandFieldsForRepeat(
  fields: TemplateField[],
  originalPageCount: number,
  times: number
): TemplateField[] {
  if (times <= 0) return fields;
  const out: TemplateField[] = [...fields];
  for (let b = 1; b <= times; b++) {
    const blockCopies: TemplateField[] = [];
    // Original label -> this block's relabeled version, for unlinked fields
    // only (a linked field keeps its original label/identity on purpose).
    const labelMap = new Map<string, string>();
    for (const f of fields) {
      const copy: TemplateField = { ...f, id: `${f.id}::rep${b}`, page: f.page + b * originalPageCount };
      if (!copy.linkKey) {
        copy.label = uniqueCopyLabel(f.label, [...out, ...blockCopies]);
        labelMap.set(f.label, copy.label);
      }
      blockCopies.push(copy);
    }
    // A formula references sibling fields by their *original* label
    // (e.g. a "Total-Std" field summing that week's day fields). Left
    // as-is, every duplicated copy of it would keep computing from block
    // 0's fields forever instead of its own block's — invisible as long as
    // every block happens to hold the same numbers (e.g. default values),
    // but wrong the moment one block's hours are edited differently from
    // another's. Rewrite any {Label} this block relabeled to match.
    for (const copy of blockCopies) {
      if (copy.formula) {
        copy.formula = copy.formula.replace(/\{([^}]+)\}/g, (whole, label) => {
          const mapped = labelMap.get(label.trim());
          return mapped ? `{${mapped}}` : whole;
        });
      }
    }
    out.push(...blockCopies);
  }
  return out;
}

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

const FIELD_KINDS: FieldKind[] = ["text", "multiline", "date", "checkbox", "signature", "matrix"];
const TEXT_ALIGNS: TextAlign[] = ["left", "center", "right"];
const VERTICAL_ALIGNS: VerticalAlign[] = ["top", "middle", "bottom"];
const OVERFLOW_MODES: OverflowMode[] = ["shrink", "visible"];
const FONT_FAMILIES: FontFamily[] = ["Helvetica", "Times-Roman", "Courier"];
const FONT_WEIGHTS: FontWeight[] = ["normal", "bold"];
const FONT_STYLES: FontStyle[] = ["normal", "italic"];

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}
function isNumberArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.every((x) => isFiniteNumber(x));
}

export interface ImportFieldsResult {
  fields: TemplateField[];
  /** Human-readable (German) reasons individual entries were skipped. */
  errors: string[];
  /** Count of entries that were valid but matched a field already on the
   * template (or already earlier in the same file) and were skipped. */
  duplicateCount: number;
}

const DUPLICATE_EPSILON = 0.05; // pt — tolerates JSON round-tripping/rounding, not a real position difference

/** True if two fields would land as the same visible box on the same page —
 * used to keep "Felder importieren" idempotent (re-importing the same file,
 * or importing into a template that already has these fields, adds nothing
 * new instead of silently doubling everything up). Compares label/kind/page
 * and geometry only; ids are irrelevant since imported ones are never kept,
 * and cosmetic props (color, font, defaultValue, …) don't make it a
 * different field. */
function isSameField(a: TemplateField, b: TemplateField): boolean {
  return (
    a.label === b.label &&
    a.kind === b.kind &&
    a.page === b.page &&
    Math.abs(a.x - b.x) < DUPLICATE_EPSILON &&
    Math.abs(a.y - b.y) < DUPLICATE_EPSILON &&
    Math.abs(a.width - b.width) < DUPLICATE_EPSILON &&
    Math.abs(a.height - b.height) < DUPLICATE_EPSILON
  );
}

/**
 * Parses and validates a field list for the "Felder importieren" feature:
 * either `TemplateField[]`-shaped JSON or `{ "fields": [...] }`. Only
 * `label`/`kind`/`x`/`y`/`width`/`height` are required per entry — everything
 * else is optional and defaulted, matching what the visual editor itself
 * would produce for a manually-placed field. `id` is always regenerated
 * (imported IDs are never trusted, so re-importing the same file twice never
 * collides with itself or with existing fields), and `page` is clamped into
 * the template's actual page range rather than rejected.
 *
 * `existing` is the template's current fields — anything that would land as
 * the exact same box (see `isSameField`) is skipped rather than appended
 * again, so clicking import twice, or importing a file that overlaps fields
 * you already placed, doesn't duplicate them.
 */
export function parseImportedFields(
  raw: unknown,
  pageCount: number,
  existing: TemplateField[] = []
): ImportFieldsResult {
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { fields?: unknown }).fields)
      ? (raw as { fields: unknown[] }).fields
      : [];

  if (list.length === 0) {
    return {
      fields: [],
      errors: ['Kein gültiges Format erkannt — erwartet ein Array oder { "fields": [...] }.'],
      duplicateCount: 0,
    };
  }

  const fields: TemplateField[] = [];
  const errors: string[] = [];
  const seen = [...existing]; // grows as we go, so dupes *within* the file are caught too
  let duplicateCount = 0;

  list.forEach((item, i) => {
    if (!item || typeof item !== "object") {
      errors.push(`Eintrag ${i + 1}: kein Objekt.`);
      return;
    }
    const f = item as Record<string, unknown>;
    const label = typeof f.label === "string" && f.label.trim() ? f.label.trim() : null;
    const kind = typeof f.kind === "string" && FIELD_KINDS.includes(f.kind as FieldKind) ? (f.kind as FieldKind) : null;
    const geometryOk = ["x", "y", "width", "height"].every((k) => isFiniteNumber(f[k]));

    if (!label || !kind || !geometryOk) {
      errors.push(
        `Eintrag ${i + 1}${label ? ` ("${label}")` : ""}: fehlende oder ungültige Pflichtangaben (label, kind, x, y, width, height).`
      );
      return;
    }

    const field: TemplateField = {
      id: newFieldId(),
      label,
      kind,
      page: clampPageIndex(isFiniteNumber(f.page) ? f.page : 0, pageCount),
      x: f.x as number,
      y: f.y as number,
      width: f.width as number,
      height: f.height as number,
      fontSize: isFiniteNumber(f.fontSize) ? f.fontSize : 11,
      required: typeof f.required === "boolean" ? f.required : false,
    };

    if (typeof f.inFileName === "boolean") field.inFileName = f.inFileName;
    if (typeof f.align === "string" && TEXT_ALIGNS.includes(f.align as TextAlign)) field.align = f.align as TextAlign;
    if (typeof f.valign === "string" && VERTICAL_ALIGNS.includes(f.valign as VerticalAlign))
      field.valign = f.valign as VerticalAlign;
    if (typeof f.overflow === "string" && OVERFLOW_MODES.includes(f.overflow as OverflowMode))
      field.overflow = f.overflow as OverflowMode;
    if (isFiniteNumber(f.digitBoxes) && f.digitBoxes > 1) field.digitBoxes = Math.round(f.digitBoxes);
    if (typeof f.fontFamily === "string" && FONT_FAMILIES.includes(f.fontFamily as FontFamily))
      field.fontFamily = f.fontFamily as FontFamily;
    if (typeof f.fontWeight === "string" && FONT_WEIGHTS.includes(f.fontWeight as FontWeight))
      field.fontWeight = f.fontWeight as FontWeight;
    if (typeof f.fontStyle === "string" && FONT_STYLES.includes(f.fontStyle as FontStyle))
      field.fontStyle = f.fontStyle as FontStyle;
    if (typeof f.textColor === "string") field.textColor = f.textColor;
    if (typeof f.linkKey === "string" && f.linkKey) field.linkKey = f.linkKey;
    if (typeof f.formula === "string" && f.formula) field.formula = f.formula;
    if (typeof f.defaultValue === "string" && f.defaultValue) field.defaultValue = f.defaultValue;
    if (isStringArray(f.matrixRows)) field.matrixRows = f.matrixRows;
    if (isStringArray(f.matrixCols)) field.matrixCols = f.matrixCols;
    if (isFiniteNumber(f.matrixCellWidth)) field.matrixCellWidth = f.matrixCellWidth;
    if (isFiniteNumber(f.matrixCellHeight)) field.matrixCellHeight = f.matrixCellHeight;
    if (isFiniteNumber(f.matrixDriftX)) field.matrixDriftX = f.matrixDriftX;
    if (isFiniteNumber(f.matrixDriftY)) field.matrixDriftY = f.matrixDriftY;
    if (isNumberArray(f.matrixRowDx)) field.matrixRowDx = f.matrixRowDx;
    if (isNumberArray(f.matrixRowDy)) field.matrixRowDy = f.matrixRowDy;
    if (isNumberArray(f.matrixColDx)) field.matrixColDx = f.matrixColDx;
    if (isNumberArray(f.matrixColDy)) field.matrixColDy = f.matrixColDy;

    if (seen.some((s) => isSameField(s, field))) {
      duplicateCount += 1;
      return;
    }
    seen.push(field);
    fields.push(field);
  });

  return { fields, errors, duplicateCount };
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

/** Golden-angle hue so successive link groups get well-separated, non-repeating colors. */
function linkColor(index: number): string {
  const hue = Math.round((index * 137.5) % 360);
  return `hsl(${hue} 70% 55%)`;
}

/** Map each distinct linkKey to a unique color (in order of first appearance). */
export function buildLinkColors(fields: TemplateField[]): Map<string, string> {
  const map = new Map<string, string>();
  let i = 0;
  for (const f of fields) {
    if (f.linkKey && !map.has(f.linkKey)) {
      map.set(f.linkKey, linkColor(i));
      i++;
    }
  }
  return map;
}
