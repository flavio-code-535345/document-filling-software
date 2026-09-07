"use client";

import type { AlignOp } from "@/lib/editor-utils";

/**
 * Floating alignment toolbar shown when 2+ fields are selected:
 * align edges + distribute evenly along an axis.
 */
export default function AlignToolbar({
  count,
  onAlign,
  onDistribute,
  onClear,
}: {
  count: number;
  onAlign: (op: AlignOp) => void;
  onDistribute: (axis: "x" | "y") => void;
  onClear: () => void;
}) {
  const btn =
    "rounded-md px-2 py-1 text-xs text-ink-dim hover:bg-surface-2 hover:text-ink";
  return (
    <div className="fixed left-1/2 top-40 z-40 flex -translate-x-1/2 flex-wrap items-center gap-1 rounded-xl border border-line bg-surface px-3 py-2 shadow-xl">
      <span className="mr-1 text-xs font-semibold text-ink-dim">
        {count} ausgewählt
      </span>
      <button className={btn} title="Links ausrichten" onClick={() => onAlign("left")}>
        ⇤ Links
      </button>
      <button className={btn} title="Rechts ausrichten" onClick={() => onAlign("right")}>
        Rechts ⇥
      </button>
      <button className={btn} title="Oben ausrichten" onClick={() => onAlign("top")}>
        ⇧ Oben
      </button>
      <button className={btn} title="Unten ausrichten" onClick={() => onAlign("bottom")}>
        ⇩ Unten
      </button>
      <span className="mx-1 h-4 border-l border-line" />
      <button className={btn} title="Horizontal verteilen" onClick={() => onDistribute("x")}>
        ↔ Verteilen
      </button>
      <button className={btn} title="Vertikal verteilen" onClick={() => onDistribute("y")}>
        ↕ Verteilen
      </button>
      <span className="mx-1 h-4 border-l border-line" />
      <button className={btn} title="Auswahl aufheben" onClick={onClear}>
        ✕
      </button>
    </div>
  );
}
