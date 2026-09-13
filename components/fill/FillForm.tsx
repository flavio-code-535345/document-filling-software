"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FieldValue, SavedFill, StoredTemplate, TemplateField } from "@/lib/types";
import { evaluateFormulas } from "@/lib/formula";
import { expandFieldsForRepeat } from "@/lib/editor-utils";
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

/**
 * JavaScript's `\b` word boundary is ASCII-only: it treats "ä ö ü ß" (and
 * other accented letters) as non-word characters, so a word like
 * "Frühschicht" reads to `\b` as two tokens, "Fr" + "ühschicht" — letting a
 * bare two-letter day abbreviation like "fr" (Freitag) match *inside* an
 * unrelated German word purely because an umlaut happens to follow it. Build
 * day/column regexes with this Unicode-aware boundary instead, so a match
 * requires an actual accented-letter-aware word boundary on both sides.
 */
const DE_WORD_CHAR = "[A-Za-zÀ-ÖØ-öø-ÿ]";
function deWordRe(alternatives: string): RegExp {
  return new RegExp(`(?<!${DE_WORD_CHAR})(?:${alternatives})(?!${DE_WORD_CHAR})`, "i");
}

const DAY_DEFS: { key: string; label: string; re: RegExp }[] = [
  { key: "mo", label: "Montag", re: deWordRe("montag|mo") },
  { key: "di", label: "Dienstag", re: deWordRe("dienstag|di") },
  { key: "mi", label: "Mittwoch", re: deWordRe("mittwoch|mi") },
  { key: "do", label: "Donnerstag", re: deWordRe("donnerstag|do") },
  { key: "fr", label: "Freitag", re: deWordRe("freitag|fr") },
  { key: "sa", label: "Samstag", re: deWordRe("samstag|sa") },
  { key: "so", label: "Sonntag", re: deWordRe("sonntag|so") },
];

/** Resolve a field label to a day-of-week key ("mo"…"so"), or null. */
function detectDay(label: string): string | null {
  for (const d of DAY_DEFS) if (d.re.test(label)) return d.key;
  return null;
}

/** Resolve a field label to one of the five timesheet columns, or null. */
function detectColumn(label: string): TimesheetColumn | null {
  const l = label.toLowerCase();
  if (deWordRe("datum").test(l)) return "datum";
  if (deWordRe("von|beginn|start|anfang").test(l)) return "von";
  if (deWordRe("bis|ende").test(l)) return "bis";
  if (deWordRe("pause").test(l)) return "pause";
  if (deWordRe("stunden|arbeitszeit|gesamt").test(l)) return "stunden";
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

/**
 * ISO-8601 dates of a calendar week (Monday-first), starting from `week`.
 * `count` isn't capped at 7 — a document with more than one week's worth of
 * date fields (e.g. a duplex two-week timesheet) just keeps counting into
 * the following week(s), Monday-first throughout.
 */
function isoWeekDates(year: number, week: number, count: number): string[] {
  const jan4 = Date.UTC(year, 0, 4);
  const dow = new Date(jan4).getUTCDay();
  const week1Monday = jan4 - ((dow + 6) % 7) * 86400000;
  const monday = week1Monday + (week - 1) * 7 * 86400000;
  const out: string[] = [];
  for (let i = 0; i < Math.max(0, count); i++) {
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

/**
 * Turns a 0-based rank among candidates into a whole-week day offset.
 * Shared by the KW-box defaults and the Datumsreihe panels so "which page
 * gets which week" stays in sync between them.
 *
 * `groupSize` is how many ranked entries one Endlos-Modus block contributes
 * (e.g. 2 for a Früh-/Spätschicht duplex sheet, 1 for a single-shift
 * template) — `swap` reverses rank only *within* each block's own group
 * instead of across the whole document. A page is a duplex sheet's front
 * or back, and "page order = week order" only holds for half of an
 * alternating rotation: some fortnights the front page is actually next
 * week's shift, not this week's. Reversing globally (this function's first
 * version) meant the *block a given week landed in* moved depending on
 * total block count — with several Endlos-Modus blocks, "this week" could
 * end up on the very last page, forcing a scroll past every other block to
 * reach it. Swapping only within each block keeps the block-to-block
 * progression (block 0 = the soonest weeks, block 1 = the next ones, …)
 * identical either way — only which page within a given block gets the
 * earlier of its weeks changes.
 */
function weekOffsetForRank(rank: number, groupSize: number, swap: boolean): number {
  if (!swap || groupSize <= 1) return rank * 7;
  const blockIndex = Math.floor(rank / groupSize);
  const withinBlock = rank % groupSize;
  return (blockIndex * groupSize + (groupSize - 1 - withinBlock)) * 7;
}

/**
 * Defaults every KW field to the current ISO week, so the form opens already
 * showing "this week" instead of blank boxes. A document can carry more than
 * one KW field (e.g. a duplex two-week Früh-/Spätschicht sheet, one KW box
 * per page/week) — those are numbered in document order, one week apart, so
 * the first box gets the current week, the second the following week, and so
 * on (or reversed, if `swap` is set), correctly rolling over a year
 * boundary. Only ever used as an initial/fallback value — a loaded draft's
 * own values still win, unless the template is in "Tätigkeitsnachweis-Modus"
 * (see `StoredTemplate.autoCurrentWeek`), which re-applies this over the
 * draft on purpose.
 */
function defaultKwValues(fields: TemplateField[], swap: boolean, weekBlocks: number): Record<string, FieldValue> {
  const kwFields = fields
    .filter(isKwField)
    .sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  // How many KW fields one Endlos-Modus block contributes — always uniform
  // across blocks, since every block is an exact repeat of the original
  // field set. See weekOffsetForRank for why `swap` needs this.
  const groupSize = kwFields.length / weekBlocks;
  const today = new Date();
  const out: Record<string, FieldValue> = {};
  kwFields.forEach((f, i) => {
    const offsetDays = weekOffsetForRank(i, groupSize, swap);
    const { week } = isoWeekOf(new Date(today.getTime() + offsetDays * 86400000));
    out[f.id] = String(week).padStart(f.digitBoxes!, "0").slice(-f.digitBoxes!);
  });
  return out;
}

/**
 * The date-field equivalent of `defaultKwValues`, for "Tätigkeitsnachweis-
 * Modus": computes the current/next ISO week's Mon-first dates for each
 * page's date fields (same rank/swap/offset logic as the KW boxes) and
 * writes them onto every field in each linked group, so it overrides a
 * saved draft's stale dates exactly like the KW boxes already do.
 */
function freshDateValues(
  dateGroupsByPage: { page: number; groups: LinkedGroup[] }[],
  swap: boolean,
  weekBlocks: number
): Record<string, FieldValue> {
  const groupSize = dateGroupsByPage.length / weekBlocks;
  const out: Record<string, FieldValue> = {};
  dateGroupsByPage.forEach(({ groups: pageGroups }, i) => {
    const offsetDays = weekOffsetForRank(i, groupSize, swap);
    const { year, week } = isoWeekOf(new Date(Date.now() + offsetDays * 86400000));
    const dates = isoWeekDates(year, week, pageGroups.length);
    pageGroups.forEach((g, j) => {
      if (!dates[j]) return;
      for (const f of g.fields) out[f.id] = dates[j];
    });
  });
  return out;
}

/** Seeds every field that has a configured `defaultValue` (e.g. a shift's
 * usual Von/Bis/Pause/Normalstd), so recurring values don't need retyping on
 * every fill. Only used as an initial/fallback value — a loaded draft's own
 * values, or a value the user already typed, still win. */
function defaultStaticValues(fields: TemplateField[]): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  for (const f of fields) {
    if (f.defaultValue) out[f.id] = f.defaultValue;
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
  // "Endlos-Modus", but temporary and per-export rather than a change to the
  // template itself: 1 = fill the document as stored; each extra block
  // previews (and, on submit, exports) the entire page set repeated once
  // more — the same expansion the admin "repeat pages" tool uses, just
  // computed locally instead of persisted, so nothing here touches the
  // saved template and setting it back to 1 undoes it instantly.
  const [weekBlocks, setWeekBlocks] = useState(1);
  const effectiveFields = useMemo(
    () =>
      weekBlocks > 1
        ? expandFieldsForRepeat(template.fields ?? [], template.pageCount, weekBlocks - 1)
        : template.fields ?? [],
    [template.fields, template.pageCount, weekBlocks]
  );
  const effectivePageCount = template.pageCount * weekBlocks;

  const groups = useMemo(() => groupFields(effectiveFields), [effectiveFields]);
  const dateGroups = useMemo(
    () => groups.filter((g) => g.fields[0].kind === "date"),
    [groups]
  );
  /** Date fields split by page, each in document order — the unit a single
   * date-series panel operates on (see `showAdvanced` below). */
  const dateGroupsByPage = useMemo(() => {
    const byPage = new Map<number, LinkedGroup[]>();
    for (const g of dateGroups) {
      const page = g.fields[0].page;
      if (!byPage.has(page)) byPage.set(page, []);
      byPage.get(page)!.push(g);
    }
    return [...byPage.entries()]
      .sort(([a], [b]) => a - b)
      .map(([page, pageGroups]) => ({ page, groups: docOrder(pageGroups) }))
      .filter(({ groups: g }) => g.length >= 2);
  }, [dateGroups]);

  // Swaps which page defaults to "this week" vs. "next week" (KW boxes and
  // Datumsreihe panels alike) — for when an alternating rotation happens to
  // have the earlier page's shift land on the later week this fortnight.
  // Persisted per template so it's a once-every-two-weeks flip, not a
  // per-visit chore. Starts false (SSR-safe) and is corrected from
  // localStorage in an effect after mount — see the footgun this avoids in
  // AGENTS.md ("never read localStorage in a lazy useState initializer").
  const [swapWeeks, setSwapWeeks] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(`docflow:swapWeeks:${template.id}`) === "1") setSwapWeeks(true);
    } catch {
      /* ignore */
    }
  }, [template.id]);
  // The async draft-load effect below only runs once per template (it must
  // not re-fetch drafts every time the toggle flips), so it can't just
  // close over `swapWeeks` — that would freeze it at whatever it was on
  // mount (almost always false, since the localStorage restore above lands
  // a moment later) and then clobber a subsequent swap back to unswapped
  // once the fetch resolves. Read the live value from this ref instead.
  const swapWeeksRef = useRef(swapWeeks);
  useEffect(() => {
    swapWeeksRef.current = swapWeeks;
  }, [swapWeeks]);
  const toggleSwapWeeks = () => {
    setSwapWeeks((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(`docflow:swapWeeks:${template.id}`, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const [values, setValues] = useState<Record<string, FieldValue>>(() => ({
    ...defaultStaticValues(effectiveFields),
    ...defaultKwValues(effectiveFields, swapWeeks, weekBlocks),
    ...(template.autoCurrentWeek ? freshDateValues(dateGroupsByPage, swapWeeks, weekBlocks) : {}),
  }));
  const [sendEmail, setSendEmail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ---- saved drafts ----
  const [savedFills, setSavedFills] = useState<SavedFill[]>([]);
  const [draftName, setDraftName] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);

  // ---- date series (fills a page's date fields with a range / calendar week) ----
  // Grouped per page rather than one flat list across the whole document: a
  // duplex two-shift sheet has an unrelated week of dates on each page (this
  // week's Frühschicht, next week's Spätschicht), so one shared Von/Bis or
  // KW picker for every date field at once would force them onto the same
  // (or a manually-offset) range. Each qualifying page gets its own
  // independent panel instead — see `DateSeriesPanel` below.
  //
  // showAdvanced also gates Endlos-Modus (weekBlocks) below — both are
  // "shape the document before filling it in" decisions, collapsed by
  // default in one shared "Erweiterte Optionen" section: the KW/date
  // defaults already showing are right often enough that this doesn't need
  // to dominate the page every time, and it's one click away, not gone.
  const [showAdvanced, setShowAdvanced] = useState(false);

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
          if (auto) {
            setValues((v) => {
              const merged = { ...v, ...(auto.values ?? {}) };
              // Tätigkeitsnachweis-Modus: the whole point is to never show a
              // stale week again, so the fresh KW/date values win over
              // whatever this draft happened to have saved for them.
              if (!template.autoCurrentWeek) return merged;
              return {
                ...merged,
                ...defaultKwValues(effectiveFields, swapWeeksRef.current, weekBlocks),
                ...freshDateValues(dateGroupsByPage, swapWeeksRef.current, weekBlocks),
              };
            });
          }
        }
      } catch {
        if (!cancelled) hydratedRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [template.id]);

  // Re-derive the KW boxes (always) and the date fields (only in
  // Tätigkeitsnachweis-Modus) whenever the week assignment is swapped, or
  // the temporary week-block count changes (a newly-revealed block's KW/date
  // fields need their own defaults too) — so both are a one-click fix
  // instead of also having to manually re-apply every Datumsreihe panel.
  // defaultStaticValues goes in *underneath* the current values (spread
  // first) rather than overriding them, so growing weekBlocks backfills a
  // new block's defaultValue fields (e.g. a shift's usual Von/Bis/Pause)
  // without clobbering anything already showing on the original pages —
  // those keep whatever's already there (an earlier default, or the user's
  // own edit); only fields with no entry at all pick up their default here.
  useEffect(() => {
    setValues((v) => ({
      ...defaultStaticValues(effectiveFields),
      ...v,
      ...defaultKwValues(effectiveFields, swapWeeks, weekBlocks),
      ...(template.autoCurrentWeek ? freshDateValues(dateGroupsByPage, swapWeeks, weekBlocks) : {}),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swapWeeks, weekBlocks]);

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
    const out: LinkedGroup[][] = Array.from({ length: effectivePageCount }, () => []);
    for (const g of groups) {
      const page = g.fields[0].page;
      if (page >= 0 && page < effectivePageCount) out[page].push(g);
      else out[0]?.push(g);
    }
    return out;
  }, [groups, effectivePageCount]);

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

  const computedValues = useMemo(
    () => evaluateFormulas(effectiveFields, values),
    [effectiveFields, values]
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
      if (group) jumpPreview(Math.min(group.fields[0].page, effectivePageCount - 1));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/fill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: template.id, values, sendEmail, weekBlocks }),
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
              {template.autoCurrentWeek && (
                <span
                  className="rounded-full border border-accent/60 bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent"
                  title="KW-Ziffernboxen und Datumsfelder werden bei jedem Öffnen automatisch auf die aktuelle/nächste Kalenderwoche gesetzt, unabhängig vom gespeicherten Entwurf."
                >
                  🗓 Tätigkeitsnachweis-Modus
                </span>
              )}
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

          {/* Everything that shapes the document before you fill it in
              (how many weeks, which calendar week each page defaults to)
              lives here, collapsed by default and ahead of the per-page
              fields — setting "Anzahl Blöcke" reveals new Seite N sections
              below, so deciding this first (rather than at the bottom, past
              everything you'd have to scroll back up to) is the point. */}
          <section className="rounded-xl border border-line bg-surface p-4">
            <button
              type="button"
              className="flex w-full items-center justify-between"
              onClick={() => setShowAdvanced((s) => !s)}
            >
              <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-dim">
                Erweiterte Optionen
              </h2>
              <span className="text-ink-dim">{showAdvanced ? "−" : "+"}</span>
            </button>
            {showAdvanced && (
              <div className="mt-3 space-y-6">
                <div>
                  <h3 className="mb-1 text-xs font-semibold text-accent">Endlos-Modus</h3>
                  <p className="mb-2 text-xs text-ink-dim">
                    Wiederholt das ganze Dokument nur für diesen Download — die Vorlage selbst bleibt
                    unverändert. Zurück auf 1 macht es sofort rückgängig.
                  </p>
                  <label className="flex items-center gap-2 text-sm">
                    Anzahl Blöcke
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={weekBlocks}
                      onChange={(e) => {
                        const n = Math.round(Number(e.target.value));
                        setWeekBlocks(Number.isFinite(n) ? Math.min(10, Math.max(1, n)) : 1);
                      }}
                      className="h-8 w-14 rounded-lg border border-line bg-canvas px-1.5 text-center focus:border-accent focus:outline-none"
                      title={`${weekBlocks}× das komplette Dokument (${template.pageCount} Seite(n)) = ${effectivePageCount} Seiten in diesem Download`}
                    />
                    <span className="text-xs text-ink-dim">= {effectivePageCount} Seiten in diesem Download</span>
                  </label>
                </div>

                {dateGroupsByPage.length > 0 && (
                  <div>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h3 className="text-xs font-semibold text-accent">Datumsreihe</h3>
                      {dateGroupsByPage.length > 1 && (
                        <button
                          type="button"
                          onClick={toggleSwapWeeks}
                          title="Vertauscht, welche Seite die aktuelle bzw. die nächste Kalenderwoche vorschlägt — praktisch bei abwechselnder Früh-/Spätschicht, wenn diese Woche zufällig die spätere Seite betrifft."
                          className={`shrink-0 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                            swapWeeks
                              ? "border-accent bg-accent/20 text-accent"
                              : "border-line text-ink-dim hover:border-accent hover:text-ink"
                          }`}
                        >
                          🔄 Wochen tauschen
                        </button>
                      )}
                    </div>
                    <div className="space-y-5">
                      {dateGroupsByPage.map(({ page, groups: pageGroups }, i) => (
                        <DateSeriesPanel
                          key={`${page}-${swapWeeks}`}
                          groups={pageGroups}
                          label={dateGroupsByPage.length > 1 ? `Seite ${page + 1}` : undefined}
                          weekOffsetDays={weekOffsetForRank(i, dateGroupsByPage.length / weekBlocks, swapWeeks)}
                          onApply={setGroupValue}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

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
            {Array.from({ length: effectivePageCount }, (_, i) => {
              // Beyond the template's own pageCount, a virtual page is just
              // the same underlying PDF page rendered again — the file on
              // disk was never expanded, only the field list was (locally).
              const sourcePage = i % template.pageCount;
              return (
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
                    pageIndex={sourcePage}
                    pageSize={template.pageSizes[sourcePage] ?? { width: 612, height: 792 }}
                    fields={effectiveFields.filter((f) => f.page === i)}
                    values={previewValues}
                    rotation={template.pageRotations?.[sourcePage] ?? 0}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One page's independent "fill a range/week of dates" control — pulled out
 * of FillForm so each qualifying page (see `dateGroupsByPage`) gets its own
 * mode/selection/inputs instead of one shared picker trying to cover every
 * date field in the document at once. `weekOffsetDays` staggers the initial
 * "Woche (KW)" guess so a second/third panel defaults to the following
 * week(s) rather than repeating the first panel's week, matching how the KW
 * digit-box fields themselves default (see `defaultKwValues`).
 */
function DateSeriesPanel({
  groups,
  label,
  weekOffsetDays = 0,
  onApply,
}: {
  groups: LinkedGroup[]; // this page's date groups, already in document order, length >= 2
  label?: string;
  weekOffsetDays?: number;
  onApply: (group: LinkedGroup, value: FieldValue) => void;
}) {
  const [series, setSeries] = useState<Set<string> | null>(null); // null = all groups on this page
  const [mode, setMode] = useState<"range" | "week">("range");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const defaultWeek = useMemo(() => isoWeekOf(new Date(Date.now() + weekOffsetDays * 86400000)), [weekOffsetDays]);
  const [year, setYear] = useState(() => String(defaultWeek.year));
  const [week, setWeek] = useState(() => String(defaultWeek.week));

  const keys = series ?? new Set(groups.map((g) => g.key));
  const toggleKey = (key: string) => {
    setSeries((prev) => {
      const base = prev ?? new Set(groups.map((g) => g.key));
      const next = new Set(base);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const selected = useMemo(() => groups.filter((g) => keys.has(g.key)), [groups, keys]);
  const allSelected = selected.length === groups.length;
  const [showFieldPicker, setShowFieldPicker] = useState(false);

  const applyRange = () => {
    if (selected.length < 2 || !start || !end) return;
    const s = new Date(start);
    const e = new Date(end);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || s > e) return;
    const dates: string[] = [];
    let cursor = new Date(s);
    while (cursor <= e && dates.length < selected.length) {
      dates.push(cursor.toISOString().slice(0, 10));
      cursor = new Date(cursor.getTime() + 86400000);
    }
    selected.forEach((g, i) => {
      if (dates[i]) onApply(g, dates[i]);
    });
  };

  const applyWeek = () => {
    if (selected.length < 2) return;
    const y = parseInt(year, 10);
    const w = parseInt(week, 10);
    if (!Number.isInteger(y) || !Number.isInteger(w) || w < 1 || w > 53) return;
    const dates = isoWeekDates(y, w, selected.length);
    selected.forEach((g, i) => {
      if (dates[i]) onApply(g, dates[i]);
    });
  };

  return (
    <div>
      {label && <h3 className="mb-2 text-xs font-semibold text-accent">{label}</h3>}
      <div className="space-y-3">
        <div className="inline-flex rounded-lg border border-line p-0.5">
          <button
            type="button"
            onClick={() => setMode("range")}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              mode === "range" ? "bg-accent/20 text-accent" : "text-ink-dim hover:text-ink"
            }`}
          >
            Zeitraum
          </button>
          <button
            type="button"
            onClick={() => setMode("week")}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              mode === "week" ? "bg-accent/20 text-accent" : "text-ink-dim hover:text-ink"
            }`}
          >
            Woche (KW)
          </button>
        </div>

        {mode === "range" ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-ink-dim">
              Von
              <DatePicker className="mt-1 w-36" value={start} onChange={setStart} />
            </label>
            <label className="text-xs text-ink-dim">
              Bis
              <DatePicker className="mt-1 w-36" value={end} onChange={setEnd} />
            </label>
            <button
              type="button"
              disabled={!start || !end}
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
                value={year}
                onChange={(e) => setYear(e.target.value)}
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
                value={week}
                onChange={(e) => setWeek(e.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={!week}
              className="rounded-lg bg-accent-strong px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
              onClick={applyWeek}
            >
              Anwenden
            </button>
          </div>
        )}

        <div>
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-ink-dim hover:text-ink"
            onClick={() => setShowFieldPicker((s) => !s)}
          >
            <span>{showFieldPicker ? "▾" : "▸"}</span>
            {allSelected ? `Alle ${groups.length} Datumsfelder` : `${selected.length} von ${groups.length} Datumsfeldern`}
            {" · Felder anpassen"}
          </button>
          {showFieldPicker && (
            <div className="mt-2">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs text-ink-dim">von oben nach unten</span>
                <div className="flex gap-2 text-xs">
                  <button
                    type="button"
                    className="text-accent hover:underline"
                    onClick={() => setSeries(new Set(groups.map((g) => g.key)))}
                  >
                    Alle
                  </button>
                  <button type="button" className="text-ink-dim hover:underline" onClick={() => setSeries(new Set())}>
                    Keine
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {groups.map((g) => {
                  const checked = keys.has(g.key);
                  return (
                    <button
                      key={g.key}
                      type="button"
                      onClick={() => toggleKey(g.key)}
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
          )}
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
