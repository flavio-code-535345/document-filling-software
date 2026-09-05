"use client";

import type { TemplateField } from "@/lib/types";

/**
 * Field list panel: all fields (incl. invalid pages), select/jump, delete,
 * reorder within page (up/down), "→ hier" repair, sort by position.
 */
export default function FieldListPanel({
  fields,
  pageCount,
  currentPage,
  selectedId,
  onSelect,
  onSelectAndJump,
  onDelete,
  onMove,
  onRepairHere,
  onSortByPosition,
}: {
  fields: TemplateField[];
  pageCount: number;
  currentPage: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSelectAndJump: (id: string, page: number) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onRepairHere: (id: string) => void;
  onSortByPosition: () => void;
}) {
  return (
    <aside className="w-72 shrink-0 rounded-xl border border-line bg-surface p-3 lg:sticky lg:top-32 lg:self-start">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Felder ({fields.length})</h3>
        <button
          className="rounded-lg border border-line px-2 py-1 text-xs hover:border-accent"
          onClick={onSortByPosition}
        >
          Sortieren (Position)
        </button>
      </div>
      <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
        {fields.length === 0 && (
          <li className="text-sm text-ink-dim">Keine Felder angelegt.</li>
        )}
        {fields.map((f, index) => {
          const invalid = f.page < 0 || f.page >= pageCount;
          return (
            <li
              key={f.id}
              className={`flex flex-col gap-1 rounded-lg border px-2 py-1.5 text-sm ${
                f.id === selectedId
                  ? "border-accent bg-accent/10"
                  : invalid
                    ? "border-red-500/50"
                    : "border-line"
              }`}
            >
              <div className="flex items-center gap-1">
                <button
                  className="min-w-0 flex-1 truncate text-left hover:text-accent"
                  onClick={() => onSelectAndJump(f.id, invalid ? 0 : f.page)}
                  title={
                    invalid
                      ? `Seite ${f.page} existiert nicht — klicken, um zu Seite 1 zu springen`
                      : undefined
                  }
                >
                  <span
                    className={
                      invalid
                        ? "text-red-400"
                        : f.page === currentPage
                          ? "text-accent"
                          : "text-ink-dim"
                    }
                  >
                    {f.page + 1}.
                  </span>{" "}
                  {f.label || "?"}{" "}
                  <span className="text-xs text-ink-dim">({f.kind})</span>
                </button>
                <div className="flex shrink-0 gap-0.5 text-xs">
                  <button
                    title="Nach oben"
                    className="rounded px-1 hover:bg-surface-2"
                    disabled={index === 0}
                    onClick={() => onMove(f.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    title="Nach unten"
                    className="rounded px-1 hover:bg-surface-2"
                    disabled={index === fields.length - 1}
                    onClick={() => onMove(f.id, 1)}
                  >
                    ↓
                  </button>
                  {invalid && (
                    <button
                      title={`Auf Seite ${currentPage + 1} übernehmen`}
                      className="rounded px-1 text-accent hover:bg-surface-2"
                      onClick={() => onRepairHere(f.id)}
                    >
                      → hier
                    </button>
                  )}
                  <button
                    title="Löschen"
                    className="rounded px-1 text-red-400 hover:bg-surface-2"
                    onClick={() => onDelete(f.id)}
                  >
                    ✕
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {fields.length > 0 && (
        <p className="mt-2 text-xs text-ink-dim">
          Reihenfolge = Formularreihenfolge.
        </p>
      )}
    </aside>
  );
}
