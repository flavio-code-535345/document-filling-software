"use client";

// SVG drawing of one matrix field: cell positions (pitch + drift + offsets),
// selection marks, labels; optional cell-click handling for Feintuning mode.
// viewBox maps EXACTLY onto the field box (no padding) with
// preserveAspectRatio="none", so cells align pixel-perfect with the editor
// overlay and the fill form (parent sizes the SVG to boxW×boxH).
import { matrixCellCenter, matrixBoxSize, matrixMarkSize } from "@/lib/geometry";
import type { TemplateField } from "@/lib/types";

export type MatrixSelection = Record<string, boolean>;

export default function MatrixGrid({
  field,
  selection = {},
  showCellCenters = false,
  selectedCell,
  onCellClick,
}: {
  field: TemplateField;
  selection?: MatrixSelection;
  showCellCenters?: boolean;
  selectedCell?: { row: number; col: number } | null;
  onCellClick?: (row: number, col: number) => void;
}) {
  const rows = field.matrixRows ?? [];
  const cols = field.matrixCols ?? [];
  const { width: boxW, height: boxH } = matrixBoxSize(field);
  const pitchX = field.matrixCellWidth ?? 20;
  const pitchY = field.matrixCellHeight ?? 20;
  const markSize = matrixMarkSize(field);
  // Generous invisible hit target around each cell center.
  const hitR = Math.max(10, Math.min(pitchX, pitchY) / 2);
  const visualR = Math.min(5, markSize / 3);

  return (
    <svg
      viewBox={`${field.x} ${field.y} ${boxW} ${boxH}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height: "100%", display: "block", color: "#000000" }}
    >
      <rect
        x={field.x}
        y={field.y}
        width={boxW}
        height={boxH}
        fill="none"
        stroke="#3b82f6"
        strokeWidth={1}
      />

      {rows.map((label, row) => (
        <g key={row}>
          {cols.map((_c, col) => {
            const { cx, cy } = matrixCellCenter(field, row, col);
            const isSelected = Boolean(selection[`${row}:${col}`]);
            const isCell = selectedCell?.row === row && selectedCell?.col === col;
            return (
              <g key={col}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={hitR}
                  fill="transparent"
                  onPointerDown={(e) => {
                    // In the editor, a cell click must not start dragging the field.
                    if (onCellClick) e.stopPropagation();
                  }}
                  onClick={() => onCellClick?.(row, col)}
                  style={{ cursor: onCellClick ? "pointer" : undefined }}
                />
                <circle
                  cx={cx}
                  cy={cy}
                  r={visualR}
                  fill={isCell ? "#3b82f6" : "none"}
                  stroke={isCell ? "#3b82f6" : "#9ca3af"}
                  strokeWidth={0.75}
                  pointerEvents="none"
                />
                {showCellCenters && (
                  <circle cx={cx} cy={cy} r={1} fill="#ef4444" pointerEvents="none" />
                )}
                {isSelected && (
                  <text
                    x={cx}
                    y={cy}
                    fontSize={markSize}
                    fontWeight="bold"
                    fontFamily="Helvetica, Arial, sans-serif"
                    fill="#000000"
                    textAnchor="middle"
                    dominantBaseline="central"
                    pointerEvents="none"
                  >
                    X
                  </text>
                )}
              </g>
            );
          })}
        </g>
      ))}

      {/* Row labels along the left edge, column labels along the top edge */}
      {rows.map((label, row) => {
        const { cy } = matrixCellCenter(field, row, 0);
        return (
          <text
            key={`r${row}`}
            x={field.x + 2}
            y={cy}
            fontSize={Math.min(8, pitchY * 0.5)}
            fill="#6b7280"
            dominantBaseline="central"
            pointerEvents="none"
          >
            {label}
          </text>
        );
      })}
      {cols.map((label, col) => {
        const { cx } = matrixCellCenter(field, 0, col);
        return (
          <text
            key={`c${col}`}
            x={cx}
            y={field.y + 8}
            fontSize={Math.min(8, pitchX * 0.5)}
            fill="#6b7280"
            textAnchor="middle"
            pointerEvents="none"
          >
            {label}
          </text>
        );
      })}
    </svg>
  );
}
