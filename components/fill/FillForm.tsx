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

/** The Monday of a given ISO week, as a Date — for adding/subtracting whole
 * weeks (e.g. deriving every other Datumsreihe panel's week from the anchor
 * panel's). */
function mondayOfIsoWeek(year: number, week: number): Date {
  return new Date(isoWeekDates(year, week, 1)[0]);
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
 * Turns a 0-based rank among candidates into a whole-week offset *from
 * whichever page is currently the anchor* — always a forward count (0, 1,
 * 2, …), never negative. Shared by the KW-box defaults and the Datumsreihe
 * panels so "which page gets which week" stays in sync between them.
 *
 * `groupSize` is how many ranked entries one Endlos-Modus block contributes
 * (e.g. 2 for a Früh-/Spätschicht duplex sheet, 1 for a single-shift
 * template) — a page is a duplex sheet's front or back, and each block
 * covers `groupSize` consecutive weeks, one per page in the block.
 *
 * `swap` moves *which slot within each block* is the anchor slot (slot 0
 * unswapped, the last slot when swapped) — every other slot in the same
 * block is still always some whole number of weeks *after* the anchor slot,
 * counting forward cyclically (`(slot - anchorSlot + groupSize) % groupSize`),
 * never before it. So the anchor's own literal, typed value never has to
 * move to make room for a swap — only which physical page *holds* that
 * value, and which pages count forward from it, changes. An earlier version
 * kept the anchor slot fixed at 0 and pushed the *other* slot backward by a
 * week when swapped (e.g. anchor page showing 38 next to a swapped partner
 * showing 37) — mathematically fine, but it reads as nonsense to a real
 * admin: "swap" so the late shift starts at KW 38 should mean *retyping
 * nothing and just watching KW 38 move to the late-shift page*, landing on
 * the exact same pair of weeks {38, 39} either way — not conjuring a
 * different window of weeks like {37, 38} out of a toggle.
 */
function weekOffsetForRank(rank: number, groupSize: number, swap: boolean): number {
  if (groupSize <= 1) return rank;
  const anchorSlot = swap ? groupSize - 1 : 0;
  const blockIndex = Math.floor(rank / groupSize);
  const slot = rank % groupSize;
  const slotOffset = (slot - anchorSlot + groupSize) % groupSize;
  return blockIndex * groupSize + slotOffset;
}

/**
 * The ISO week a given page rank resolves to, once the anchor (the current
 * anchor page's Jahr/KW — see `anchorPageRank` in `FillForm`) and the
 * swap/groupSize scheme are known. Shared by the KW-box defaults, the
 * automatic date refresh, and the Datumsreihe panels' own rendering so all
 * three always agree on which week a given page shows — they used to each
 * recompute their own offset from `today` independently, which is what let
 * a page's KW box(es) disagree with its own Datumsreihe panel, and even
 * with each other when a page carries more than one KW field (e.g.
 * separate Früh-/Spätschicht boxes for what is otherwise the same week).
 * `weekOffsetForRank`'s result is already relative to the anchor (0 for the
 * anchor page itself), so there's no separate "anchor offset" to subtract.
 */
function weekForRank(
  rank: number,
  groupSize: number,
  swap: boolean,
  anchor: { year: number; week: number }
): { year: number; week: number } {
  const relativeWeeks = weekOffsetForRank(rank, groupSize, swap);
  const date = new Date(mondayOfIsoWeek(anchor.year, anchor.week).getTime() + relativeWeeks * 7 * 86400000);
  return isoWeekOf(date);
}

/**
 * Defaults every KW field to its page's week in the shared anchor cascade
 * (see `weekForRank`), so the form opens already showing "this week" instead
 * of blank boxes. Fields are ranked and grouped by *page* — via
 * `weekPageRank`, the same page ranking the Datumsreihe panels use — not
 * individually, so two KW boxes on the very same page (e.g. a duplex
 * Früh-/Spätschicht sheet's two subtotal blocks for one shared week) always
 * agree instead of being treated as separate, one-week-apart entries. Only
 * ever used as an initial/fallback value — a loaded draft's own values still
 * win, unless the template is in "Tätigkeitsnachweis-Modus" (see
 * `StoredTemplate.autoCurrentWeek`) or the anchor/swap/block-count just
 * changed, both of which re-apply this over the draft on purpose.
 */
function defaultKwValues(
  fields: TemplateField[],
  swap: boolean,
  weekPageRank: Map<number, number>,
  groupSize: number,
  anchor: { year: number; week: number }
): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  for (const f of fields) {
    if (!isKwField(f)) continue;
    const rank = weekPageRank.get(f.page) ?? 0;
    const { week } = weekForRank(rank, groupSize, swap, anchor);
    out[f.id] = String(week).padStart(f.digitBoxes!, "0").slice(-f.digitBoxes!);
  }
  return out;
}

/**
 * The date-field equivalent of `defaultKwValues`, for "Tätigkeitsnachweis-
 * Modus": computes the anchor cascade's Mon-first dates for each page's date
 * fields (same shared `weekForRank` as the KW boxes and the Datumsreihe
 * panels) and writes them onto every field in each linked group, so it
 * overrides a saved draft's stale dates exactly like the KW boxes already
 * do — and so editing the anchor refreshes the actual date values, not just
 * the panels' displayed Jahr/KW.
 *
 * `seriesByPage` is the same per-page field selection the Datumsreihe
 * panel's checkboxes drive (lifted up to FillForm so both can see it) — a
 * group deselected there (e.g. "I don't work Saturdays") is skipped here
 * too, instead of Tätigkeitsnachweis-Modus silently re-filling it on every
 * refresh regardless of what the panel says. The full week is always
 * computed over *every* group first and only then filtered down to the
 * included ones, so excluding a day in the middle of the week doesn't
 * shift the following days' dates by one slot.
 */
function freshDateValues(
  dateGroupsByPage: { page: number; groups: LinkedGroup[] }[],
  swap: boolean,
  weekPageRank: Map<number, number>,
  groupSize: number,
  anchor: { year: number; week: number },
  seriesByPage: Record<number, Set<string> | null>
): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  dateGroupsByPage.forEach(({ page, groups: pageGroups }) => {
    const rank = weekPageRank.get(page) ?? 0;
    const { year, week } = weekForRank(rank, groupSize, swap, anchor);
    const dates = isoWeekDates(year, week, pageGroups.length);
    const selection = seriesByPage[page];
    pageGroups.forEach((g, j) => {
      const included = !selection || selection.has(g.key);
      // Explicitly clear an excluded field (not just "leave it out of
      // `out`") so unchecking it in the Datumsreihe panel blanks it
      // immediately, rather than freezing whatever date it already had.
      const value = included ? dates[j] : undefined;
      for (const f of g.fields) out[f.id] = value;
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

  // Fields an admin has switched off in the editor ("Deaktiviert") are kept
  // in `effectiveFields` (so a formula on an *active* field can still
  // reference a disabled one — a disabled field isn't "gone", just not
  // shown to whoever's filling this in) but excluded from everything that
  // actually renders, validates, or previews the form: grouping, the
  // Datumsreihe/KW cascade, and the live PDF preview all read from this
  // instead of `effectiveFields` directly.
  const visibleFields = useMemo(() => effectiveFields.filter((f) => !f.disabled), [effectiveFields]);

  const groups = useMemo(() => groupFields(visibleFields), [visibleFields]);
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

  // Every page that takes part in the week cascade: anything with either a
  // qualifying date-field grid (`dateGroupsByPage`) or at least one KW
  // digit-box field, in document order. KW boxes and a page's own
  // Datumsreihe panel must always agree on which week that page is — and so
  // must two KW boxes that happen to share one page (e.g. separate Früh-/
  // Spätschicht subtotal blocks for what is otherwise the same week) — so
  // both are ranked from this one shared list instead of the KW boxes using
  // their own independent, per-field ranking.
  const weekPages = useMemo(() => {
    const pages = new Set<number>();
    for (const { page } of dateGroupsByPage) pages.add(page);
    for (const f of visibleFields) if (isKwField(f)) pages.add(f.page);
    return [...pages].sort((a, b) => a - b);
  }, [dateGroupsByPage, visibleFields]);
  const weekPageRank = useMemo(() => new Map(weekPages.map((p, i) => [p, i])), [weekPages]);
  // How many week-pages one Endlos-Modus block contributes — always uniform
  // across blocks, since every block is an exact repeat of the original
  // field set. See weekOffsetForRank for why `swap` needs this.
  const weekGroupSize = weekPages.length / weekBlocks;

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

  // Datumsreihe's "Woche (KW)" mode: only one panel's Jahr/KW is ever a real
  // input at a time (the "anchor slot" — see `anchorPageRank` below) —
  // every other panel derives its own week from it, so the pages always
  // read as a forward sequence instead of each panel independently
  // defaulting off today's date and drifting out of order. `null` = no
  // manual anchor typed yet, use today's date for whichever panel is
  // currently the anchor slot. Declared here (not down by its other
  // derivations) purely to keep it near `swapWeeks`/`toggleSwapWeeks`,
  // which it's conceptually paired with.
  const [anchorOverride, setAnchorOverride] = useState<{ year: string; week: string } | null>(null);

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
    // anchorOverride is deliberately left untouched here: it's whichever
    // number the admin typed, and that number's *meaning* doesn't change
    // when swap does — swap only moves which physical page holds it (see
    // `weekOffsetForRank`). Clearing it on toggle used to be needed when
    // swap instead pushed the *other* page backward by a week around a
    // fixed anchor slot; now that swap moves the anchor slot itself, the
    // typed value already lands on the right page with no reset needed.
  };

  // Chronological on-screen order: swapping can leave an earlier physical
  // page (e.g. Seite 1) showing a *later* week than a later physical page
  // (e.g. Seite 2) — see `weekOffsetForRank` — which reads backwards
  // wherever pages are shown in physical order: the per-page form
  // sections, the preview thumbnails, and the Datumsreihe panels (which use
  // this same map for their own "Seite N" labels and rendering order — see
  // its render loop below). `displayOrder[i]` is the physical page shown at
  // on-screen position `i`, and `displayPosition` is the inverse (physical
  // page → the "Seite N" number shown for it) — purely a display/labeling
  // concern. Nothing about the underlying data changes: DOM ids,
  // `jumpPreview`, `field.page`, and the exported PDF all still refer to
  // (and export in) the real physical page order; only what a human reads
  // on screen, and what it's labeled, changes.
  const displayOrder = useMemo(() => {
    const pages = Array.from({ length: effectivePageCount }, (_, i) => i);
    return [...pages].sort((a, b) => {
      const rankA = weekPageRank.get(a);
      const rankB = weekPageRank.get(b);
      const keyA = rankA !== undefined ? weekOffsetForRank(rankA, weekGroupSize, swapWeeks) : a;
      const keyB = rankB !== undefined ? weekOffsetForRank(rankB, weekGroupSize, swapWeeks) : b;
      return keyA - keyB;
    });
  }, [effectivePageCount, weekPageRank, weekGroupSize, swapWeeks]);
  const displayPosition = useMemo(() => {
    const map = new Map<number, number>();
    displayOrder.forEach((page, i) => map.set(page, i + 1));
    return map;
  }, [displayOrder]);

  // Which of a page's date fields the Datumsreihe panel's checkboxes have
  // selected (null = all) — lifted up from DateSeriesPanel so
  // Tätigkeitsnachweis-Modus's automatic refresh (freshDateValues) can see
  // the same exclusions instead of silently re-filling a field the panel
  // says to leave alone. Persisted to localStorage per template (same
  // pattern as `swapWeeks` below) — "I don't work weekends" is a standing
  // fact about how someone fills this template, not a one-off toggle for
  // the current visit, so it needs to survive a reload; this used to be
  // plain in-memory state that silently reset to "everything included" on
  // every fresh page load, which is what made it look like the exclusion
  // could never be saved. Starts empty (SSR-safe) and is restored from
  // localStorage in an effect after mount — see the footgun this avoids in
  // AGENTS.md ("never read localStorage in a lazy useState initializer").
  const [seriesByPage, setSeriesByPage] = useState<Record<number, Set<string> | null>>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`docflow:seriesByPage:${template.id}`);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, string[]>;
      const restored: Record<number, Set<string> | null> = {};
      for (const [page, keys] of Object.entries(parsed)) {
        restored[Number(page)] = new Set(keys);
      }
      setSeriesByPage(restored);
    } catch {
      /* ignore */
    }
  }, [template.id]);
  // Updates one page's selection and persists the whole map right away —
  // only non-null (i.e. actually-excluded-something) entries are written,
  // so a page nobody has touched doesn't bloat the stored JSON with an
  // explicit "everything" that the default already means.
  const setPageSelection = (page: number, next: Set<string> | null) => {
    setSeriesByPage((prev) => {
      const updated = { ...prev, [page]: next };
      try {
        const serializable: Record<number, string[]> = {};
        for (const [p, set] of Object.entries(updated)) {
          if (set) serializable[Number(p)] = [...set];
        }
        const key = `docflow:seriesByPage:${template.id}`;
        if (Object.keys(serializable).length > 0) {
          localStorage.setItem(key, JSON.stringify(serializable));
        } else {
          localStorage.removeItem(key);
        }
      } catch {
        /* ignore */
      }
      return updated;
    });
  };

  // Which page rank is currently "the anchor slot" — the one whose panel
  // has a real, editable Jahr/KW input and whose value every other page in
  // its block counts forward from (see `weekOffsetForRank`). Slot 0
  // (unswapped) is the first page of the first block; swapping moves it to
  // the *last* slot of that same block instead — the panel that's
  // currently the anchor changes with it, which is the whole point: typing
  // 38 always means "this page is KW 38," regardless of which page that is.
  const anchorPageRank = swapWeeks && weekGroupSize > 1 ? weekGroupSize - 1 : 0;
  // The physical page currently holding the anchor slot, purely for the
  // "folgt Seite N" label on every other panel — swapping can move this to
  // a page other than the very first one. Uses `displayPosition` (the same
  // chronological on-screen numbering the Datumsreihe panels themselves are
  // now ordered by), not the raw physical page, so this label always
  // matches whatever's actually printed above it as "Seite N".
  const anchorPage = dateGroupsByPage.find(({ page }) => weekPageRank.get(page) === anchorPageRank)?.page;
  const anchorLabel = `Seite ${displayPosition.get(anchorPage ?? 0) ?? (anchorPage ?? 0) + 1}`;
  // Unlike the anchor's page, its *default value* (before the admin has
  // typed anything) is just today's actual week — it no longer needs its
  // own swap adjustment, since swap already moved which page is asking.
  const defaultAnchor = isoWeekOf(new Date());
  const anchorYear = anchorOverride?.year ?? String(defaultAnchor.year);
  const anchorWeek = anchorOverride?.week ?? String(defaultAnchor.week);
  // Guards `defaultKwValues`/`freshDateValues` (which write straight into
  // real field values) against a transient invalid anchor — e.g. mid-edit
  // with the KW box momentarily empty, or a typo like week 99 — falling
  // back to the un-overridden default instead of stamping "NaN" into every
  // KW field in the document. The live panel display below still shows
  // exactly what's typed, invalid or not, so the user sees their own input.
  const anchorYearNum = Number(anchorYear);
  const anchorWeekNum = Number(anchorWeek);
  const safeAnchor =
    Number.isInteger(anchorYearNum) && Number.isInteger(anchorWeekNum) && anchorWeekNum >= 1 && anchorWeekNum <= 53
      ? { year: anchorYearNum, week: anchorWeekNum }
      : defaultAnchor;

  const [values, setValues] = useState<Record<string, FieldValue>>(() => ({
    ...defaultStaticValues(visibleFields),
    ...defaultKwValues(visibleFields, swapWeeks, weekPageRank, weekGroupSize, safeAnchor),
    ...(template.autoCurrentWeek
      ? freshDateValues(dateGroupsByPage, swapWeeks, weekPageRank, weekGroupSize, safeAnchor, seriesByPage)
      : {}),
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
                ...defaultKwValues(visibleFields, swapWeeksRef.current, weekPageRank, weekGroupSize, safeAnchor),
                ...freshDateValues(
                  dateGroupsByPage,
                  swapWeeksRef.current,
                  weekPageRank,
                  weekGroupSize,
                  safeAnchor,
                  seriesByPage
                ),
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
  // Tätigkeitsnachweis-Modus) whenever the week assignment is swapped, the
  // temporary week-block count changes (a newly-revealed block's KW/date
  // fields need their own defaults too), or the anchor itself is edited on
  // panel 0 — so every KW box in the document (not just the Datumsreihe
  // panels' own displayed Jahr/KW) follows the anchor automatically, and
  // none of this needs a manual re-apply per page.
  // defaultStaticValues goes in *underneath* the current values (spread
  // first) rather than overriding them, so growing weekBlocks backfills a
  // new block's defaultValue fields (e.g. a shift's usual Von/Bis/Pause)
  // without clobbering anything already showing on the original pages —
  // those keep whatever's already there (an earlier default, or the user's
  // own edit); only fields with no entry at all pick up their default here.
  useEffect(() => {
    setValues((v) => ({
      ...defaultStaticValues(visibleFields),
      ...v,
      ...defaultKwValues(visibleFields, swapWeeks, weekPageRank, weekGroupSize, safeAnchor),
      ...(template.autoCurrentWeek
        ? freshDateValues(dateGroupsByPage, swapWeeks, weekPageRank, weekGroupSize, safeAnchor, seriesByPage)
        : {}),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swapWeeks, weekBlocks, seriesByPage, anchorYear, anchorWeek]);

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

  // Saves the current form `values` into whichever draft the dropdown below
  // has picked (activeDraftId), or creates a new one if none is picked.
  // Deliberately does *not* reset draftName/activeDraftId afterward — an
  // earlier version cleared the name field on every successful save, which
  // read as "the draft I just picked vanished" even though the save itself
  // had worked and the dropdown still had it selected underneath.
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
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : "Speichern fehlgeschlagen.");
    } finally {
      setSavingDraft(false);
    }
  };

  // Picking a draft from the dropdown only marks it as the current target
  // for "Speichern"/"Löschen" and shows its name — it does *not* touch the
  // form's values. Pulling in a draft's saved values is a separate,
  // explicit "Laden" click (see loadActiveDraft), so browsing the dropdown
  // to see what's there can never silently clobber whatever's currently
  // being filled in.
  const pickDraft = (id: string) => {
    if (!id) {
      deselectDraft();
      return;
    }
    const draft = savedFills.find((f) => f.id === id);
    if (!draft) return;
    setActiveDraftId(draft.id);
    setDraftName(draft.name);
    setError(null);
    setDraftError(null);
  };

  const loadActiveDraft = () => {
    const draft = savedFills.find((f) => f.id === activeDraftId);
    if (!draft) return;
    setValues(draft.values ?? {});
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
            </div>
            {/* One dropdown to pick a draft, plus explicit Laden/Speichern/
                Löschen buttons that act immediately on whatever's picked —
                picking an entry never touches the form by itself (see
                pickDraft), so browsing the list is always safe. */}
            <div className="flex flex-wrap gap-2">
              <select
                value={activeDraftId ?? ""}
                onChange={(e) => pickDraft(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-3 py-2 text-sm focus:border-accent focus:outline-none"
              >
                <option value="">— Neuer Entwurf —</option>
                {savedFills.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.auto ? " · Auto" : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!activeDraftId}
                className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink hover:border-accent hover:text-accent disabled:opacity-40"
                onClick={loadActiveDraft}
                title="Die gespeicherten Werte dieses Entwurfs ins Formular laden"
              >
                Laden
              </button>
              <button
                type="button"
                disabled={!draftName.trim() || savingDraft}
                className="rounded-lg bg-accent-strong px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                onClick={() => void saveDraft()}
                title="Die aktuellen Formularwerte in diesem Entwurf speichern"
              >
                {savingDraft ? "Speichert…" : "Speichern"}
              </button>
              {activeDraftId && (
                <button
                  type="button"
                  title="Entwurf löschen"
                  className="rounded-lg border border-line px-3 py-2 text-sm text-red-400 hover:border-red-400"
                  onClick={() => void deleteDraft(activeDraftId)}
                >
                  ✕
                </button>
              )}
            </div>
            <input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="Entwurf benennen…"
              className="mt-2 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
            {draftError && <p className="mt-2 text-sm text-red-400">{draftError}</p>}
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
                      {/* Rendered in the same chronological order as the
                          on-screen fill sections/previews (`displayOrder`),
                          not physical page order — otherwise this panel
                          would still read "Seite 1 = KW 39" above "Seite 2 =
                          KW 38" under swap, exactly the backwards reading
                          the fill-form reorder was meant to fix, just one
                          section higher up. */}
                      {[...dateGroupsByPage]
                        .sort((a, b) => (displayPosition.get(a.page) ?? 0) - (displayPosition.get(b.page) ?? 0))
                        .map(({ page, groups: pageGroups }, i) => {
                          // Which panel is the anchor moves with `swapWeeks`
                          // (see `anchorPageRank`) — it's no longer always
                          // the very first panel — so every panel must check
                          // its own rank against it, not just compare
                          // `i === 0`. The rank comes from the shared
                          // `weekPageRank` (not this map's own index `i`,
                          // which is now a *display* position anyway), the
                          // same one the KW boxes use, so a page's panel and
                          // its own KW field(s) always land on the same week.
                          const rank = weekPageRank.get(page) ?? i;
                          const isAnchor = rank === anchorPageRank;
                          // Only used for non-anchor panels below (the anchor
                          // panel shows the raw, possibly-still-being-typed
                          // anchorYear/anchorWeek directly, not this derived
                          // value), so it's fine to always compute it from the
                          // validated `safeAnchor`.
                          const panelWeek = weekForRank(rank, weekGroupSize, swapWeeks, safeAnchor);
                          return (
                            <DateSeriesPanel
                              key={`${page}-${swapWeeks}`}
                              groups={pageGroups}
                              label={
                                dateGroupsByPage.length > 1
                                  ? `Seite ${displayPosition.get(page) ?? page + 1}`
                                  : undefined
                              }
                              year={isAnchor ? anchorYear : String(panelWeek.year)}
                              week={isAnchor ? anchorWeek : String(panelWeek.week)}
                              isAnchor={isAnchor}
                              anchorLabel={anchorLabel}
                              onAnchorChange={isAnchor ? setAnchorOverride : undefined}
                              onApply={setGroupValue}
                              selection={seriesByPage[page] ?? null}
                              onSelectionChange={(next) => setPageSelection(page, next)}
                            />
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          {displayOrder.map((pageIndex) => {
            const layout = pageLayouts[pageIndex];
            if (!layout || (layout.general.length === 0 && layout.days.length === 0)) return null;
            return (
              <section key={pageIndex} className="rounded-xl border border-line bg-surface p-4">
                <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-ink-dim">
                  Seite {displayPosition.get(pageIndex)}
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
            {displayOrder.map((i) => {
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
                    Seite {displayPosition.get(i)}
                  </p>
                  <PagePreview
                    pdfUrl={`/api/templates/${template.id}/pdf?v=${encodeURIComponent(template.updatedAt)}`}
                    pageIndex={sourcePage}
                    pageSize={template.pageSizes[sourcePage] ?? { width: 612, height: 792 }}
                    fields={visibleFields.filter((f) => f.page === i)}
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
 * date field in the document at once. Its "Woche (KW)" `year`/`week` come
 * from FillForm's shared anchor cascade (see `weekForRank`), matching how
 * the KW digit-box fields themselves default (see `defaultKwValues`).
 */
function DateSeriesPanel({
  groups,
  label,
  year,
  week,
  isAnchor,
  anchorLabel,
  onAnchorChange,
  onApply,
  selection,
  onSelectionChange,
}: {
  groups: LinkedGroup[]; // this page's date groups, already in document order, length >= 2
  label?: string;
  // "Woche (KW)" target — controlled from FillForm, not local state: only
  // the current anchor panel (isAnchor) can actually change it
  // (onAnchorChange); every other panel just displays what FillForm derived
  // for it from the anchor, so the sequence across panels always counts
  // forward from whichever page currently holds the anchor.
  year: string;
  week: string;
  isAnchor: boolean;
  // Which page currently holds the anchor (e.g. "Seite 2") — swapping
  // "Wochen tauschen" moves the anchor to a different page, so this isn't
  // always "Seite 1" anymore; shown on every non-anchor panel's "folgt …".
  anchorLabel: string;
  onAnchorChange?: (next: { year: string; week: string }) => void;
  onApply: (group: LinkedGroup, value: FieldValue) => void;
  // Lifted up to FillForm (null = all groups on this page) so
  // Tätigkeitsnachweis-Modus's automatic refresh can see the same
  // exclusions this panel's checkboxes set, instead of always re-filling
  // every date field regardless of what's unchecked here.
  selection: Set<string> | null;
  onSelectionChange: (next: Set<string> | null) => void;
}) {
  const [mode, setMode] = useState<"range" | "week">("range");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  const keys = selection ?? new Set(groups.map((g) => g.key));
  const toggleKey = (key: string) => {
    const base = selection ?? new Set(groups.map((g) => g.key));
    const next = new Set(base);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectionChange(next);
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
    // Computed over *every* group (Monday-first) and only then filtered
    // down to the selected ones by each group's own position — not
    // `selected`'s position — so deselecting a day in the middle of the
    // week (not just a trailing one) doesn't shift the remaining days'
    // dates by one slot.
    const dates = isoWeekDates(y, w, groups.length);
    groups.forEach((g, i) => {
      if (keys.has(g.key) && dates[i]) onApply(g, dates[i]);
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
                disabled={!isAnchor}
                title={isAnchor ? undefined : `Folgt ${anchorLabel} — dort ändern`}
                className="mt-1 block w-24 rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm focus:border-accent focus:outline-none disabled:opacity-60"
                value={year}
                onChange={(e) => onAnchorChange?.({ year: e.target.value, week })}
              />
            </label>
            <label className="text-xs text-ink-dim">
              KW
              <input
                type="number"
                min={1}
                max={53}
                placeholder="z. B. 5"
                disabled={!isAnchor}
                title={isAnchor ? undefined : `Folgt ${anchorLabel} — dort ändern`}
                className="mt-1 block w-28 rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm focus:border-accent focus:outline-none disabled:opacity-60"
                value={week}
                onChange={(e) => onAnchorChange?.({ year, week: e.target.value })}
              />
            </label>
            {!isAnchor && <span className="text-xs text-ink-dim">folgt {anchorLabel}</span>}
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
                    onClick={() => onSelectionChange(new Set(groups.map((g) => g.key)))}
                  >
                    Alle
                  </button>
                  <button
                    type="button"
                    className="text-ink-dim hover:underline"
                    onClick={() => onSelectionChange(new Set())}
                  >
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
