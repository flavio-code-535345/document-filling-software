"use client";

// Inline-SVG preview of a page with sample values, replicating the server's
// pdf-lib placement math exactly (baseline positioning ≈ Helvetica).
import { wrapClient } from "@/lib/pdf/client";
import {
  baselineFromTop,
  formatGermanDate,
  matrixCellCenter,
  matrixMarkSize,
} from "@/lib/geometry";
import type { TemplateField } from "@/lib/types";

export interface PreviewValues {
  [fieldId: string]: string | boolean | Record<string, boolean> | undefined;
}

export default function PreviewSvg({
  pageWidth,
  pageHeight,
  fields,
  values,
  selectedId,
  className,
}: {
  pageWidth: number;
  pageHeight: number;
  fields: TemplateField[];
  values: PreviewValues;
  selectedId?: string | null;
  className?: string;
}) {
  return (
    <svg
      viewBox={`0 0 ${pageWidth} ${pageHeight}`}
      className={className ?? "h-auto w-full"}
      style={{ background: "#ffffff", color: "#000000" }}
    >
      {fields.map((f) =>
        f.id === selectedId ? (
          <g key={f.id}>
            {renderField(f, values[f.id])}
            <rect
              x={f.x}
              y={f.y}
              width={f.width}
              height={f.height}
              fill="none"
              stroke="#3b82f6"
              strokeWidth={1}
            />
          </g>
        ) : (
          <g key={f.id}>{renderField(f, values[f.id])}</g>
        )
      )}
    </svg>
  );
}

function renderField(
  field: TemplateField,
  value: string | boolean | Record<string, boolean> | undefined
): React.ReactNode {
  switch (field.kind) {
    case "text":
    case "date": {
      const raw = typeof value === "string" && value.trim() ? value : "";
      if (!raw) return null;
      const text = field.kind === "date" ? formatGermanDate(raw) : raw;
      return (
        <text
          x={field.x}
          y={field.y + baselineFromTop(field)}
          fontSize={field.fontSize}
          fontFamily="Helvetica, Arial, sans-serif"
          fill="#000000"
        >
          {text}
        </text>
      );
    }
    case "multiline": {
      const raw = typeof value === "string" && value.trim() ? value : "";
      if (!raw) return null;
      const lines = wrapClient(raw, field.width, field.fontSize);
      const lineHeight = field.fontSize * 1.3;
      return (
        <g>
          {lines.map((line, i) => {
            const baselineTop = baselineFromTop(field) + i * lineHeight;
            if (baselineTop + field.fontSize * 0.72 > field.height) return null;
            return (
              <text
                key={i}
                x={field.x}
                y={field.y + baselineTop}
                fontSize={field.fontSize}
                fontFamily="Helvetica, Arial, sans-serif"
                fill="#000000"
              >
                {line}
              </text>
            );
          })}
        </g>
      );
    }
    case "checkbox": {
      const truthy =
        value === true || value === "true" || value === "1" || value === "on";
      if (!truthy) return null;
      const size = Math.min(field.width, field.height) * 0.8;
      return (
        <text
          x={field.x + field.width / 2}
          y={field.y + field.height / 2}
          fontSize={size}
          fontWeight="bold"
          fontFamily="Helvetica, Arial, sans-serif"
          fill="#000000"
          textAnchor="middle"
          dominantBaseline="central"
        >
          X
        </text>
      );
    }
    case "signature": {
      if (typeof value !== "string" || !value.startsWith("data:image/png;base64,")) {
        return null;
      }
      return (
        <image
          href={value}
          x={field.x}
          y={field.y}
          width={field.width}
          height={field.height}
          preserveAspectRatio="none"
        />
      );
    }
    case "matrix": {
      const selection =
        typeof value === "object" && value ? (value as Record<string, boolean>) : {};
      const markSize = matrixMarkSize(field);
      return (
        <g>
          {(field.matrixRows ?? []).map((_r, row) => (
            <g key={row}>
              {(field.matrixCols ?? []).map((_c, col) => {
                if (!selection[`${row}:${col}`]) return null;
                const { cx, cy } = matrixCellCenter(field, row, col);
                return (
                  <text
                    key={col}
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
                );
              })}
            </g>
          ))}
        </g>
      );
    }
    default:
      return null;
  }
}
