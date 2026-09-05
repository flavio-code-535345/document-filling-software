"use client";

// SVG drawing of one matrix field: cell positions (pitch + drift + offsets),
// selection marks, labels; optional cell-click handling for Feintuning mode.
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

  return (
    <svg
      viewBox={`${field.x - 2} ${field.y - 2} ${boxW + 4} ${boxH + 4}`}
      className="h-auto w-full"
      style={{ color: "#000000" }}
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
                  r={markSize / 2}
                  fill={isCell ? "#3b82f6" : "none"}
                  stroke={isCell ? "#3b82f6" : "#9ca3af"}
                  strokeWidth={0.75}
                  onClick={() => onCellClick?.(row, col)}
                  style={{ cursor: onCellClick ? "pointer" : undefined }}
                />
                {showCellCenters && (
                  <circle cx={cx} cy={cy} r={1} fill="#ef4444" />
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
                  >
                    X
                  </text>
                )}
              </g>
            );
          })}
          <text
            x={field.x - 6}
            y={field.y + pitchY * (row + 0.5)}
            fontSize={Math.min(9, pitchY * 0.6)}
            fill="#6b7280"
            textAnchor="end"
            dominantBaseline="central"
          >
            {label}
          </text>
        </g>
      ))}
      {cols.map((label, col) => {
        const { cx } = matrixCellCenter(field, 0, col);
        return (
          <text
            key={col}
            x={cx}
            y={field.y - 3}
            fontSize={Math.min(9, pitchX * 0.6)}
            fill="#6b7280"
            textAnchor="middle"
            dominantBaseline="auto"
          >
            {label}
          </text>
        );
      })}
    </svg>
  );
}
