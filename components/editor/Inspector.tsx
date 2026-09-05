"use client";

import { useEffect, useRef, useState } from "react";
import type { FieldKind, TemplateField } from "@/lib/types";

const KINDS: FieldKind[] = ["text", "multiline", "date", "checkbox", "signature", "matrix"];

/**
 * Draggable inspector popover for the selected field.
 * Position is stored per selection change; drag is tagged by field id.
 */
export default function Inspector({
  field,
  pageCount,
  zoom,
  feintuningActive,
  feinCell,
  onCellReset,
  onToggleFeintuning,
  onPatch,
  onDelete,
  onCopy,
}: {
  field: TemplateField | null;
  pageCount: number;
  zoom: number;
  feintuningActive: boolean;
  feinCell: { row: number; col: number } | null;
  onCellReset: () => void;
  onToggleFeintuning: () => void;
  onPatch: (patch: Partial<TemplateField>) => void;
  onDelete: () => void;
  onCopy: () => void;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; base: { x: number; y: number } } | null>(null);
  const posTagRef = useRef<string | null>(null);

  // Initialize position from the selected field's screen rect (once per field).
  useEffect(() => {
    if (!field) return;
    if (posTagRef.current === field.id) return;
    posTagRef.current = field.id;
    const el = document.querySelector(`[data-field-id="${field.id}"]`);
    if (!el) return setPos(null);
    const rect = el.getBoundingClientRect();
    const side = Math.max(16, 300);
    let x = rect.right + 12;
    // flip left near the right edge
    if (x + side > window.innerWidth - 16) x = rect.left - side - 12;
    setPos({ x, y: Math.max(70, rect.top) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field?.id]);

  const clampPage = (value: number) => Math.min(Math.max(0, value), Math.max(0, pageCount - 1));

  if (!field || !pos) return null;

  const num = (v: number | undefined, fallback: number) => (v ?? fallback);

  const onHeaderDown = (e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, base: pos };
    const move = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setPos({ x: d.base.x + (ev.clientX - d.startX), y: d.base.y + (ev.clientY - d.startY) });
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      className="fixed z-40 w-72 rounded-xl border border-line bg-surface shadow-2xl"
      style={{ left: pos.x, top: pos.y }}
    >
      <div
        className="flex cursor-move items-center justify-between border-b border-line px-3 py-2"
        onPointerDown={onHeaderDown}
      >
        <span className="text-sm font-semibold">Feld</span>
        <span className="text-xs text-ink-dim">ziehen zum verschieben</span>
      </div>

      <div className="max-h-[55vh] space-y-3 overflow-y-auto p-3">
        <label className="block text-xs text-ink-dim">
          Bezeichnung
          <input
            className="mt-1 w-full rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm"
            value={field.label}
            onChange={(e) => onPatch({ label: e.target.value })}
          />
        </label>

        <label className="block text-xs text-ink-dim">
          Art
          <select
            className="mt-1 w-full rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm"
            value={field.kind}
            onChange={(e) => onPatch({ kind: e.target.value as FieldKind })}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-3 gap-2">
          <label className="block text-xs text-ink-dim">
            Seite
            <input
              type="number"
              className="mt-1 w-full rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm"
              value={field.page}
              min={0}
              max={Math.max(0, pageCount - 1)}
              onChange={(e) => onPatch({ page: clampPage(Number(e.target.value) || 0) })}
            />
          </label>
          <label className="block text-xs text-ink-dim">
            X
            <input
              type="number"
              className="mt-1 w-full rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm"
              value={Math.round(field.x * 100) / 100}
              onChange={(e) => onPatch({ x: Number(e.target.value) || 0 })}
            />
          </label>
          <label className="block text-xs text-ink-dim">
            Y
            <input
              type="number"
              className="mt-1 w-full rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm"
              value={Math.round(field.y * 100) / 100}
              onChange={(e) => onPatch({ y: Number(e.target.value) || 0 })}
            />
          </label>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <label className="block text-xs text-ink-dim">
            Breite
            <input
              type="number"
              className="mt-1 w-full rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm"
              value={Math.round(field.width * 100) / 100}
              onChange={(e) => onPatch({ width: Math.max(4, Number(e.target.value) || 4) })}
            />
          </label>
          <label className="block text-xs text-ink-dim">
            Höhe
            <input
              type="number"
              className="mt-1 w-full rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm"
              value={Math.round(field.height * 100) / 100}
              onChange={(e) => onPatch({ height: Math.max(4, Number(e.target.value) || 4) })}
            />
          </label>
          <label className="block text-xs text-ink-dim">
            Schrift
            <input
              type="number"
              className="mt-1 w-full rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm"
              value={field.fontSize}
              min={5}
              max={72}
              onChange={(e) => onPatch({ fontSize: Number(e.target.value) || 11 })}
            />
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={field.required}
            onChange={(e) => onPatch({ required: e.target.checked })}
          />
          Pflichtfeld
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(field.inFileName)}
            onChange={(e) =>
              onPatch({
                inFileName: e.target.checked ? true : undefined,
              })
            }
          />
          Im Dateinamen verwenden
        </label>

        {field.kind === "matrix" && (
          <div className="space-y-3 border-t border-line pt-3">
            <h4 className="text-sm font-semibold">Matrix</h4>

            <label className="block text-xs text-ink-dim">
              Rastermaß X (pt)
              <input
                type="number"
                className="mt-1 w-full rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm"
                value={num(field.matrixCellWidth, 20)}
                onChange={(e) => onPatch({ matrixCellWidth: Number(e.target.value) || 8 })}
              />
            </label>
            <label className="block text-xs text-ink-dim">
              Rastermaß Y (pt)
              <input
                type="number"
                className="mt-1 w-full rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm"
                value={num(field.matrixCellHeight, 20)}
                onChange={(e) => onPatch({ matrixCellHeight: Number(e.target.value) || 8 })}
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs text-ink-dim">
                Versatz X / Zeile
                <input
                  type="number"
                  step="0.1"
                  className="mt-1 w-full rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm"
                  value={num(field.matrixDriftX, 0)}
                  onChange={(e) => onPatch({ matrixDriftX: Number(e.target.value) || 0 })}
                />
              </label>
              <label className="block text-xs text-ink-dim">
                Versatz Y / Zeile
                <input
                  type="number"
                  step="0.1"
                  className="mt-1 w-full rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm"
                  value={num(field.matrixDriftY, 0)}
                  onChange={(e) => onPatch({ matrixDriftY: Number(e.target.value) || 0 })}
                />
              </label>
            </div>

            <ButtonRow
              labels={field.matrixRows ?? []}
              kind="Zeile"
              onChange={(arr) => onPatch({ matrixRows: arr })}
            />
            <ButtonRow
              labels={field.matrixCols ?? []}
              kind="Spalte"
              onChange={(arr) => onPatch({ matrixCols: arr })}
            />

            <button
              className={`w-full rounded-lg border px-2 py-1.5 text-sm ${
                feintuningActive ? "border-accent bg-accent/20" : "border-line hover:border-accent"
              }`}
              onClick={() => {
                onToggleFeintuning();
                onCellReset();
              }}
            >
              🎯 Feintuning {feintuningActive ? "(aktiv)" : ""}
            </button>
            {feintuningActive && (
              <p className="text-xs text-ink-dim">
                {feinCell
                  ? `Zeile ${feinCell.row}, Spalte ${feinCell.col}: Pfeiltasten justieren Spalte (Alt = Zeile) in 0,25-pt-Schritten.`
                  : "Klicke eine Zelle an, dann Pfeiltasten (Alt = Zeile)."}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-2 border-t border-line p-3">
        <button
          className="flex-1 rounded-lg border border-line px-2 py-1.5 text-sm hover:border-accent"
          onClick={onCopy}
        >
          Duplizieren
        </button>
        <button
          className="flex-1 rounded-lg border border-line px-2 py-1.5 text-sm text-red-400 hover:border-red-400"
          onClick={onDelete}
        >
          Löschen
        </button>
      </div>
    </div>
  );
}

function ButtonRow({
  labels,
  kind,
  onChange,
}: {
  labels: string[];
  kind: "Zeile" | "Spalte";
  onChange: (labels: string[]) => void;
}) {
  return (
    <div className="space-y-1.5 border-t border-line pt-2 text-xs">
      <p className="font-medium text-ink-dim">
        {kind === "Zeile" ? "Zeilenbeschriftungen" : "Spaltenbeschriftungen"}
      </p>
      {labels.map((label, i) => (
        <div key={i} className="flex gap-1">
          <input
            className="w-full rounded border border-line bg-canvas px-2 py-1 text-sm"
            value={label}
            onChange={(e) => {
              const next = [...labels];
              next[i] = e.target.value;
              onChange(next);
            }}
          />
          <button
            className="rounded border border-line px-2 text-xs text-red-400"
            onClick={() => onChange(labels.filter((_, j) => j !== i))}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        className="rounded border border-line px-2 py-0.5 text-xs hover:border-accent"
        onClick={() => onChange([...labels, ""])}
      >
        + {kind} hinzufügen
      </button>
    </div>
  );
}
