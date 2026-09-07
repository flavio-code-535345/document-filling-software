// Pure geometry math shared by the server fill engine and the browser
// previews (editor overlay + fill form SVG) so both render identically.
import type { OverflowMode, TemplateField, TextAlign, VerticalAlign } from "./types";

const HELVETICA_RATIO = 0.72;
const DESCENT_RATIO = 0.2;
const LINE_HEIGHT_RATIO = 1.3;
const MIN_FONT_SIZE = 4;

export type MeasureFn = (text: string, fontSize: number) => number;

/** Baseline offset from the field's top edge for a given font size + vertical alignment. */
export function baselineFromTop(
  field: TemplateField,
  fontSize: number = field.fontSize,
  valign: VerticalAlign = "middle"
): number {
  switch (valign) {
    case "top":
      return fontSize * HELVETICA_RATIO;
    case "bottom":
      return field.height - fontSize * DESCENT_RATIO;
    default:
      return (field.height + fontSize * HELVETICA_RATIO) / 2;
  }
}

/** Horizontal x position of left-aligned text given its rendered width. */
export function textAlignX(
  field: TemplateField,
  textWidth: number,
  align: TextAlign = "left"
): number {
  switch (align) {
    case "center":
      return field.x + (field.width - textWidth) / 2;
    case "right":
      return field.x + field.width - textWidth;
    default:
      return field.x;
  }
}

/** Scale a single line of text down so it fits the field width (unless overflow is allowed). */
export function fitSingleLine(
  field: TemplateField,
  text: string,
  measure: MeasureFn,
  overflow: OverflowMode = "shrink"
): number {
  if (overflow === "visible" || !text) return field.fontSize;
  const width = measure(text, field.fontSize);
  if (width <= field.width) return field.fontSize;
  const ratio = field.width / width;
  return Math.max(MIN_FONT_SIZE, Math.floor(field.fontSize * ratio * 100) / 100);
}

/**
 * Wrap and (optionally) shrink a multi-line text so the whole block fits the
 * field box. Returns the final font size and the wrapped lines.
 */
export function fitMultiline(
  field: TemplateField,
  text: string,
  measure: MeasureFn,
  wrap: (text: string, maxWidth: number, fontSize: number) => string[],
  overflow: OverflowMode = "shrink"
): { fontSize: number; lines: string[] } {
  if (overflow === "visible" || !text.trim()) {
    return { fontSize: field.fontSize, lines: wrap(text, field.width, field.fontSize) };
  }
  let fontSize = field.fontSize;
  let lines = wrap(text, field.width, fontSize);
  for (let i = 0; i < 40; i++) {
    const overWidth = lines.some((l) => measure(l, fontSize) > field.width);
    const blockHeight = lines.length * fontSize * LINE_HEIGHT_RATIO;
    if (!overWidth && blockHeight <= field.height) break;
    const next = Math.max(MIN_FONT_SIZE, Math.floor(fontSize * 0.92 * 100) / 100);
    if (next === fontSize) break;
    fontSize = next;
    lines = wrap(text, field.width, fontSize);
  }
  return { fontSize, lines };
}

/** Baseline offset from the field's top edge for the first line of a wrapped block. */
export function multilineFirstBaseline(
  field: TemplateField,
  fontSize: number,
  lineCount: number,
  valign: VerticalAlign = "middle"
): number {
  const blockHeight = lineCount * fontSize * LINE_HEIGHT_RATIO;
  switch (valign) {
    case "top":
      return fontSize * HELVETICA_RATIO;
    case "bottom":
      return field.height - blockHeight + fontSize * HELVETICA_RATIO;
    default:
      return (field.height - blockHeight) / 2 + fontSize * HELVETICA_RATIO;
  }
}

export function matrixCellCenter(
  field: TemplateField,
  row: number,
  col: number
): { cx: number; cy: number } {
  const pitchX = field.matrixCellWidth ?? 20;
  const pitchY = field.matrixCellHeight ?? 20;
  const cx =
    field.x +
    pitchX * (col + 0.5) +
    (field.matrixDriftX ?? 0) * row +
    (field.matrixRowDx?.[row] ?? 0) +
    (field.matrixColDx?.[col] ?? 0);
  const cy =
    field.y +
    pitchY * (row + 0.5) +
    (field.matrixDriftY ?? 0) * row +
    (field.matrixRowDy?.[row] ?? 0) +
    (field.matrixColDy?.[col] ?? 0);
  return { cx, cy };
}

export function matrixMarkSize(field: TemplateField): number {
  return 0.8 * Math.min(field.matrixCellWidth ?? 20, field.matrixCellHeight ?? 20);
}

export function matrixBoxSize(field: TemplateField): { width: number; height: number } {
  const rows = field.matrixRows?.length ?? 0;
  const cols = field.matrixCols?.length ?? 0;
  return {
    width: cols * (field.matrixCellWidth ?? 20),
    height: rows * (field.matrixCellHeight ?? 20),
  };
}

export function formatGermanDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m) return value.trim();
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/** Snap guide lines: edges + centers of other fields on the same page. */
export interface SnapTarget {
  x: number;
  y: number;
}

export function snapCandidates(
  fields: TemplateField[],
  page: number,
  excludeId: string,
  threshold: number
): { lines: { vertical: number[]; horizontal: number[] }; applied: { dx: number; dy: number } } {
  const vertical = new Set<number>();
  const horizontal = new Set<number>();
  for (const f of fields) {
    if (f.page !== page || f.id === excludeId) continue;
    vertical.add(f.x);
    vertical.add(f.x + f.width / 2);
    vertical.add(f.x + f.width);
    horizontal.add(f.y);
    horizontal.add(f.y + f.height / 2);
    horizontal.add(f.y + f.height);
  }

  const pick = (value: number, candidates: Iterable<number>): number => {
    let best = value;
    for (const c of candidates) {
      if (Math.abs(c - value) <= threshold) {
        best = c;
        break;
      }
    }
    return best;
  };

  return {
    lines: { vertical: [...vertical], horizontal: [...horizontal] },
    applied: { dx: 0, dy: 0 },
  };
}

/** Snap several anchor x values (left/center/right) to nearby guide lines. */
export function snapAnchors(
  anchorsX: number[],
  anchorsY: number[],
  fields: TemplateField[],
  page: number,
  excludeId: string,
  threshold: number
): { dx: number; dy: number; guideX: number | null; guideY: number | null } {
  let bestDX = 0;
  let bestDY = 0;
  let guideX: number | null = null;
  let guideY: number | null = null;
  let bestDistX = threshold;
  let bestDistY = threshold;

  for (const f of fields) {
    if (f.page !== page || f.id === excludeId) continue;
    const cxs = [f.x, f.x + f.width / 2, f.x + f.width];
    const cys = [f.y, f.y + f.height / 2, f.y + f.height];
    for (const ax of anchorsX) {
      for (const cx of cxs) {
        const d = Math.abs(cx - ax);
        if (d <= bestDistX) {
          bestDistX = d;
          bestDX = cx - ax;
          guideX = cx;
        }
      }
    }
    for (const ay of anchorsY) {
      for (const cy of cys) {
        const d = Math.abs(cy - ay);
        if (d <= bestDistY) {
          bestDistY = d;
          bestDY = cy - ay;
          guideY = cy;
        }
      }
    }
  }
  return { dx: bestDX, dy: bestDY, guideX, guideY };
}
