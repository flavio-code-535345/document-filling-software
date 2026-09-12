"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FieldValue, SavedFill, StoredTemplate, TemplateField } from "@/lib/types";
import { evaluateFormulas } from "@/lib/formula";
import type { PreviewValues } from "@/components/PreviewSvg";
import PagePreview from "./PagePreview";
import MatrixInput, { type MatrixSelection } from "./MatrixInput";
import SignatureInput from "./SignatureInput";
import DatePicker from "./DatePicker";

interface LinkedGroup {
  key: string;
  fields: TemplateField[];
}

/** The five fixed columns of a timesheet day block. */
type TimesheetColumn = "datum" | "von" | "bis" | "pause" | "stunden";

const COLUMN_ORDER: TimesheetColumn[] = ["datum", "von", "bis", "pause", "stunden"];

const COLUMN_LABELS: Record<TimesheetColumn, string> = {
  datum: "Datum",
  von: "Von",
  bis: "Bis",
  pause: "Pause",
  stunden: "Stunden",
};

const DAY_DEFS: { key: string; label: string; re: RegExp }[] = [
  { key: "mo", label: "Montag", re: /\b(montag|mo)\b/i },
  { key: "di", label: "Dienstag", re: /\b(dienstag|di)\b/i },
  { key: "mi", label: "Mittwoch", re: /\b(mittwoch|mi)\b/i },
  { key: "do", label: "Donnerstag", re: /\b(donnerstag|do)\b/i },
  { key: "fr", label: "Freitag", re: /\b(freitag|fr)\b/i },
  { key: "sa", label: "Samstag", re: /\b(samstag|sa)\b/i },
  { key: "so", label: "Sonntag", re: /\b(sonntag|so)\b/i },
];

/** Resolve a field label to a day-of-week key ("mo"…"so"), or null. */
function detectDay(label: string): string | null {
  for (const d of DAY_DEFS) if (d.re.test(label)) return d.key;
  return null;
}

/** Resolve a field label to one of the five timesheet columns, or null. */
function detectColumn(label: string): TimesheetColumn | null {
  const l = label.toLowerCase();
  if (/\bdatum\b/.test(l)) return "datum";
  if (/\bvon\b|\bbeginn\b|\bstart\b|\banfang\b/.test(l)) return "von";
  if (/\bbis\b|\bende\b/.test(l)) return "bis";
  if (/\bpause\b/.test(l)) return "pause";
  if (/\bstunden\b|\barbeitszeit\b|\bgesamt\b/.test(l)) return "stunden";
  return null;
}

interface DayLayout {
  key: string;
  label: string;
  columns: Partial<Record<TimesheetColumn, LinkedGroup>>;
}

interface PageLayout {
  general: LinkedGroup[];
  days: DayLayout[];
}

/**
 * Splits a page's groups into semantic buckets: timesheet fields (which carry
 * a day suffix + a known column keyword) are grouped by day of week, while
 * everything else ("Name", "Vorname", …) stays in the general list.
 */
function buildPageLayout(pageGroups: LinkedGroup[]): PageLayout {
  const general: LinkedGroup[] = [];
  const daysByKey = new Map<string, DayLayout>();

  for (const g of pageGroups) {
    const label = g.fields[0].label;
    const dayKey = detectDay(label);
    const column = dayKey ? detectColumn(label) : null;
    if (dayKey && column) {
      let day = daysByKey.get(dayKey);
      if (!day) {
        const def = DAY_DEFS.find((d) => d.key === dayKey)!;
        day = { key: dayKey, label: def.label, columns: {} };
        daysByKey.set(dayKey, day);
      }
      day.columns[column] = g;
    } else {
      general.push(g);
    }
  }

  general.sort((a, b) => {
    const fa = a.fields[0];
    const fb = b.fields[0];
    return fa.y - fb.y || fa.x - fb.x;
  });

  const days = [...daysByKey.values()].sort((a, b) => {
    const ai = DAY_DEFS.findIndex((d) => d.key === a.key);
    const bi = DAY_DEFS.findIndex((d) => d.key === b.key);
    return ai - bi;
  });

  return { general, days };
}

type DayBlock =
  | { type: "full"; day: DayLayout; cols: TimesheetColumn[] }
  | { type: "simple"; days: { day: DayLayout; col: TimesheetColumn }[] };

/**
 * Groups a page's days into render blocks: a day with more than one
 * timesheet column (a full Von/Bis/Pause/Stunden row) keeps its own
 * dedicated row, sized to only the columns it actually has; consecutive
 * days that carry just a single column (typically only "Datum", e.g. a day
 * with no Von/Bis on this document) are bundled into one compact row
 * instead of each reserving a full-width grid row that's mostly empty.
 */
function groupDayBlocks(days: DayLayout[]): DayBlock[] {
  const blocks: DayBlock[] = [];
  for (const day of days) {
    const cols = COLUMN_ORDER.filter((c) => day.columns[c]);
    if (cols.length <= 1) {
      const col = cols[0];
      if (!col) continue;
      const last = blocks[blocks.length - 1];
      if (last?.type === "simple") last.days.push({ day, col });
      else blocks.push({ type: "simple", days: [{ day, col }] });
    } else {
      blocks.push({ type: "full", day, cols });
    }
  }
  return blocks;
}

/**
 * Groups fields into single controls: fields with a shared linkKey collapse
 * into one input; unlinked fields fall back to identical label+kind (legacy).
 */
function groupFields(fields: TemplateField[]): LinkedGroup[] {
  const groups = new Map<string, TemplateField[]>();
  for (const f of fields) {
    const key = f.linkKey ?? `${f.kind}|${f.label}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f);
  }
  return [...groups.values()].map((fields) => ({
    key: fields[0].linkKey ?? `${fields[0].kind}|${fields[0].label}`,
    fields,
  }));
}

/** ISO-8601 dates of a calendar week (Monday-first), up to `count` days. */
function isoWeekDates(year: number, week: number, count: number): string[] {
  const jan4 = Date.UTC(year, 0, 4);
  const dow = new Date(jan4).getUTCDay();
  const week1Monday = jan4 - ((dow + 6) % 7) * 86400000;
  const monday = week1Monday + (week - 1) * 7 * 86400000;
  const out: string[] = [];
  for (let i = 0; i < Math.min(Math.max(0, count), 7); i++) {
    out.push(new Date(monday + i * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

/**
 * ISO-8601 week number (Monday-first; week 1 is the week containing the
 * year's first Thursday) for a given date, via the standard "nearest
 * Thursday" trick: shifting to that Thursday makes the week/year unambiguous
 * even for the first/last days of a year.
 */
function isoWeekOf(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7; // Mon=1 … Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

/** A "Kalenderwoche" field: labeled KW/Kalenderwoche and split into digit
 * boxes (the two-digit week-number squares this whole feature was built for). */
function isKwField(f: TemplateField): boolean {
  return f.kind === "text" && !!f.digitBoxes && f.digitBoxes > 1 && /\bkw\b|kalenderwoche/i.test(f.label);
}

/** Defaults every KW field to the current ISO week, so the form opens
 * already showing "this week" instead of blank boxes. Only ever used as an
 * initial/fallback value — a loaded draft's own values still win. */
function defaultKwValues(fields: TemplateField[]): Record<string, FieldValue> {
  const { week } = isoWeekOf(new Date());
  const out: Record<string, FieldValue> = {};
  for (const f of fields) {
    if (isKwField(f)) out[f.id] = String(week).padStart(f.digitBoxes!, "0").slice(-f.digitBoxes!);
  }
  return out;
}

/** Document reading order for a list of fields: page → y → x. */
function docOrder(groups: LinkedGroup[]): LinkedGroup[] {
  return [...groups].sort((a, b) => {
    const fa = a.fields[0];
    const fb = b.fields[0];
    return fa.page - fb.page || fa.y - fb.y || fa.x - fb.x;
  });
}

export default function FillForm({
  template,
  emailAvailable,
  emailTarget,
  hasDefaultSignature,
}: {
  template: StoredTemplate;
  emailAvailable: boolean;
  emailTarget: string;
  hasDefaultSignature: boolean;
}) {
  const groups = useMemo(() => groupFields(template.fields ?? []), [template.fields]);
  const dateGroups = useMemo(
    () => groups.filter((g) => g.fields[0].kind === "date"),
    [groups]
  );
  const [values, setValues] = useState<Record<string, FieldValue>>(() =>
    defaultKwValues(template.fields ?? [])
  );
  const [sendEmail, setSendEmail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ---- saved drafts ----
  const [savedFills, setSavedFills] = useState<SavedFill[]>([]);
  const [draftName, setDraftName] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);

  // ---- date series (fills date fields with a range / calendar week) ----
  const [series, setSeries] = useState<Set<string> | null>(null); // null = all date groups
  const [seriesMode, setSeriesMode] = useState<"range" | "week">("range");
  const [seriesStart, setSeriesStart] = useState("");
  const [seriesEnd, setSeriesEnd] = useState("");
  const [seriesYear, setSeriesYear] = useState(() => String(isoWeekOf(new Date()).year));
  const [seriesWeek, setSeriesWeek] = useState(() => String(isoWeekOf(new Date()).week));
  const [showSeries, setShowSeries] = useState(true);

  // ---- auto-draft: persist to the server as the user types ----
  const hydratedRef = useRef(false);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load drafts once; restore the auto-draft's values if present.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/fills?templateId=${encodeURIComponent(template.id)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const fills = (data.fills ?? []) as SavedFill[];
        setSavedFills(fills);
        if (!hydratedRef.current) {
          hydratedRef.current = true;
          const auto = fills.find((f) => f.auto);
          // Merge (not replace): an auto-draft saved before a KW field
          // existed, or one that never touched it, shouldn't lose the
          // current-week default that's already showing.
          if (auto) setValues((v) => ({ ...v, ...(auto.values ?? {}) }));
        }
      } catch {
        if (!cancelled) hydratedRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [template.id]);

  // Debounced auto-save (upsert the user's single auto-draft for this template).
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (autoTimer.current) clearTimeout(autoTimer.current);
    autoTimer.current = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch("/api/fills", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ templateId: template.id, auto: true, values }),
          });
          if (!res.ok) return;
          const data = await res.json();
          setSavedFills((list) => [data.fill, ...list.filter((f) => !f.auto)]);
        } catch {
          /* ignore */
        }
      })();
    }, 800);
    return () => {
      if (autoTimer.current) clearTimeout(autoTimer.current);
    };
  }, [values, template.id]);

  const saveDraft = async () => {
    const name = draftName.trim();
    if (!name || savingDraft) return;
    setSavingDraft(true);
    setDraftError(null);
    try {
      const res = await fetch("/api/fills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: activeDraftId ?? undefined,
          templateId: template.id,
          name,
          values,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Speichern fehlgeschlagen.");
      setSavedFills((list) => [data.fill, ...list.filter((f) => f.id !== data.fill.id)]);
      setActiveDraftId(data.fill.id);
      setDraftName("");
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : "Speichern fehlgeschlagen.");
    } finally {
      setSavingDraft(false);
    }
  };

  const selectDraft = (fill: SavedFill) => {
    setValues(fill.values ?? {});
    setDraftName(fill.name);
    setActiveDraftId(fill.id);
    setError(null);
  };

  const deselectDraft = () => {
    setActiveDraftId(null);
    setDraftName("");
  };

  const deleteDraft = async (id: string) => {
    try {
      const res = await fetch(`/api/fills/${id}`, { method: "DELETE" });
      if (res.ok) {
        setSavedFills((list) => list.filter((f) => f.id !== id));
        if (activeDraftId === id) deselectDraft();
      }
    } catch {
      /* ignore */
    }
  };

  const pageGroups = useMemo(() => {
    const out: LinkedGroup[][] = Array.from({ length: template.pageCount }, () => []);
    for (const g of groups) {
      const page = g.fields[0].page;
      if (page >= 0 && page < template.pageCount) out[page].push(g);
      else out[0]?.push(g);
    }
    return out;
  }, [groups, template.pageCount]);

  const pageLayouts = useMemo(
    () => pageGroups.map((g) => buildPageLayout(g)),
    [pageGroups]
  );

  const setGroupValue = (group: LinkedGroup, next: FieldValue) => {
    setValues((v) => {
      const copy = { ...v };
      for (const f of group.fields) copy[f.id] = next;
      return copy;
    });
  };

  // ---- date series helpers ----
  const seriesKeys = useMemo(
    () => series ?? new Set(dateGroups.map((g) => g.key)),
    [series, dateGroups]
  );

  const toggleSeriesKey = (key: string) => {
    setSeries((prev) => {
      const base = prev ?? new Set(dateGroups.map((g) => g.key));
      const next = new Set(base);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAllSeries = () => setSeries(new Set(dateGroups.map((g) => g.key)));
  const clearSeries = () => setSeries(new Set());

  const selectedDateGroups = useMemo(
    () => docOrder(dateGroups.filter((g) => seriesKeys.has(g.key))),
    [dateGroups, seriesKeys]
  );

  const applyRange = () => {
    if (selectedDateGroups.length < 2 || !seriesStart || !seriesEnd) return;
    const start = new Date(seriesStart);
    const end = new Date(seriesEnd);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return;
    const dates: string[] = [];
    let cursor = new Date(start);
    while (cursor <= end && dates.length < selectedDateGroups.length) {
      dates.push(cursor.toISOString().slice(0, 10));
      cursor = new Date(cursor.getTime() + 86400000);
    }
    selectedDateGroups.forEach((g, i) => {
      if (dates[i]) setGroupValue(g, dates[i]);
    });
  };

  const applyWeek = () => {
    if (selectedDateGroups.length < 2) return;
    const year = parseInt(seriesYear, 10);
    const week = parseInt(seriesWeek, 10);
    if (!Number.isInteger(year) || !Number.isInteger(week) || week < 1 || week > 53) return;
    const dates = isoWeekDates(year, week, selectedDateGroups.length);
    selectedDateGroups.forEach((g, i) => {
      if (dates[i]) setGroupValue(g, dates[i]);
    });
  };

  const computedValues = useMemo(
    () => evaluateFormulas(template.fields ?? [], values),
    [template.fields, values]
  );

  const previewValues: PreviewValues = useMemo(
    () => computedValues as PreviewValues,
    [computedValues]
  );

  const jumpPreview = (page: number) => {
    const el = document.getElementById(`preview-page-${page}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const validate = (): string | null => {
    const seen = new Set<string>();
    for (const g of groups) {
      const f = g.fields[0];
      if (!f.required || seen.has(g.key)) continue;
      seen.add(g.key);
      if (isEmptyFieldValue(values[f.id])) {
        return `Bitte fülle das Feld „${f.label || "?"}" aus.`;
      }
    }
    return null;
  };

  const submit = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      const group = groups.find((g) => {
        const f = g.fields[0];
        return f.required && isEmptyFieldValue(values[f.id]);
      });
      if (group) jumpPreview(Math.min(group.fields[0].page, template.pageCount - 1));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/fill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: template.id, values, sendEmail }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Erzeugen fehlgeschlagen.");
      }
      const blob = await res.blob();
      const filename = resolveFilename(res.headers.get("Content-Disposition"));
      triggerDownload(blob, filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erzeugen fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">{template.name}</h1>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Form column */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="space-y-8"
        >
          {/* Saved drafts */}
          <section className="rounded-xl border border-line bg-surface p-4">
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-dim">
                Entwürfe
              </h2>
              <span className="text-xs text-ink-dim">wird automatisch gespeichert</span>
              {activeDraftId && (
                <button
                  type="button"
                  className="ml-auto text-xs text-ink-dim hover:text-ink"
                  onClick={deselectDraft}
                >
                  Auswahl aufheben
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="Entwurf benennen…"
                className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                disabled={!draftName.trim() || savingDraft}
                className="rounded-lg bg-accent-strong px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                onClick={() => void saveDraft()}
              >
                {savingDraft ? "Speichert…" : activeDraftId ? "Überschreiben" : "Speichern"}
              </button>
            </div>
            {draftError && <p className="mt-2 text-sm text-red-400">{draftError}</p>}
            {savedFills.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {savedFills.map((s) => {
                  const active = s.id === activeDraftId;
                  return (
                    <div
                      key={s.id}
                      className={`flex items-center gap-1 rounded-full border py-1 pl-3 pr-1 text-sm ${
                        active ? "border-accent bg-accent/10" : "border-line bg-canvas"
                      }`}
                    >
                      {s.auto && (
                        <span className="rounded-full bg-accent/20 px-1.5 text-[10px] font-semibold uppercase text-accent">
                          Auto
                        </span>
                      )}
                      <button
                        type="button"
                        className={`truncate ${active ? "text-accent" : "hover:text-accent"}`}
                        onClick={() => selectDraft(s)}
                        title={`${s.name} — ${new Date(s.updatedAt).toLocaleString()}`}
                      >
                        {s.name}
                      </button>
                      <button
                        type="button"
                        title="Entwurf löschen"
                        className="rounded-full px-1.5 text-red-400 hover:bg-surface-2"
                        onClick={() => void deleteDraft(s.id)}
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Date series: fill date fields with a range or calendar week */}
          {dateGroups.length >= 2 && (
            <section className="rounded-xl border border-line bg-surface p-4">
              <button
                type="button"
                className="flex w-full items-center justify-between"
                onClick={() => setShowSeries((s) => !s)}
              >
                <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-dim">
                  Datumsreihe
                </h2>
                <span className="text-ink-dim">{showSeries ? "−" : "+"}</span>
              </button>
              {showSeries && (
                <div className="mt-3 space-y-3">
                  <div className="inline-flex rounded-lg border border-line p-0.5">
                    <button
                      type="button"
                      onClick={() => setSeriesMode("range")}
                      className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                        seriesMode === "range" ? "bg-accent/20 text-accent" : "text-ink-dim hover:text-ink"
                      }`}
                    >
                      Zeitraum
                    </button>
                    <button
                      type="button"
                      onClick={() => setSeriesMode("week")}
                      className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                        seriesMode === "week" ? "bg-accent/20 text-accent" : "text-ink-dim hover:text-ink"
                      }`}
                    >
                      Woche (KW)
                    </button>
                  </div>

                  {seriesMode === "range" ? (
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="text-xs text-ink-dim">
                        Von
                        <DatePicker className="mt-1 w-36" value={seriesStart} onChange={setSeriesStart} />
                      </label>
                      <label className="text-xs text-ink-dim">
                        Bis
                        <DatePicker className="mt-1 w-36" value={seriesEnd} onChange={setSeriesEnd} />
                      </label>
                      <button
                        type="button"
                        disabled={!seriesStart || !seriesEnd}
                        className="rounded-lg bg-accent-strong px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
                        onClick={applyRange}
                      >
                        Anwenden
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="text-xs text-ink-dim">
                        Jahr
                        <input
                          type="number"
                          min={2000}
                          max={2100}
                          className="mt-1 block w-24 rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
                          value={seriesYear}
                          onChange={(e) => setSeriesYear(e.target.value)}
                        />
                      </label>
                      <label className="text-xs text-ink-dim">
                        KW
                        <input
                          type="number"
                          min={1}
                          max={53}
                          placeholder="z. B. 5"
                          className="mt-1 block w-28 rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
                          value={seriesWeek}
                          onChange={(e) => setSeriesWeek(e.target.value)}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={!seriesWeek}
                        className="rounded-lg bg-accent-strong px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
                        onClick={applyWeek}
                      >
                        Anwenden
                      </button>
                    </div>
                  )}

                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-xs text-ink-dim">
                        {selectedDateGroups.length} Datumsfelder (von oben nach unten)
                      </span>
                      <div className="flex gap-2 text-xs">
                        <button type="button" className="text-accent hover:underline" onClick={selectAllSeries}>
                          Alle
                        </button>
                        <button type="button" className="text-ink-dim hover:underline" onClick={clearSeries}>
                          Keine
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {dateGroups.map((g) => {
                        const checked = seriesKeys.has(g.key);
                        return (
                          <button
                            key={g.key}
                            type="button"
                            onClick={() => toggleSeriesKey(g.key)}
                            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                              checked
                                ? "border-accent bg-accent/20 text-accent"
                                : "border-line text-ink-dim hover:border-accent hover:text-ink"
                            }`}
                          >
                            {g.fields[0].label || "?"}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}

          {pageLayouts.map((layout, pageIndex) => {
            if (layout.general.length === 0 && layout.days.length === 0) return null;
            return (
              <section key={pageIndex} className="rounded-xl border border-line bg-surface p-4">
                <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-ink-dim">
                  Seite {pageIndex + 1}
                </h2>

                {layout.general.length > 0 && (
                  <div className="flex flex-col space-y-4">
                    {layout.general.map((group) => (
                      <FieldControl
                        key={group.fields[0].id}
                        group={group}
                        value={computedValues[group.fields[0].id]}
                        hasDefaultSignature={hasDefaultSignature}
                        linked={group.fields.length > 1}
                        onFocus={() => jumpPreview(pageIndex)}
                        onChange={(v) => setGroupValue(group, v)}
                      />
                    ))}
                  </div>
                )}

                {groupDayBlocks(layout.days).map((block, i) =>
                  block.type === "full" ? (
                    <div key={block.day.key} className="mt-6">
                      <h4 className="mb-2 text-sm font-semibold">{block.day.label}</h4>
                      <div
                        className="grid gap-4"
                        style={{ gridTemplateColumns: `repeat(${block.cols.length}, minmax(0, 1fr))` }}
                      >
                        {block.cols.map((col) => {
                          const group = block.day.columns[col]!;
                          return (
                            <FieldControl
                              key={col}
                              group={group}
                              value={computedValues[group.fields[0].id]}
                              hasDefaultSignature={hasDefaultSignature}
                              linked={group.fields.length > 1}
                              labelOverride={COLUMN_LABELS[col]}
                              onFocus={() => jumpPreview(pageIndex)}
                              onChange={(v) => setGroupValue(group, v)}
                            />
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    // Days that only carry a single column (typically just a
                    // date) share one compact row instead of each burning a
                    // full-width grid row with mostly empty space.
                    <div key={`simple-${i}`} className="mt-6 flex flex-wrap gap-4">
                      {block.days.map(({ day, col }) => {
                        const group = day.columns[col]!;
                        return (
                          <div key={day.key} className="w-40">
                            <FieldControl
                              group={group}
                              value={computedValues[group.fields[0].id]}
                              hasDefaultSignature={hasDefaultSignature}
                              linked={group.fields.length > 1}
                              labelOverride={day.label}
                              onFocus={() => jumpPreview(pageIndex)}
                              onChange={(v) => setGroupValue(group, v)}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )
                )}
              </section>
            );
          })}

          {emailAvailable && (
            <label className="flex items-start gap-2 rounded-xl border border-line bg-surface p-4 text-sm">
              <input
                type="checkbox"
                checked={sendEmail}
                onChange={(e) => setSendEmail(e.target.checked)}
                className="mt-1"
              />
              <span>
                Ausgefülltes PDF per E-Mail senden
                <span className="block text-xs text-ink-dim">
                  Ziel: {emailTarget}
                </span>
              </span>
            </label>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-accent-strong px-6 py-2.5 font-semibold text-white"
          >
            {busy ? "Erzeuge PDF…" : "PDF herunterladen"}
          </button>
        </form>

        {/* Sticky preview column: the real PDF with filled values on top */}
        <div className="hidden lg:block">
          <div className="sticky top-24 space-y-6 self-start">
            {Array.from({ length: template.pageCount }, (_, i) => (
              <div
                key={i}
                id={`preview-page-${i}`}
                className="overflow-hidden rounded-lg border border-line"
              >
                <p className="border-b border-line bg-surface px-3 py-1 text-xs text-ink-dim">
                  Seite {i + 1}
                </p>
                <PagePreview
                  pdfUrl={`/api/templates/${template.id}/pdf?v=${encodeURIComponent(template.updatedAt)}`}
                  pageIndex={i}
                  pageSize={template.pageSizes[i] ?? { width: 612, height: 792 }}
                  fields={(template.fields ?? []).filter((f) => f.page === i)}
                  values={previewValues}
                  rotation={template.pageRotations?.[i] ?? 0}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function FieldControl({
  group,
  value,
  hasDefaultSignature,
  linked,
  labelOverride,
  onFocus,
  onChange,
}: {
  group: LinkedGroup;
  value: FieldValue;
  hasDefaultSignature: boolean;
  linked: boolean;
  labelOverride?: string;
  onFocus: () => void;
  onChange: (value: FieldValue) => void;
}) {
  const f = group.fields[0];
  const label = labelOverride ?? f.label ?? "Feld";

  const control = (() => {
    if (f.formula) {
      const text = typeof value === "string" ? value : "";
      return (
        <div
          className="flex h-9 items-center rounded-lg border border-dashed border-line bg-surface-2/50 px-3 text-sm tabular-nums text-ink"
          title="Automatisch berechnet (Formel)"
        >
          {text || "—"}
        </div>
      );
    }
    switch (f.kind) {
      case "text":
        if (f.digitBoxes && f.digitBoxes > 1) {
          return (
            <input
              type="text"
              inputMode="numeric"
              maxLength={f.digitBoxes}
              placeholder={"_".repeat(f.digitBoxes)}
              title={`${f.digitBoxes}-stellig, z. B. Kalenderwoche`}
              className="w-24 rounded-lg border border-line bg-canvas px-3 py-2 text-center font-mono text-sm tracking-[0.3em] focus:border-accent focus:outline-none"
              value={typeof value === "string" ? value : ""}
              onFocus={onFocus}
              onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, f.digitBoxes))}
            />
          );
        }
        return (
          <input
            type="text"
            className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm focus:border-accent focus:outline-none"
            value={typeof value === "string" ? value : ""}
            onFocus={onFocus}
            onChange={(e) => onChange(String(e.target.value))}
          />
        );
      case "date":
        return (
          <DatePicker
            value={typeof value === "string" ? value : ""}
            onFocus={onFocus}
            onChange={(v) => onChange(v)}
          />
        );
      case "multiline":
        return (
          <textarea
            rows={Math.max(3, Math.round(f.height / 18))}
            className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm focus:border-accent focus:outline-none"
            value={typeof value === "string" ? value : ""}
            onFocus={onFocus}
            onChange={(e) => onChange(String(e.target.value))}
          />
        );
      case "checkbox":
        return (
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={typeof value === "boolean" ? value : value === "true" || value === "1" || value === "on"}
            onFocus={onFocus}
            onChange={(e) => onChange(e.target.checked)}
          />
        );
      case "signature":
        return (
          <SignatureInput
            value={typeof value === "string" ? value : null}
            hasDefaultSignature={hasDefaultSignature}
            onChange={(d) => onChange(d ?? undefined)}
          />
        );
      case "matrix":
        return (
          <MatrixInput
            field={f}
            value={
              typeof value === "object" && value
                ? (value as MatrixSelection)
                : {}
            }
            onChange={(sel) => onChange(sel)}
          />
        );
      default:
        return null;
    }
  })();

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <label className="text-sm font-medium" htmlFor={f.id}>
          {label}
        </label>
        {f.required && <span className="text-sm text-red-400">*</span>}
        {linked && (
          <span
            className="text-xs text-accent"
            title="Ein Wert füllt alle verknüpften Felder im Dokument"
          >
            🔗 {group.fields.length}×
          </span>
        )}
      </div>
      <div id={f.id}>{control}</div>
    </div>
  );
}

function isEmptyFieldValue(value: FieldValue): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (typeof value === "boolean") return false;
  if (typeof value === "object") return Object.values(value).every((v) => v !== true);
  return false;
}

function resolveFilename(disposition: string | null): string {
  const utf8 = disposition?.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      /* fall through */
    }
  }
  const plain = disposition?.match(/filename="([^"]+)"/i);
  return plain?.[1] ?? "dokument.pdf";
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
