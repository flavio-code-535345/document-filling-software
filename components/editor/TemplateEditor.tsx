"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FieldKind, StoredTemplate, TemplateField } from "@/lib/types";
import {
  createField,
  copyField,
  newFieldId,
  clampPageIndex,
} from "@/lib/editor-utils";
import { matrixCellCenter } from "@/lib/geometry";
import PdfPageView from "./PdfPageView";
import Inspector from "./Inspector";
import FieldListPanel from "./FieldListPanel";
import type { PreviewValues } from "@/components/PreviewSvg";

const TOOLS: { kind: FieldKind; label: string; icon: string }[] = [
  { kind: "text", label: "Text", icon: "T" },
  { kind: "multiline", label: "Mehrzeilig", icon: "≡" },
  { kind: "date", label: "Datum", icon: "📅" },
  { kind: "checkbox", label: "Kästchen", icon: "☐" },
  { kind: "signature", label: "Unterschrift", icon: "✍" },
  { kind: "matrix", label: "Matrix", icon: "▦" },
];

export default function TemplateEditor({ template }: { template: StoredTemplate }) {
  const router = useRouter();
  const templateRef = useRef(template);

  const [fields, setFields] = useState<TemplateField[]>(template.fields);
  const [pageCount, setPageCount] = useState(template.pageCount);
  const [pageSizes, setPageSizes] = useState(template.pageSizes);
  const [pageIndex, setPageIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [activeTool, setActiveTool] = useState<FieldKind | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(template.updatedAt);
  const [showPanel, setShowPanel] = useState(false);
  const [previewEnabled, setPreviewEnabled] = useState(false);
  const [sampleText, setSampleText] = useState("Mustertext");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Matrix two-click stamping
  const [pendingMatrix, setPendingMatrix] = useState<{
    fieldId: string;
    origin: { x: number; y: number };
  } | null>(null);

  // 🎯 Feintuning: fieldId + selected cell
  const [feintuning, setFeintuning] = useState<string | null>(null);
  const [feinCell, setFeinCell] = useState<{ row: number; col: number } | null>(null);

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

  // ---- stamping ----
  const handlePageClick = useCallback(
    (pt: { x: number; y: number }) => {
      if (!activeTool) return;
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
      if (!selectedId) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteField(selectedId);
        return;
      }

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
  }, [selectedId, fields, feintuning, feinCell, deleteField, updateField, cancelTool]);

  // ---- save / discard ----
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/templates/${template.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Speichern fehlgeschlagen.");
      const updated = data.template;
      setSavedAt(updated.updatedAt);
      templateRef.current = updated;
      setPageCount(updated.pageCount);
      setPageSizes(updated.pageSizes);
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
    setDirty(false);
    setSelectedId(null);
    setActiveTool(null);
    setPendingMatrix(null);
    setFeintuning(null);
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
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/admin"
            className="rounded-lg border border-line px-3 py-1.5 text-sm hover:border-accent"
          >
            ← Vorlagen
          </Link>
          <span className="font-medium">{template.name}</span>

          <span className="mx-1 h-5 border-l border-line" />

          {TOOLS.map((t) => (
            <button
              key={t.kind}
              title={t.label}
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                activeTool === t.kind
                  ? "border-accent bg-accent/20"
                  : "border-line hover:border-accent"
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

          <span className="mx-1 h-5 border-l border-line" />

          <button
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              showPanel ? "border-accent bg-accent/20" : "border-line hover:border-accent"
            }`}
            onClick={() => setShowPanel((s) => !s)}
          >
            Felder
          </button>
          <button
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              previewEnabled ? "border-accent bg-accent/20" : "border-line hover:border-accent"
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
              className="w-32 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
            />
          )}

          <span className="mx-1 h-5 border-l border-line" />

          <button
            className="rounded-lg border border-line px-3 py-1.5 text-sm hover:border-accent"
            title="Zoom"
            onClick={() => setZoom((z) => Math.round((z - 0.25) * 4) / 4)}
          >
            −
          </button>
          <span className="w-10 text-center text-sm">{Math.round(zoom * 100)}%</span>
          <button
            className="rounded-lg border border-line px-3 py-1.5 text-sm hover:border-accent"
            onClick={() => setZoom((z) => Math.round((z + 0.25) * 4) / 4)}
          >
            +
          </button>

          <label className="rounded-lg border border-line px-3 py-1.5 text-sm hover:border-accent">
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

          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-ink-dim">
              {dirty ? "Ungespeichert" : savedAt ? "Gespeichert" : ""}
            </span>
            <button
              className="rounded-lg border border-line px-3 py-1.5 text-sm hover:border-accent"
              disabled={!dirty || busy}
              onClick={discard}
            >
              Verwerfen
            </button>
            <button
              className="rounded-lg bg-accent-strong px-4 py-1.5 text-sm font-semibold text-white"
              disabled={!dirty || busy}
              onClick={save}
            >
              {busy ? "Speichert…" : "Speichern"}
            </button>
          </div>
        </div>
        {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
      </div>

      {/* Stage */}
      <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <div className="flex justify-center overflow-auto rounded-xl border border-line bg-surface-2/50 p-6">
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
              activeTool={activeTool}
              feintuning={feintuning}
              feinCell={feinCell}
              previewEnabled={previewEnabled}
              sampleValues={sampleValues}
              onSelect={(id) => setSelectedId(id)}
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
            onSelect={(id) => setSelectedId(id)}
            onSelectAndJump={(id, page) => {
              setSelectedId(id);
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
