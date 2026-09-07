"use client";

import type { AlignOp } from "@/lib/editor-utils";
import type { TextAlign } from "@/lib/types";

/**
 * Floating alignment toolbar shown when 2+ fields are selected:
 * align edges, distribute evenly along an axis, and bulk-set text alignment.
 */
export default function AlignToolbar({
  count,
  onAlign,
  onDistribute,
  onTextAlign,
  onLink,
  onUnlink,
  onClear,
}: {
  count: number;
  onAlign: (op: AlignOp) => void;
  onDistribute: (axis: "x" | "y") => void;
  onTextAlign: (align: TextAlign) => void;
  onLink: () => void;
  onUnlink: () => void;
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
      <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-dim">
        Text
      </span>
      <button className={btn} title="Text links ausrichten" onClick={() => onTextAlign("left")}>
        ⇤ Links
      </button>
      <button className={btn} title="Text zentrieren" onClick={() => onTextAlign("center")}>
        ↔ Mitte
      </button>
      <button className={btn} title="Text rechts ausrichten" onClick={() => onTextAlign("right")}>
        Rechts ⇥
      </button>
      <span className="mx-1 h-4 border-l border-line" />
      <button
        className={btn}
        title="Felder verknüpfen — ein Eingabefeld füllt alle"
        onClick={onLink}
      >
        🔗 Verknüpfen
      </button>
      <button className={btn} title="Verknüpfung aufheben" onClick={onUnlink}>
        Trennen
      </button>
      <span className="mx-1 h-4 border-l border-line" />
      <button className={btn} title="Auswahl aufheben" onClick={onClear}>
        ✕
      </button>
    </div>
  );
}
