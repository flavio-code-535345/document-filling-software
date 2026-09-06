"use client";

import { useEffect, useRef, useState } from "react";
import type { FieldKind, TemplateField } from "@/lib/types";
import { preparePageRender } from "@/lib/pdf/client";
import { snapAnchors } from "@/lib/geometry";
import MatrixGrid from "./MatrixGrid";
import PreviewSvg, { type PreviewValues } from "@/components/PreviewSvg";
import type { PageRegion, ToolId } from "./TemplateEditor";

const KIND_COLORS: Record<FieldKind, string> = {
  text: "#60a5fa",
  multiline: "#34d399",
  date: "#c084fc",
  checkbox: "#fbbf24",
  signature: "#f87171",
  matrix: "#f472b6",
};

type DragState =
  | { mode: "move"; id: string; startX: number; startY: number; orig: TemplateField }
  | { mode: "resize"; id: string; startX: number; startY: number; orig: TemplateField };

export default function PdfPageView({
  pdfUrl,
  pageIndex,
  pageSize,
  zoom,
  fields,
  selectedId,
  activeTool,
  feintuning,
  feinCell,
  previewEnabled,
  sampleValues,
  onSelect,
  onPageClick,
  onFieldChange,
  onDeleteField,
  onCopyField,
  onCancelTool,
  onRegionSelected,
  onCellClick,
}: {
  pdfUrl: string;
  pageIndex: number;
  pageSize: { width: number; height: number };
  zoom: number;
  fields: TemplateField[];
  selectedId: string | null;
  activeTool: ToolId | null;
  feintuning: string | null;
  feinCell: { row: number; col: number } | null;
  previewEnabled: boolean;
  sampleValues: PreviewValues;
  onSelect: (id: string | null) => void;
  onPageClick: (pt: { x: number; y: number }) => void;
  onFieldChange: (id: string, patch: Partial<TemplateField>) => void;
  onDeleteField: (id: string) => void;
  onCopyField: (id: string) => void;
  onCancelTool: () => void;
  onRegionSelected: (region: PageRegion) => void;
  onCellClick?: (fieldId: string, row: number, col: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const regionStartRef = useRef<{ x: number; y: number } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [regionRect, setRegionRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({
    x: null,
    y: null,
  });

  const widthPx = pageSize.width * zoom;
  const heightPx = pageSize.height * zoom;

  useEffect(() => {
    let cancelled = false;
    let currentTask: { promise: Promise<void>; cancel: () => void } | null = null;

    (async () => {
      try {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const prepared = await preparePageRender(pdfUrl, pageIndex, canvas, widthPx);
        if (cancelled) {
          prepared.task.cancel();
          return;
        }
        currentTask = prepared.task;
        await prepared.task.promise;
      } catch {
        /* cancelled or re-rendered */
      }
    })();

    return () => {
      cancelled = true;
      currentTask?.cancel();
    };
  }, [pdfUrl, pageIndex, widthPx]);

  const toPt = (e: { clientX: number; clientY: number }) => {
    const rect = containerRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / zoom,
      y: (e.clientY - rect.top) / zoom,
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return; // right click handled by contextmenu

    const pt = toPt(e);

    // KI-Bereich tool: drag a rectangle to scan only that region.
    if (activeTool === "ai-region") {
      regionStartRef.current = pt;
      setRegionRect({ x: pt.x, y: pt.y, width: 0, height: 0 });
      e.preventDefault();
      containerRef.current?.setPointerCapture(e.pointerId);
      return;
    }

    const target = e.target as HTMLElement;
    const handle = target.dataset.handle;
    const fieldEl = target.closest<HTMLElement>("[data-field-id]");
    const fieldId = fieldEl?.dataset.fieldId;

    if (fieldId && (handle || !activeTool)) {
      const field = fields.find((f) => f.id === fieldId);
      if (!field) return;
      onSelect(fieldId);
      dragRef.current = {
        mode: handle === "se" ? "resize" : "move",
        id: fieldId,
        startX: pt.x,
        startY: pt.y,
        orig: { ...field },
      };
      e.preventDefault();
      containerRef.current?.setPointerCapture(e.pointerId);
      return;
    }

    if (activeTool) {
      onPageClick({ x: Math.round(pt.x * 100) / 100, y: Math.round(pt.y * 100) / 100 });
      return;
    }

    onSelect(null);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (activeTool) {
      setCursor({ x: e.clientX, y: e.clientY });
    }

    if (activeTool === "ai-region" && regionStartRef.current) {
      const pt = toPt(e);
      const start = regionStartRef.current;
      setRegionRect({
        x: Math.min(start.x, pt.x),
        y: Math.min(start.y, pt.y),
        width: Math.abs(pt.x - start.x),
        height: Math.abs(pt.y - start.y),
      });
      return;
    }

    const drag = dragRef.current;
    if (!drag) return;

    const pt = toPt(e);
    const dx = pt.x - drag.startX;
    const dy = pt.y - drag.startY;
    const o = drag.orig;

    let next: TemplateField | null = null;

    if (drag.mode === "move") {
      const anchorsX = [o.x + dx, o.x + o.width / 2 + dx, o.x + o.width + dx];
      const anchorsY = [o.y + dy, o.y + o.height / 2 + dy, o.y + o.height + dy];
      const snap = snapAnchors(anchorsX, anchorsY, fields.filter((f) => f.id !== drag.id), drag.orig.page, drag.id, 2.5);
      next = {
        ...o,
        x: Math.round((o.x + dx + snap.dx) * 100) / 100,
        y: Math.round((o.y + dy + snap.dy) * 100) / 100,
      };
      setGuides({ x: snap.guideX, y: snap.guideY });
    } else {
      const w = Math.max(4, o.width + dx);
      const h = Math.max(4, o.height + dy);
      next = { ...o, width: Math.round(w * 10) / 10, height: Math.round(h * 10) / 10 };
      setGuides({ x: null, y: null });
    }

    if (next) {
      onFieldChange(drag.id, {
        x: next.x,
        y: next.y,
        width: next.width,
        height: next.height,
      });
    }
  };

  const endDrag = () => {
    // Finish a KI-Bereich selection.
    if (activeTool === "ai-region" && regionStartRef.current && regionRect) {
      const rect = regionRect;
      if (rect.width >= 6 && rect.height >= 6) {
        onRegionSelected({
          x: Math.round(rect.x * 100) / 100,
          y: Math.round(rect.y * 100) / 100,
          width: Math.round(rect.width * 100) / 100,
          height: Math.round(rect.height * 100) / 100,
        });
      }
      regionStartRef.current = null;
      setRegionRect(null);
      return;
    }
    dragRef.current = null;
    setGuides({ x: null, y: null });
  };

  return (
    <div>
      <div
        ref={containerRef}
        className="relative inline-block select-none"
        style={{ width: widthPx, height: heightPx }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onContextMenu={(e) => {
          e.preventDefault();
          onCancelTool();
        }}
        onMouseLeave={() => setCursor(null)}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0"
          style={{ width: widthPx, height: heightPx }}
        />

        {/* Live preview overlay (sample values, transparent over the PDF) */}
        {previewEnabled && (
          <div className="pointer-events-none absolute inset-0">
            <PreviewSvg
              pageWidth={pageSize.width}
              pageHeight={pageSize.height}
              fields={fields}
              values={sampleValues}
              className="h-full w-full"
              transparent
            />
          </div>
        )}

        {/* Field boxes */}
        {fields.map((f) => {
          const box =
            f.kind === "matrix"
              ? {
                  width: (f.matrixCols?.length ?? 0) * (f.matrixCellWidth ?? 20),
                  height: (f.matrixRows?.length ?? 0) * (f.matrixCellHeight ?? 20),
                }
              : { width: f.width, height: f.height };
          const displayX = f.x * zoom;
          const displayY = f.y * zoom;
          return (
          <div
            key={f.id}
            data-field-id={f.id}
            className="absolute"
            style={{
              left: displayX,
              top: displayY,
              width: box.width * zoom,
              height: box.height * zoom,
            }}
          >
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                border: `${Math.max(1, f.id === selectedId ? 2 : 1)}px solid ${
                  f.id === selectedId ? "#ffffff" : KIND_COLORS[f.kind]
                }`,
                outline: f.id === selectedId ? `2px solid ${KIND_COLORS[f.kind]}` : "none",
                outlineOffset: 1,
              }}
            />
            <span
              className="pointer-events-none absolute"
              style={{
                top: -18,
                left: -1,
                fontSize: Math.max(10, 12 * Math.min(1.2, zoom)),
                background: KIND_COLORS[f.kind],
                color: "#0b1220",
                padding: "1px 5px",
                borderRadius: 4,
                whiteSpace: "nowrap",
                fontWeight: 600,
              }}
            >
              {f.label || "?"}
            </span>

            {f.kind === "matrix" && feintuning === f.id ? (
              <div className="absolute inset-0 overflow-visible">
                <MatrixGrid
                  field={f}
                  selectedCell={feinCell}
                  showCellCenters
                  onCellClick={(row, col) => onCellClick?.(f.id, row, col)}
                />
              </div>
            ) : f.kind === "matrix" ? (
              <div className="pointer-events-none absolute inset-0">
                <MatrixGrid field={f} />
              </div>
            ) : null}

            {f.id === selectedId && (
              <>
                <span
                  data-handle="se"
                  className="absolute"
                  style={{
                    right: -6,
                    bottom: -6,
                    width: 12,
                    height: 12,
                    background: "#ffffff",
                    border: `2px solid ${KIND_COLORS[f.kind]}`,
                    borderRadius: "50%",
                    cursor: "nwse-resize",
                    zIndex: 10,
                  }}
                />
                <div
                  className="absolute flex gap-1 pb-6"
                  style={{ top: -40, right: 0, zIndex: 10 }}
                >
                  <button
                    title="Duplizieren"
                    className="pointer-events-auto rounded bg-surface px-1.5 text-xs text-ink"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onCopyField(f.id);
                    }}
                  >
                    ⧉
                  </button>
                  <button
                    title="Löschen"
                    className="pointer-events-auto rounded bg-surface px-1.5 text-xs text-red-400"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteField(f.id);
                    }}
                  >
                    ✕
                  </button>
                </div>
              </>
            )}
          </div>
          );
        })}

        {/* Snap guides */}
        {guides.x !== null && (
          <div
            className="pointer-events-none absolute"
            style={{
              left: guides.x * zoom,
              top: 0,
              bottom: 0,
              width: 1,
              background: "#f472b6",
              zIndex: 20,
            }}
          />
        )}
        {guides.y !== null && (
          <div
            className="pointer-events-none absolute"
            style={{
              top: guides.y * zoom,
              left: 0,
              right: 0,
              height: 1,
              background: "#f472b6",
              zIndex: 20,
            }}
          />
        )}

        {/* KI-Bereich drag rectangle */}
        {regionRect && activeTool === "ai-region" && (
          <div
            className="pointer-events-none absolute z-30 border-2 border-dashed border-accent bg-accent/10"
            style={{
              left: regionRect.x * zoom,
              top: regionRect.y * zoom,
              width: regionRect.width * zoom,
              height: regionRect.height * zoom,
            }}
          />
        )}

        {/* Stamp cursor chip */}
        {activeTool && activeTool !== "ai-region" && cursor && (
          <div
            className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-strong px-2 py-0.5 text-xs font-semibold text-white"
            style={{ left: cursor.x, top: cursor.y }}
          >
            + {activeTool}
          </div>
        )}
      </div>
    </div>
  );
}
