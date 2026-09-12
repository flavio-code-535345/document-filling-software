"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  FieldKind,
  FillValues,
  FontFamily,
  FontStyle,
  FontWeight,
  OverflowMode,
  TemplateField,
  TextAlign,
  VerticalAlign,
} from "@/lib/types";
import { previewFormula } from "@/lib/formula";

const KINDS: FieldKind[] = ["text", "multiline", "date", "checkbox", "signature", "matrix"];

/** Quick-insert chips for the formula editor: label shown, snippet inserted,
 * and where the caret lands inside it (so e.g. "IF(,,)" leaves you ready to
 * type the condition rather than after the closing paren). */
const FORMULA_FUNCTIONS: { label: string; snippet: string; caret: number; hint: string }[] = [
  { label: "SUM()", snippet: "SUM()", caret: 4, hint: "Summe mehrerer Werte: SUM({A},{B},{C})" },
  { label: "AVG()", snippet: "AVG()", caret: 4, hint: "Mittelwert: AVG({A},{B},{C})" },
  { label: "MIN()", snippet: "MIN()", caret: 4, hint: "Kleinster Wert: MIN({A},{B})" },
  { label: "MAX()", snippet: "MAX()", caret: 4, hint: "Größter Wert: MAX({A},{B})" },
  { label: "ABS()", snippet: "ABS()", caret: 4, hint: "Absolutwert (ohne Vorzeichen)" },
  { label: "ROUND(,0)", snippet: "ROUND(,0)", caret: 6, hint: "Runden: ROUND(Wert, Nachkommastellen)" },
  { label: "ROUNDUP(,0)", snippet: "ROUNDUP(,0)", caret: 8, hint: "Aufrunden: ROUNDUP(Wert, Nachkommastellen)" },
  { label: "ROUNDDOWN(,0)", snippet: "ROUNDDOWN(,0)", caret: 10, hint: "Abrunden: ROUNDDOWN(Wert, Nachkommastellen)" },
  { label: "CEIL()", snippet: "CEIL()", caret: 5, hint: "Aufrunden auf ganze Zahl" },
  { label: "FLOOR()", snippet: "FLOOR()", caret: 6, hint: "Abrunden auf ganze Zahl" },
  // IF/AND/OR/MOD show their full arg list in the label for documentation,
  // but insert just the empty call (like SUM() above) rather than
  // pre-filled placeholder commas: with several genuinely-empty slots to
  // fill, landing the caret before a placeholder "," is a trap — the next
  // chip or field you insert lands before that comma too, silently merging
  // into the wrong argument. Typing every comma yourself (same as SUM's
  // "{A},{B}") is one consistent, unsurprising motion instead.
  { label: "MOD(,)", snippet: "MOD()", caret: 4, hint: "Rest der Division: MOD(Zahl, Divisor)" },
  { label: "IF(,,)", snippet: "IF()", caret: 3, hint: "Bedingung: IF(Bedingung, Dann, Sonst) — z. B. IF({Stunden}>8, {Stunden}-8, 0)" },
  { label: "AND(,)", snippet: "AND()", caret: 4, hint: "Wahr, wenn alle Bedingungen erfüllt sind" },
  { label: "OR(,)", snippet: "OR()", caret: 3, hint: "Wahr, wenn mindestens eine Bedingung erfüllt ist" },
  { label: "NOT()", snippet: "NOT()", caret: 4, hint: "Kehrt eine Bedingung um" },
];

const FORMULA_OPERATORS = ["+", "-", "*", "/", "%", "(", ")", "=", "<>", "<", "<=", ">", ">="];

/** Ensure a value is a valid "#RRGGBB" string for the color input. */
function normalizeHex(value: string | undefined): string {
  return /^#[0-9a-f]{6}$/i.test(value ?? "") ? value! : "#000000";
}

/**
 * Draggable inspector popover for the selected field.
 * Position is stored per selection change; drag is tagged by field id.
 */
export default function Inspector({
  field,
  allFields,
  pageCount,
  zoom,
  previewValues,
  feintuningActive,
  feinCell,
  onCellReset,
  onToggleFeintuning,
  onPatch,
  onDelete,
  onCopy,
}: {
  field: TemplateField | null;
  allFields: TemplateField[];
  pageCount: number;
  zoom: number;
  previewValues: FillValues;
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
  const formulaRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaretRef = useRef<number | null>(null);

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

  // Restore the caret after a chip/dropdown inserts a snippet into the
  // formula (the textarea's value only updates once the patch round-trips
  // back down as a prop, so the actual setSelectionRange happens here).
  useEffect(() => {
    if (pendingCaretRef.current === null || !formulaRef.current) return;
    const caretPos = pendingCaretRef.current;
    pendingCaretRef.current = null;
    formulaRef.current.focus();
    formulaRef.current.setSelectionRange(caretPos, caretPos);
  }, [field?.formula]);

  const formulaPreview = useMemo(() => {
    if (!field || (field.kind !== "text" && field.kind !== "multiline")) return null;
    return previewFormula(field.formula ?? "", allFields, previewValues, field.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field?.formula, field?.id, field?.kind, allFields, previewValues]);

  const clampPage = (value: number) => Math.min(Math.max(0, value), Math.max(0, pageCount - 1));

  if (!field || !pos) return null;

  const num = (v: number | undefined, fallback: number) => (v ?? fallback);

  /** Inserts `snippet` at the formula textarea's caret (or the end, if it
   * isn't focused), and moves the caret to `caretOffset` within it —
   * e.g. inserting "SUM()" with caretOffset 4 lands the caret between the
   * parens, ready to type the first argument. */
  const insertIntoFormula = (snippet: string, caretOffset?: number) => {
    const el = formulaRef.current;
    const current = field.formula ?? "";
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const next = current.slice(0, start) + snippet + current.slice(end);
    pendingCaretRef.current = start + (caretOffset ?? snippet.length);
    onPatch({ formula: next });
  };

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

        {(field.kind === "text" || field.kind === "multiline" || field.kind === "date") && (
          <div className="space-y-3 border-t border-line pt-3">
            <h4 className="text-sm font-semibold">Text</h4>

            <label className="block text-xs text-ink-dim">
              Schriftart
              <select
                className="mt-1 w-full rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm"
                value={field.fontFamily ?? "Helvetica"}
                onChange={(e) => onPatch({ fontFamily: e.target.value as FontFamily })}
              >
                <option value="Helvetica">Helvetica</option>
                <option value="Times-Roman">Times Roman</option>
                <option value="Courier">Courier</option>
              </select>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs text-ink-dim">
                Stärke
                <select
                  className="mt-1 w-full rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm"
                  value={field.fontWeight ?? "normal"}
                  onChange={(e) => onPatch({ fontWeight: e.target.value as FontWeight })}
                >
                  <option value="normal">Normal</option>
                  <option value="bold">Fett</option>
                </select>
              </label>
              <label className="block text-xs text-ink-dim">
                Stil
                <select
                  className="mt-1 w-full rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm"
                  value={field.fontStyle ?? "normal"}
                  onChange={(e) => onPatch({ fontStyle: e.target.value as FontStyle })}
                >
                  <option value="normal">Normal</option>
                  <option value="italic">Kursiv</option>
                </select>
              </label>
            </div>

            <label className="block text-xs text-ink-dim">
              Textfarbe
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="color"
                  className="h-8 w-10 cursor-pointer rounded border border-line bg-canvas"
                  value={normalizeHex(field.textColor)}
                  onChange={(e) => onPatch({ textColor: e.target.value })}
                />
                <input
                  className="w-full rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm uppercase"
                  value={normalizeHex(field.textColor)}
                  onChange={(e) => onPatch({ textColor: e.target.value })}
                />
              </div>
            </label>

            <label className="block text-xs text-ink-dim">
              Ausrichtung
              <select
                className="mt-1 w-full rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm"
                value={field.align ?? "left"}
                onChange={(e) => onPatch({ align: e.target.value as TextAlign })}
              >
                <option value="left">Links</option>
                <option value="center">Zentriert</option>
                <option value="right">Rechts</option>
              </select>
            </label>

            <label className="block text-xs text-ink-dim">
              Vertikale Ausrichtung
              <select
                className="mt-1 w-full rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm"
                value={field.valign ?? "middle"}
                onChange={(e) => onPatch({ valign: e.target.value as VerticalAlign })}
              >
                <option value="top">Oben</option>
                <option value="middle">Mitte</option>
                <option value="bottom">Unten</option>
              </select>
            </label>

            <label className="block text-xs text-ink-dim">
              Überlauf
              <select
                className="mt-1 w-full rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm"
                value={field.overflow ?? "shrink"}
                onChange={(e) => onPatch({ overflow: e.target.value as OverflowMode })}
              >
                <option value="shrink">An Feld anpassen (verkleinern)</option>
                <option value="visible">Überlauf erlauben</option>
              </select>
            </label>
          </div>
        )}

        {(field.kind === "text" || field.kind === "multiline") && (
          <div className="space-y-2 border-t border-line pt-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">Formel (optional)</h4>
              {field.formula && (
                <button
                  className="text-xs text-red-400 hover:underline"
                  onClick={() => onPatch({ formula: undefined })}
                >
                  entfernen
                </button>
              )}
            </div>
            <textarea
              ref={formulaRef}
              rows={3}
              className="w-full rounded-lg border border-line bg-canvas px-2 py-1.5 font-mono text-xs"
              placeholder="z. B. {Stunden Montag} + {Stunden Dienstag}"
              value={field.formula ?? ""}
              onChange={(e) => onPatch({ formula: e.target.value || undefined })}
            />

            {allFields.filter((f) => f.id !== field.id && f.label).length > 0 && (
              <select
                className="w-full rounded-lg border border-line bg-canvas px-2 py-1.5 text-xs text-ink-dim"
                value=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  insertIntoFormula(`{${e.target.value}}`);
                  e.target.value = "";
                }}
              >
                <option value="">+ Feld einfügen…</option>
                {allFields
                  .filter((f) => f.id !== field.id && f.label)
                  .map((f) => (
                    <option key={f.id} value={f.label}>
                      {f.label}
                    </option>
                  ))}
              </select>
            )}

            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-dim/70">
                Funktionen
              </p>
              <div className="flex flex-wrap gap-1">
                {FORMULA_FUNCTIONS.map((fn) => (
                  <button
                    key={fn.label}
                    type="button"
                    title={fn.hint}
                    className="rounded border border-line px-1.5 py-0.5 font-mono text-[11px] hover:border-accent hover:bg-surface-2"
                    onClick={() => insertIntoFormula(fn.snippet, fn.caret)}
                  >
                    {fn.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-dim/70">
                Operatoren
              </p>
              <div className="flex flex-wrap gap-1">
                {FORMULA_OPERATORS.map((op) => (
                  <button
                    key={op}
                    type="button"
                    className="rounded border border-line px-2 py-0.5 font-mono text-[11px] hover:border-accent hover:bg-surface-2"
                    onClick={() => insertIntoFormula(op)}
                  >
                    {op}
                  </button>
                ))}
              </div>
            </div>

            {formulaPreview && field.formula?.trim() && (
              <div
                className={`rounded-lg border px-2 py-1.5 text-xs ${
                  formulaPreview.ok
                    ? "border-line bg-surface-2/50 text-ink-dim"
                    : "border-red-400/40 bg-red-400/10 text-red-400"
                }`}
              >
                {formulaPreview.ok ? (
                  <>
                    Vorschau (Musterwerte):{" "}
                    <strong className="text-ink">{formulaPreview.value || "0"}</strong>
                  </>
                ) : (
                  <>⚠ {formulaPreview.error}</>
                )}
              </div>
            )}

            <p className="text-[11px] leading-snug text-ink-dim">
              Verweist per <code className="rounded bg-surface-2 px-1">{"{Bezeichnung}"}</code> auf
              andere Felder — auch auf andere Formelfelder (Verkettung). Wird beim Ausfüllen
              automatisch berechnet (schreibgeschützt).
            </p>
            <p className="text-[11px] leading-snug text-ink-dim">
              Bei mehreren Zahlen direkt hintereinander ein Leerzeichen nach dem Komma setzen oder{" "}
              <code className="rounded bg-surface-2 px-1">;</code> statt{" "}
              <code className="rounded bg-surface-2 px-1">,</code> verwenden — z. B.{" "}
              <code className="rounded bg-surface-2 px-1">MOD(10, 3)</code>, nicht{" "}
              <code className="rounded bg-surface-2 px-1">MOD(10,3)</code>, da{" "}
              <code className="rounded bg-surface-2 px-1">10,3</code> sonst als Dezimalzahl gilt.
            </p>
          </div>
        )}

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
