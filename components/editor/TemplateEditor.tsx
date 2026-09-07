"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FieldKind, PageRotation, StoredTemplate, TemplateField, TextAlign } from "@/lib/types";
import {
  alignFields,
  createField,
  copyField,
  distributeFields,
  newFieldId,
  clampPageIndex,
} from "@/lib/editor-utils";
import { matrixCellCenter } from "@/lib/geometry";
import PdfPageView from "./PdfPageView";
import Inspector from "./Inspector";
import FieldListPanel from "./FieldListPanel";
import AlignToolbar from "./AlignToolbar";
import type { PreviewValues } from "@/components/PreviewSvg";

const TOOLS: { kind: FieldKind; label: string; icon: string }[] = [
  { kind: "text", label: "Text", icon: "T" },
  { kind: "multiline", label: "Mehrzeilig", icon: "≡" },
  { kind: "date", label: "Datum", icon: "📅" },
  { kind: "checkbox", label: "Kästchen", icon: "☐" },
  { kind: "signature", label: "Unterschrift", icon: "✍" },
  { kind: "matrix", label: "Matrix", icon: "▦" },
];

export type ToolId = FieldKind | "ai-region";

export interface PageRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

function roundZoom(z: number): number {
  return Math.round(z * 100) / 100;
}

const ZOOM_IN_FACTOR = 1.25;
const ZOOM_OUT_FACTOR = 1 / ZOOM_IN_FACTOR;
const ZOOM_WHEEL_FACTOR = 1.1;

export default function TemplateEditor({ template }: { template: StoredTemplate }) {
  const router = useRouter();
  const templateRef = useRef(template);
  const stageRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(1);

  const [fields, setFields] = useState<TemplateField[]>(template.fields);
  const [pageCount, setPageCount] = useState(template.pageCount);
  const [pageSizes, setPageSizes] = useState(template.pageSizes);
  const [pageRotations, setPageRotations] = useState<PageRotation[]>(
    template.pageRotations ?? Array.from({ length: template.pageCount }, () => 0)
  );
  const [pageIndex, setPageIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [activeTool, setActiveTool] = useState<ToolId | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [multiSelect, setMultiSelect] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(template.updatedAt);
  const [showPanel, setShowPanel] = useState(false);
  const [showMultiPanel, setShowMultiPanel] = useState(false);
  const [previewEnabled, setPreviewEnabled] = useState(false);
  const [sampleText, setSampleText] = useState("Mustertext");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiScanning, setAiScanning] = useState(false);
  const [aiMessage, setAiMessage] = useState<string | null>(null);

  // Matrix two-click stamping
  const [pendingMatrix, setPendingMatrix] = useState<{
    fieldId: string;
    origin: { x: number; y: number };
  } | null>(null);

  // 🎯 Feintuning: fieldId + selected cell
  const [feintuning, setFeintuning] = useState<string | null>(null);
  const [feinCell, setFeinCell] = useState<{ row: number; col: number } | null>(null);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // Ctrl/Cmd + scrollwheel zoom, anchored at the cursor (native listener:
  // React wheel handlers are passive and cannot preventDefault).
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? ZOOM_WHEEL_FACTOR : 1 / ZOOM_WHEEL_FACTOR;
      const next = clampZoom(zoomRef.current * factor);
      if (next === zoomRef.current) return;
      const ratio = next / zoomRef.current;
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      el.scrollLeft = (el.scrollLeft + cx) * ratio - cx;
      el.scrollTop = (el.scrollTop + cy) * ratio - cy;
      setZoom(roundZoom(next));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Fit the current page width into the visible stage.
  const fitWidth = () => {
    const el = stageRef.current;
    if (!el) return;
    const pageWidth = pageSizes[pageIndex]?.width ?? 612;
    const available = Math.max(160, el.clientWidth - 48); // stage p-6 padding
    setZoom(roundZoom(clampZoom(available / pageWidth)));
  };

  const pdfUrl = `/api/templates/${template.id}/pdf?v=${encodeURIComponent(savedAt ?? "0")}`;

  const selected = useMemo(
    () => fields.find((f) => f.id === selectedId) ?? null,
    [fields, selectedId]
  );

  const updateField = useCallback((id: string, patch: Partial<TemplateField>) => {
    setFields((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)));
    setDirty(true);
  }, []);

  const deleteField = useCallback((id: string) => {
    setFields((fs) => fs.filter((f) => f.id !== id));
    setSelectedId((s) => (s === id ? null : s));
    setDirty(true);
  }, []);

  // ---- multi-select + bulk edit ----
  const handleSelect = useCallback((id: string | null) => {
    setSelectedId(id);
    setMultiSelect([]);
  }, []);

  const toggleMulti = useCallback((id: string, additive: boolean) => {
    setMultiSelect((ms) => {
      if (!additive) return [id];
      return ms.includes(id) ? ms.filter((x) => x !== id) : [...ms, id];
    });
    setSelectedId(id);
  }, []);

  const marqueeSelect = useCallback((ids: string[]) => {
    setMultiSelect(ids);
    setSelectedId(ids.length > 0 ? ids[ids.length - 1] : null);
  }, []);

  const clearMulti = useCallback(() => setMultiSelect([]), []);

  // ---- group alignment / distribution ----
  const alignSelected = useCallback(
    (op: "left" | "right" | "top" | "bottom") => {
      setFields((fs) => alignFields(fs, multiSelect, op));
      setDirty(true);
    },
    [multiSelect]
  );

  const distributeSelected = useCallback(
    (axis: "x" | "y") => {
      setFields((fs) => distributeFields(fs, multiSelect, axis));
      setDirty(true);
    },
    [multiSelect]
  );

  // ---- duplication (single or group) ----
  const duplicateSelection = useCallback(() => {
    const ids = multiSelect.length >= 2 ? multiSelect : selectedId ? [selectedId] : [];
    if (ids.length === 0) return;
    const copies = ids
      .map((id) => fields.find((f) => f.id === id))
      .filter((f): f is TemplateField => Boolean(f))
      .map((f) => copyField(f, fields));
    if (copies.length === 0) return;
    setFields((fs) => [...fs, ...copies]);
    setMultiSelect(copies.map((c) => c.id));
    setSelectedId(copies[copies.length - 1].id);
    setDirty(true);
  }, [fields, multiSelect, selectedId]);

  const applyBulk = useCallback(
    (patch: Partial<TemplateField>) => {
      if (multiSelect.length < 2) return;
      setFields((fs) =>
        fs.map((f) => (multiSelect.includes(f.id) ? { ...f, ...patch } : f))
      );
      setDirty(true);
    },
    [multiSelect]
  );

  // Bulk tagging: match a dimension of every multi-selected field to the
  // anchor field (the last one clicked, i.e. `selected`).
  const matchDimension = useCallback(
    (dim: "width" | "height" | "fontSize" | "x" | "y") => {
      if (!selected) return;
      applyBulk({ [dim]: selected[dim] } as Partial<TemplateField>);
    },
    [selected, applyBulk]
  );

  const setBulkAlign = useCallback(
    (align: TextAlign) => {
      applyBulk({ align });
    },
    [applyBulk]
  );

  // ---- stamping ----
  const handlePageClick = useCallback(
    (pt: { x: number; y: number }) => {
      if (!activeTool || activeTool === "ai-region") return;
      if (activeTool === "matrix") {
        if (pendingMatrix) {
          // second click: bottom-right cell center → pitch
          const dx = (pt.x - pendingMatrix.origin.x) / 2; // default 3 cols
          const dy = (pt.y - pendingMatrix.origin.y) / 2; // default 3 rows
          updateField(pendingMatrix.fieldId, {
            matrixCellWidth: Math.max(6, Math.round(dx)),
            matrixCellHeight: Math.max(6, Math.round(dy)),
          });
          setSelectedId(pendingMatrix.fieldId);
          setPendingMatrix(null);
          setActiveTool(null);
          return;
        }
        const field = createField(
          "matrix",
          pageIndex,
          pt.x,
          pt.y,
          fields,
          11
        );
        setFields((fs) => [...fs, field]);
        setPendingMatrix({ fieldId: field.id, origin: pt });
        setDirty(true);
        return;
      }
      const field = createField(activeTool, pageIndex, pt.x, pt.y, fields, 11);
      setFields((fs) => [...fs, field]);
      setSelectedId(field.id);
      setActiveTool(null);
      setDirty(true);
    },
    [activeTool, pendingMatrix, pageIndex, fields, updateField]
  );

  const cancelTool = useCallback(() => {
    setActiveTool(null);
    setPendingMatrix(null);
  }, []);

  // ---- keyboard shortcuts ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;

      if (e.key === "Escape") {
        cancelTool();
        setMultiSelect([]);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && selectedId) {
        e.preventDefault();
        const f = fields.find((x) => x.id === selectedId);
        if (f) {
          const copy = copyField(f, fields);
          setFields((fs) => [...fs, copy]);
          setSelectedId(copy.id);
          setDirty(true);
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
        // copy handled via ctrl+c; paste re-adds one more copy is confusing — ignored.
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateSelection();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        if (multiSelect.length >= 2) {
          setFields((fs) => fs.filter((f) => !multiSelect.includes(f.id)));
          setMultiSelect([]);
          setSelectedId(null);
        } else if (selectedId) {
          deleteField(selectedId);
        }
        return;
      }
      if (!selectedId) return;

      const step = e.shiftKey ? 5 : 1;
      const delta =
        e.key === "ArrowLeft" ? { x: -step } :
        e.key === "ArrowRight" ? { x: step } :
        e.key === "ArrowUp" ? { y: -step } :
        e.key === "ArrowDown" ? { y: step } :
        null;
      if (!delta) return;
      e.preventDefault();

      const f = fields.find((x) => x.id === selectedId);
      if (!f) return;

      // 🎯 Feintuning: arrows adjust a matrix cell's offsets (0.25pt steps, Alt = row)
      if (feintuning === f.id && f.kind === "matrix" && feinCell) {
        const stepF = 0.25;
        const dx = e.key === "ArrowLeft" ? -stepF : e.key === "ArrowRight" ? stepF : 0;
        const dy = e.key === "ArrowUp" ? -stepF : e.key === "ArrowDown" ? stepF : 0;
        const { row, col } = feinCell;
        const patch: Partial<TemplateField> = {};
        if (e.altKey) {
          if (dx) patch.matrixRowDx = bump(f.matrixRowDx, row, dx);
          if (dy) patch.matrixRowDy = bump(f.matrixRowDy, row, dy);
        } else {
          if (dx) patch.matrixColDx = bump(f.matrixColDx, col, dx);
          if (dy) patch.matrixColDy = bump(f.matrixColDy, col, dy);
        }
        updateField(f.id, patch);
        return;
      }

      updateField(f.id, {
        x: Math.round((f.x + (delta.x ?? 0)) * 100) / 100,
        y: Math.round((f.y + (delta.y ?? 0)) * 100) / 100,
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, fields, multiSelect, feintuning, feinCell, deleteField, updateField, cancelTool, duplicateSelection]);

  // ---- page rotation ----
  const setPageRotation = useCallback((page: number, rot: PageRotation) => {
    setPageRotations((rs) => {
      const next = [...rs];
      next[page] = rot;
      return next;
    });
    setDirty(true);
  }, []);

  // ---- save / discard ----
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/templates/${template.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields, pageRotations }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Speichern fehlgeschlagen.");
      const updated = data.template;
      setSavedAt(updated.updatedAt);
      templateRef.current = updated;
      setPageCount(updated.pageCount);
      setPageSizes(updated.pageSizes);
      setPageRotations(updated.pageRotations ?? pageRotations);
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Speichern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    const res = await fetch(`/api/templates/${template.id}`, { cache: "no-store" });
    const data = await res.json();
    setFields(data.template.fields ?? []);
    setPageRotations(
      data.template.pageRotations ?? Array.from({ length: data.template.pageCount }, () => 0)
    );
    setDirty(false);
    setSelectedId(null);
    setActiveTool(null);
    setPendingMatrix(null);
    setFeintuning(null);
    setMultiSelect([]);
  };

  // ---- KI-Scan: Gemini erkennt Felder und legt sie automatisch an ----
  const aiScan = async (region?: PageRegion) => {
    setAiScanning(true);
    setAiMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/templates/${template.id}/autodetect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          autoAdd: true,
          region: region ? { page: pageIndex, ...region } : undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "KI-Scan fehlgeschlagen.");
      setFields((fs) => [...fs, ...data.fields]);
      setDirty(true);
      setAiMessage(
        data.added > 0
          ? `✨ KI hat ${data.added} Feld${data.added === 1 ? "" : "er"} ${region ? "im markierten Bereich " : ""}erkannt und hinzugefügt — bitte prüfen und speichern.`
          : "KI hat keine Felder erkannt."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "KI-Scan fehlgeschlagen.");
    } finally {
      setAiScanning(false);
    }
  };

  // ---- PDF ersetzen ----
  const replacePdf = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("pdf", file);
      const res = await fetch(`/api/templates/${template.id}/pdf`, { method: "POST", body: fd });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Ersetzen fehlgeschlagen.");
      const updated = data.template;
      templateRef.current = updated;
      setPageCount(updated.pageCount);
      setPageSizes(updated.pageSizes);
      setPageRotations(updated.pageRotations ?? Array.from({ length: updated.pageCount }, () => 0));
      setSavedAt(updated.updatedAt);
      setFields(updated.fields);
      setDirty(false);
      setPageIndex(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ersetzen fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  // ---- sample values for live preview ----
  const sampleValues: PreviewValues = useMemo(() => {
    const vals: PreviewValues = {};
    for (const f of fields) {
      if (!f.id) continue;
      if (f.kind === "text") vals[f.id] = sampleText || "Text";
      else if (f.kind === "multiline") vals[f.id] = sampleText || "Mehrzeiliger Text";
      else if (f.kind === "date") vals[f.id] = "2026-01-31";
      else if (f.kind === "checkbox") vals[f.id] = true;
      else if (f.kind === "matrix") {
        const sel: Record<string, boolean> = {};
        (f.matrixRows ?? []).forEach((_r, row) => {
          (f.matrixCols ?? []).forEach((_c, col) => {
            sel[`${row}:${col}`] = (row + col) % 2 === 0;
          });
        });
        vals[f.id] = sel;
      }
    }
    return vals;
  }, [fields, sampleText]);

  const pageSize = pageSizes[pageIndex] ?? { width: 612, height: 792 };
  const thisPageFields = fields.filter((f) => f.page === pageIndex);
  const pageFieldsForPreview = pageCount > 0 ? thisPageFields : [];

  return (
    <div>
      {/* Sticky toolbar BELOW the app navbar (top-16) */}
      <div className="sticky top-16 z-30 -mx-4 mb-4 border-b border-line bg-canvas/95 px-4 py-2 backdrop-blur">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
          <ToolGroup label="Vorlage">
            <Link
              href="/admin"
              className="rounded-md px-2.5 py-1 text-sm text-ink-dim hover:bg-surface-2 hover:text-ink"
            >
              ← Vorlagen
            </Link>
            <span className="max-w-52 truncate px-2 py-1 text-sm font-medium">
              {template.name}
            </span>
          </ToolGroup>

          <ToolGroup label="Werkzeuge">
            {TOOLS.map((t) => (
              <button
                key={t.kind}
                title={t.label}
                className={`rounded-md px-2.5 py-1 text-sm transition-colors ${
                  activeTool === t.kind
                    ? "bg-accent/25 text-ink"
                    : "text-ink-dim hover:bg-surface-2 hover:text-ink"
                }`}
                onClick={() => {
                  setActiveTool(activeTool === t.kind ? null : t.kind);
                  setPendingMatrix(null);
                }}
              >
                <span className="mr-1">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </ToolGroup>

          <ToolGroup label="Ansicht">
            <button
              className={`rounded-md px-2.5 py-1 text-sm transition-colors ${
                showPanel ? "bg-accent/25 text-ink" : "text-ink-dim hover:bg-surface-2 hover:text-ink"
              }`}
              onClick={() => setShowPanel((s) => !s)}
            >
              Felder
            </button>
            <button
              className={`rounded-md px-2.5 py-1 text-sm transition-colors ${
                showMultiPanel ? "bg-accent/25 text-ink" : "text-ink-dim hover:bg-surface-2 hover:text-ink"
              }`}
              onClick={() => setShowMultiPanel((s) => !s)}
            >
              Massen-Tagging
            </button>
            <button
              className={`rounded-md px-2.5 py-1 text-sm transition-colors ${
                previewEnabled ? "bg-accent/25 text-ink" : "text-ink-dim hover:bg-surface-2 hover:text-ink"
              }`}
              onClick={() => setPreviewEnabled((p) => !p)}
            >
              Vorschau
            </button>
            {previewEnabled && (
              <input
                value={sampleText}
                onChange={(e) => setSampleText(e.target.value)}
                placeholder="Mustertext"
                className="w-28 rounded-md border border-line bg-canvas px-2 py-1 text-sm"
              />
            )}
          </ToolGroup>

          <ToolGroup label="KI">
            <button
              title="Erkennt leere Felder im Dokument per KI und legt sie automatisch an"
              className="rounded-md px-2.5 py-1 text-sm text-ink-dim hover:bg-surface-2 hover:text-ink"
              disabled={busy || aiScanning}
              onClick={() => void aiScan()}
            >
              {aiScanning ? "Scannt…" : "KI-Scan ✨"}
            </button>
            <button
              title="Bereich auf der Seite ziehen — KI scannt nur diesen Ausschnitt"
              className={`rounded-md px-2.5 py-1 text-sm transition-colors ${
                activeTool === "ai-region"
                  ? "bg-accent/25 text-ink"
                  : "text-ink-dim hover:bg-surface-2 hover:text-ink"
              }`}
              disabled={busy || aiScanning}
              onClick={() => {
                setActiveTool(activeTool === "ai-region" ? null : "ai-region");
                setPendingMatrix(null);
              }}
            >
              🔍 KI-Bereich
            </button>
          </ToolGroup>

          <ToolGroup label="Zoom">
            <button
              className="rounded-md px-2 py-1 text-sm text-ink-dim hover:bg-surface-2 hover:text-ink"
              title="Verkleinern"
              disabled={zoom <= MIN_ZOOM}
              onClick={() => setZoom((z) => roundZoom(clampZoom(z * ZOOM_OUT_FACTOR)))}
            >
              −
            </button>
            <button
              className="w-14 rounded-md px-1 py-1 text-center text-sm tabular-nums text-ink-dim hover:bg-surface-2 hover:text-ink"
              title="Auf 100% zurücksetzen"
              onClick={() => setZoom(1)}
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              className="rounded-md px-2 py-1 text-sm text-ink-dim hover:bg-surface-2 hover:text-ink"
              title="Vergrößern"
              disabled={zoom >= MAX_ZOOM}
              onClick={() => setZoom((z) => roundZoom(clampZoom(z * ZOOM_IN_FACTOR)))}
            >
              +
            </button>
            <button
              className="rounded-md px-2.5 py-1 text-sm text-ink-dim hover:bg-surface-2 hover:text-ink"
              title="An Seitenbreite anpassen"
              onClick={fitWidth}
            >
              ⤢ Fit
            </button>
          </ToolGroup>

          <ToolGroup label="Seite drehen">
            {([0, 90, 180, 270] as PageRotation[]).map((r) => (
              <button
                key={r}
                className={`rounded-md px-2 py-1 text-sm transition-colors ${
                  (pageRotations[pageIndex] ?? 0) === r
                    ? "bg-accent/25 text-ink"
                    : "text-ink-dim hover:bg-surface-2 hover:text-ink"
                }`}
                title={`Seite ${pageIndex + 1} um ${r}° drehen`}
                onClick={() => setPageRotation(pageIndex, r)}
              >
                {r}°
              </button>
            ))}
          </ToolGroup>

          <div className="ml-auto flex flex-col items-end gap-1">
            <span className="px-1 text-[10px] font-semibold uppercase tracking-wider text-ink-dim">
              Datei
            </span>
            <div className="flex items-center gap-1 rounded-lg border border-line bg-surface/60 p-1">
              <label className="cursor-pointer rounded-md px-2.5 py-1 text-sm text-ink-dim hover:bg-surface-2 hover:text-ink">
                PDF ersetzen
                <input
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  disabled={dirty || busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) replacePdf(f);
                    e.target.value = "";
                  }}
                />
              </label>
              <span className="mx-1 h-4 border-l border-line" />
              <span className="px-2 text-xs text-ink-dim">
                {dirty ? "Ungespeichert" : savedAt ? "Gespeichert" : ""}
              </span>
              <button
                className="rounded-md px-2.5 py-1 text-sm text-ink-dim hover:bg-surface-2 hover:text-ink"
                disabled={!dirty || busy}
                onClick={discard}
              >
                Verwerfen
              </button>
              <button
                className="rounded-md bg-accent-strong px-3 py-1 text-sm font-semibold text-white"
                disabled={!dirty || busy}
                onClick={save}
              >
                {busy ? "Speichert…" : "Speichern"}
              </button>
            </div>
          </div>
        </div>
        {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
        {aiMessage && <p className="mt-1 text-sm text-green-400">{aiMessage}</p>}
      </div>

      {/* Stage */}
      <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <div
            ref={stageRef}
            className="flex justify-center overflow-auto rounded-xl border border-line bg-surface-2/50 p-6"
          >
            {pendingMatrix && (
              <p className="mb-2 rounded-lg border border-accent bg-accent/10 px-3 py-1 text-sm">
                Zweiten Klick setzen: unterste rechte Zelle (Ursprung + Rastermaß)
              </p>
            )}
            <PdfPageView
              pdfUrl={pdfUrl}
              pageIndex={pageIndex}
              pageSize={pageSize}
              zoom={zoom}
              fields={pageFieldsForPreview}
              selectedId={selectedId}
              multiSelect={multiSelect}
              rotation={pageRotations[pageIndex] ?? 0}
              activeTool={activeTool}
              feintuning={feintuning}
              feinCell={feinCell}
              previewEnabled={previewEnabled}
              sampleValues={sampleValues}
              onSelectField={(id, additive) => {
                if (additive) toggleMulti(id, true);
                else handleSelect(id);
              }}
              onClearSelection={() => handleSelect(null)}
              onMarqueeSelect={marqueeSelect}
              onPageClick={handlePageClick}
              onFieldChange={updateField}
              onDeleteField={deleteField}
              onCopyField={(id) => {
                const f = fields.find((x) => x.id === id);
                if (!f) return;
                const copy = copyField(f, fields);
                setFields((fs) => [...fs, copy]);
                setSelectedId(copy.id);
                setDirty(true);
              }}
              onCancelTool={cancelTool}
              onRegionSelected={(region) => void aiScan(region)}
              onCellClick={(fieldId, row, col) => {
                setFeinCell({ row, col });
                setFeintuning(fieldId);
              }}
            />
          </div>

          {/* Pager */}
          {pageCount > 1 && (
            <div className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-line bg-surface px-4 py-2 shadow-xl">
              <button
                className="text-sm hover:text-accent"
                disabled={pageIndex === 0}
                onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
              >
                ◀
              </button>
              <span className="text-sm">
                Seite {pageIndex + 1} / {pageCount}
              </span>
              <button
                className="text-sm hover:text-accent"
                disabled={pageIndex >= pageCount - 1}
                onClick={() => setPageIndex((p) => Math.min(pageCount - 1, p + 1))}
              >
                ▶
              </button>
            </div>
          )}
        </div>

        {showPanel && (
          <FieldListPanel
            fields={fields}
            pageCount={pageCount}
            currentPage={pageIndex}
            selectedId={selectedId}
            onSelect={(id) => handleSelect(id)}
            onSelectAndJump={(id, page) => {
              handleSelect(id);
              setPageIndex(clampPageIndex(page, pageCount));
            }}
            onDelete={deleteField}
            onMove={(id, dir) => {
              setFields((fs) => moveField(fs, id, dir));
              setDirty(true);
            }}
            onRepairHere={(id) => updateField(id, { page: pageIndex })}
            onSortByPosition={() => {
              setFields((fs) => sortByPosition(fs));
              setDirty(true);
            }}
          />
        )}
      </div>

      <Inspector
        field={selected}
        pageCount={pageCount}
        zoom={zoom}
        feintuningActive={feintuning === selected?.id}
        feinCell={feinCell}
        onCellReset={() => setFeinCell(null)}
        onToggleFeintuning={() => {
          if (feintuning === selected?.id) {
            setFeintuning(null);
            setFeinCell(null);
          } else {
            setFeintuning(selected?.id ?? null);
            setFeinCell(null);
          }
        }}
        onPatch={(patch) => selectedId && updateField(selectedId, patch)}
        onDelete={() => selectedId && deleteField(selectedId)}
        onCopy={() => {
          if (!selected) return;
          const copy = copyField(selected, fields);
          setFields((fs) => [...fs, copy]);
          setSelectedId(copy.id);
          setDirty(true);
        }}
      />

      {multiSelect.length >= 2 && (
        <AlignToolbar
          count={multiSelect.length}
          onAlign={alignSelected}
          onDistribute={distributeSelected}
          onTextAlign={setBulkAlign}
          onClear={clearMulti}
        />
      )}

      {showMultiPanel && (
        <MultiSelectPanel
          fields={fields}
          pageIndex={pageIndex}
          multiSelect={multiSelect}
          anchorId={selectedId}
          onToggle={(id) => toggleMulti(id, true)}
          onClear={clearMulti}
          onMatch={matchDimension}
        />
      )}
    </div>
  );
}

function ToolGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="px-1 text-[10px] font-semibold uppercase tracking-wider text-ink-dim">
        {label}
      </span>
      <div className="flex items-center gap-1 rounded-lg border border-line bg-surface/60 p-1">
        {children}
      </div>
    </div>
  );
}

function MultiSelectPanel({
  fields,
  pageIndex,
  multiSelect,
  anchorId,
  onToggle,
  onClear,
  onMatch,
}: {
  fields: TemplateField[];
  pageIndex: number;
  multiSelect: string[];
  anchorId: string | null;
  onToggle: (id: string) => void;
  onClear: () => void;
  onMatch: (dim: "width" | "height" | "fontSize" | "x" | "y") => void;
}) {
  const pageFields = fields.filter((f) => f.page === pageIndex);
  const anchor = fields.find((f) => f.id === anchorId) ?? null;
  const canMatch = multiSelect.length >= 2 && anchor && multiSelect.includes(anchor.id);

  return (
    <div className="fixed bottom-4 right-4 z-40 w-72 rounded-xl border border-line bg-surface p-3 shadow-xl">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold">Massen-Tagging</span>
        <button className="text-xs text-ink-dim hover:text-ink" onClick={onClear}>
          Auswahl leeren
        </button>
      </div>
      <div className="mb-2 max-h-40 space-y-1 overflow-auto">
        {pageFields.map((f) => (
          <label
            key={f.id}
            className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-surface-2"
          >
            <input
              type="checkbox"
              checked={multiSelect.includes(f.id)}
              onChange={() => onToggle(f.id)}
            />
            <span className="truncate">{f.label || f.id}</span>
            {f.id === anchorId && (
              <span className="ml-auto shrink-0 text-[10px] uppercase text-accent">Anker</span>
            )}
          </label>
        ))}
      </div>
      <p className="mb-2 text-xs text-ink-dim">
        Wählen Sie mind. 2 Felder; das zuletzt in der Liste ausgewählte Feld ist der Anker.
      </p>
      <div className="flex flex-wrap gap-1">
        <button
          className="rounded-md border border-line px-2 py-1 text-xs hover:border-accent disabled:opacity-40"
          disabled={!canMatch}
          onClick={() => onMatch("width")}
        >
          Breite angleichen
        </button>
        <button
          className="rounded-md border border-line px-2 py-1 text-xs hover:border-accent disabled:opacity-40"
          disabled={!canMatch}
          onClick={() => onMatch("height")}
        >
          Höhe angleichen
        </button>
        <button
          className="rounded-md border border-line px-2 py-1 text-xs hover:border-accent disabled:opacity-40"
          disabled={!canMatch}
          onClick={() => onMatch("fontSize")}
        >
          Schriftgröße angleichen
        </button>
        <button
          className="rounded-md border border-line px-2 py-1 text-xs hover:border-accent disabled:opacity-40"
          disabled={!canMatch}
          onClick={() => onMatch("x")}
        >
          X angleichen
        </button>
        <button
          className="rounded-md border border-line px-2 py-1 text-xs hover:border-accent disabled:opacity-40"
          disabled={!canMatch}
          onClick={() => onMatch("y")}
        >
          Y angleichen
        </button>
      </div>
    </div>
  );
}

function moveField(fields: TemplateField[], id: string, dir: -1 | 1): TemplateField[] {
  const idx = fields.findIndex((f) => f.id === id);
  if (idx < 0) return fields;
  const target = idx + dir;
  if (target < 0 || target >= fields.length) return fields;
  if (fields[target].page !== fields[idx].page) return fields;
  const next = [...fields];
  [next[idx], next[target]] = [next[target], next[idx]];
  return next;
}

function bump(arr: number[] | undefined, index: number, delta: number): number[] {
  const next = [...(arr ?? [])];
  next[index] = Math.round(((next[index] ?? 0) + delta) * 100) / 100;
  return next;
}

function sortByPosition(fields: TemplateField[]): TemplateField[] {
  return [...fields].sort(
    (a, b) => a.page - b.page || a.y - b.y || a.x - b.x || a.label.localeCompare(b.label)
  );
}
