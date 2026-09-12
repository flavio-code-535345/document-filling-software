"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const WEEKDAY_LABELS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MONTH_LABELS = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

function parseIso(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDe(value: string): string {
  const d = parseIso(value);
  if (!d) return "";
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** Monday-first weekday index (0=Mon..6=Sun) for the 1st of a month. */
function firstWeekdayIndex(year: number, month: number): number {
  const day = new Date(year, month, 1).getDay(); // 0=Sun..6=Sat
  return (day + 6) % 7;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Custom calendar-popup date picker (value/onChange use ISO "YYYY-MM-DD",
 * same as a native <input type="date">, so it's a drop-in replacement).
 * Replaces the native picker because its tiny click targets and inability
 * to jump quickly across months/years made it cumbersome for filling out
 * a full week of dates.
 */
export default function DatePicker({
  value,
  onChange,
  onFocus,
  className,
  placeholder = "TT.MM.JJJJ",
}: {
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  className?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"days" | "months" | "years">("days");
  const selected = parseIso(value);
  const today = new Date();
  const [viewYear, setViewYear] = useState(() => (selected ?? today).getFullYear());
  const [viewMonth, setViewMonth] = useState(() => (selected ?? today).getMonth());
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const sel = parseIso(value) ?? new Date();
    setViewYear(sel.getFullYear());
    setViewMonth(sel.getMonth());
    setMode("days");
    // Only re-sync when the popup opens, not on every keystroke of `value`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const yearRange = useMemo(() => {
    const base = Math.floor(viewYear / 12) * 12;
    return Array.from({ length: 12 }, (_, i) => base + i);
  }, [viewYear]);

  const grid = useMemo(() => {
    const total = daysInMonth(viewYear, viewMonth);
    const offset = firstWeekdayIndex(viewYear, viewMonth);
    const cells: (Date | null)[] = [];
    for (let i = 0; i < offset; i++) cells.push(null);
    for (let d = 1; d <= total; d++) cells.push(new Date(viewYear, viewMonth, d));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [viewYear, viewMonth]);

  function pick(d: Date) {
    onChange(toIso(d));
    setOpen(false);
  }

  function shiftMonth(delta: number) {
    setViewMonth((m) => {
      const next = m + delta;
      if (next < 0) {
        setViewYear((y) => y - 1);
        return 11;
      }
      if (next > 11) {
        setViewYear((y) => y + 1);
        return 0;
      }
      return next;
    });
  }

  return (
    <div ref={rootRef} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => {
          onFocus?.();
          setOpen((o) => !o);
        }}
        className="block w-full rounded-lg border border-line bg-canvas px-3 py-2 text-left text-sm focus:border-accent focus:outline-none"
      >
        <span className={value ? "text-ink" : "text-ink-dim"}>{value ? formatDe(value) : placeholder}</span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-64 rounded-xl border border-line bg-surface p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              className="rounded-md px-2 py-1 text-ink-dim hover:bg-surface-2 hover:text-ink"
              onClick={() => (mode === "years" ? setViewYear((y) => y - 12) : mode === "months" ? setViewYear((y) => y - 1) : shiftMonth(-1))}
            >
              ‹
            </button>
            <button
              type="button"
              className="rounded-md px-2 py-1.5 text-sm font-semibold text-ink hover:bg-surface-2"
              onClick={() => setMode((m) => (m === "days" ? "months" : m === "months" ? "years" : "days"))}
            >
              {mode === "years" ? `${yearRange[0]}–${yearRange[11]}` : mode === "months" ? String(viewYear) : `${MONTH_LABELS[viewMonth]} ${viewYear}`}
            </button>
            <button
              type="button"
              className="rounded-md px-2 py-1 text-ink-dim hover:bg-surface-2 hover:text-ink"
              onClick={() => (mode === "years" ? setViewYear((y) => y + 12) : mode === "months" ? setViewYear((y) => y + 1) : shiftMonth(1))}
            >
              ›
            </button>
          </div>

          {mode === "days" && (
            <>
              <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-ink-dim">
                {WEEKDAY_LABELS.map((w) => (
                  <div key={w}>{w}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {grid.map((d, i) => {
                  if (!d) return <div key={i} />;
                  const isToday = isSameDay(d, today);
                  const isSelected = selected ? isSameDay(d, selected) : false;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => pick(d)}
                      className={`rounded-md py-1 text-xs tabular-nums transition-colors ${
                        isSelected
                          ? "bg-accent-strong font-semibold text-white"
                          : isToday
                            ? "border border-accent text-accent"
                            : "text-ink hover:bg-surface-2"
                      }`}
                    >
                      {d.getDate()}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                className="mt-2 w-full rounded-md py-1 text-center text-xs font-medium text-accent hover:bg-surface-2"
                onClick={() => pick(today)}
              >
                Heute
              </button>
            </>
          )}

          {mode === "months" && (
            <div className="grid grid-cols-3 gap-1">
              {MONTH_LABELS.map((m, i) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setViewMonth(i);
                    setMode("days");
                  }}
                  className={`rounded-md py-1.5 text-xs transition-colors ${
                    i === viewMonth ? "bg-accent-strong font-semibold text-white" : "text-ink hover:bg-surface-2"
                  }`}
                >
                  {m.slice(0, 3)}
                </button>
              ))}
            </div>
          )}

          {mode === "years" && (
            <div className="grid grid-cols-3 gap-1">
              {yearRange.map((y) => (
                <button
                  key={y}
                  type="button"
                  onClick={() => {
                    setViewYear(y);
                    setMode("months");
                  }}
                  className={`rounded-md py-1.5 text-xs transition-colors ${
                    y === viewYear ? "bg-accent-strong font-semibold text-white" : "text-ink hover:bg-surface-2"
                  }`}
                >
                  {y}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
