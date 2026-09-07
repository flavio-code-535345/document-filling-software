"use client";

import { useEffect, useRef, useState } from "react";
import type { FieldKind, PageRotation, TemplateField } from "@/lib/types";
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
  | { mode: "resize"; id: string; startX: number; startY: number; orig: TemplateField }
  | { mode: "marquee"; startX: number; startY: number };

export default function PdfPageView({
  pdfUrl,
  pageIndex,
  pageSize,
  zoom,
  fields,
  selectedId,
  multiSelect,
  rotation = 0,
  activeTool,
  feintuning,
  feinCell,
  previewEnabled,
  sampleValues,
  onSelectField,
  onClearSelection,
  onMarqueeSelect,
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
  multiSelect: string[];
  rotation?: PageRotation;
  activeTool: ToolId | null;
  feintuning: string | null;
  feinCell: { row: number; col: number } | null;
  previewEnabled: boolean;
  sampleValues: PreviewValues;
  onSelectField: (id: string, additive: boolean) => void;
  onClearSelection: () => void;
  onMarqueeSelect: (ids: string[]) => void;
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
  const [marqueeRect, setMarqueeRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  const mediaW = pageSize.width;
  const mediaH = pageSize.height;
  const rotated = rotation === 90 || rotation === 270;
  const widthPx = mediaW * zoom;
  const heightPx = mediaH * zoom;
  const displayW = rotated ? heightPx : widthPx;
  const displayH = rotated ? widthPx : heightPx;

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

  // Map a screen point to media-box point coordinates, undoing the CSS rotation.
  const toPt = (e: { clientX: number; clientY: number }) => {
    const rect = containerRef.current!.getBoundingClientRect();
    const ox = (e.clientX - rect.left) / zoom;
    const oy = (e.clientY - rect.top) / zoom;
    const dx = ox - (rotated ? mediaH / 2 : mediaW / 2);
    const dy = oy - (rotated ? mediaW / 2 : mediaH / 2);
    let rx = dx;
    let ry = dy;
    if (rotation === 90) {
      rx = dy;
      ry = -dx;
    } else if (rotation === 180) {
      rx = -dx;
      ry = -dy;
    } else if (rotation === 270) {
      rx = -dy;
      ry = dx;
    }
    return { x: mediaW / 2 + rx, y: mediaH / 2 + ry };
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
      onSelectField(fieldId, e.shiftKey || e.metaKey || e.ctrlKey);
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

    // Empty background: start a marquee selection.
    onClearSelection();
    dragRef.current = { mode: "marquee", startX: pt.x, startY: pt.y };
    setMarqueeRect({ x: pt.x, y: pt.y, width: 0, height: 0 });
    e.preventDefault();
    containerRef.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (activeTool) {
      setCursor(toPt(e));
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

    if (drag.mode === "marquee") {
      const pt = toPt(e);
      setMarqueeRect({
        x: Math.min(drag.startX, pt.x),
        y: Math.min(drag.startY, pt.y),
        width: Math.abs(pt.x - drag.startX),
        height: Math.abs(pt.y - drag.startY),
      });
      return;
    }

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

    const drag = dragRef.current;
    if (drag?.mode === "marquee" && marqueeRect) {
      const rect = marqueeRect;
      const ids = fields
        .filter((f) => rectIntersects(f, rect))
        .map((f) => f.id);
      onMarqueeSelect(ids);
      setMarqueeRect(null);
      dragRef.current = null;
      setGuides({ x: null, y: null });
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
        style={{ width: displayW, height: displayH }}
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
        <div
          className="absolute"
          style={{
            left: "50%",
            top: "50%",
            width: widthPx,
            height: heightPx,
            transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
            transformOrigin: "center center",
          }}
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
            const isMulti = multiSelect.includes(f.id) && f.id !== selectedId;
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
                      f.id === selectedId
                        ? "#ffffff"
                        : isMulti
                          ? "#3b82f6"
                          : KIND_COLORS[f.kind]
                    }`,
                    outline:
                      f.id === selectedId || isMulti
                        ? `2px solid ${f.id === selectedId ? KIND_COLORS[f.kind] : "#3b82f6"}`
                        : "none",
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

          {/* Marquee selection rectangle */}
          {marqueeRect && (
            <div
              className="pointer-events-none absolute z-30 border border-dashed border-accent bg-accent/10"
              style={{
                left: marqueeRect.x * zoom,
                top: marqueeRect.y * zoom,
                width: marqueeRect.width * zoom,
                height: marqueeRect.height * zoom,
              }}
            />
          )}

          {/* Stamp cursor chip */}
          {activeTool && activeTool !== "ai-region" && cursor && (
            <div
              className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-strong px-2 py-0.5 text-xs font-semibold text-white"
              style={{ left: cursor.x * zoom, top: cursor.y * zoom }}
            >
              + {activeTool}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function rectIntersects(
  field: TemplateField,
  rect: { x: number; y: number; width: number; height: number }
): boolean {
  return !(
    field.x + field.width < rect.x ||
    field.x > rect.x + rect.width ||
    field.y + field.height < rect.y ||
    field.y > rect.y + rect.height
  );
}
