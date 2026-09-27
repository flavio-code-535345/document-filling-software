// Timesheet ("Tätigkeitsnachweis") semantics shared by the fill form's live
// preview and the server-side export, so both agree on exactly the same
// things: which fields make up a day row, ISO-8601 week math, and how a
// filled-in week turns into the TN pages that actually get printed (split at
// a month change, struck rows marked "–"). Pure and framework-free — safe to
// import from client components and route handlers alike.
import type { FieldValue, FillValues, TemplateField } from "./types";

/** The five fixed columns of a timesheet day block. */
export type TimesheetColumn = "datum" | "von" | "bis" | "pause" | "stunden";

/**
 * JavaScript's `\b` word boundary is ASCII-only: it treats "ä ö ü ß" (and
 * other accented letters) as non-word characters, so a word like
 * "Frühschicht" reads to `\b` as two tokens, "Fr" + "ühschicht" — letting a
 * bare two-letter day abbreviation like "fr" (Freitag) match *inside* an
 * unrelated German word purely because an umlaut happens to follow it. Build
 * day/column regexes with this Unicode-aware boundary instead, so a match
 * requires an actual accented-letter-aware word boundary on both sides.
 */
export const DE_WORD_CHAR = "[A-Za-zÀ-ÖØ-öø-ÿ]";
export function deWordRe(alternatives: string): RegExp {
  return new RegExp(`(?<!${DE_WORD_CHAR})(?:${alternatives})(?!${DE_WORD_CHAR})`, "i");
}

export const DAY_DEFS: { key: string; label: string; re: RegExp }[] = [
  { key: "mo", label: "Montag", re: deWordRe("montag|mo") },
  { key: "di", label: "Dienstag", re: deWordRe("dienstag|di") },
  { key: "mi", label: "Mittwoch", re: deWordRe("mittwoch|mi") },
  { key: "do", label: "Donnerstag", re: deWordRe("donnerstag|do") },
  { key: "fr", label: "Freitag", re: deWordRe("freitag|fr") },
  { key: "sa", label: "Samstag", re: deWordRe("samstag|sa") },
  { key: "so", label: "Sonntag", re: deWordRe("sonntag|so") },
];

/** Resolve a field label to a day-of-week key ("mo"…"so"), or null. */
export function detectDay(label: string): string | null {
  for (const d of DAY_DEFS) if (d.re.test(label)) return d.key;
  return null;
}

/** Resolve a field label to one of the five timesheet columns, or null. */
export function detectColumn(label: string): TimesheetColumn | null {
  const l = label.toLowerCase();
  if (deWordRe("datum").test(l)) return "datum";
  if (deWordRe("von|beginn|start|anfang").test(l)) return "von";
  if (deWordRe("bis|ende").test(l)) return "bis";
  if (deWordRe("pause").test(l)) return "pause";
  if (deWordRe("stunden|arbeitszeit|gesamt").test(l)) return "stunden";
  return null;
}

/**
 * ISO-8601 dates of a calendar week (Monday-first), starting from `week`.
 * `count` isn't capped at 7 — a document with more than one week's worth of
 * date fields (e.g. a duplex two-week timesheet) just keeps counting into
 * the following week(s), Monday-first throughout.
 */
export function isoWeekDates(year: number, week: number, count: number): string[] {
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
export function mondayOfIsoWeek(year: number, week: number): Date {
  return new Date(isoWeekDates(year, week, 1)[0]);
}

/**
 * ISO-8601 week number (Monday-first; week 1 is the week containing the
 * year's first Thursday) for a given date, via the standard "nearest
 * Thursday" trick: shifting to that Thursday makes the week/year unambiguous
 * even for the first/last days of a year (KW 53 / KW 1).
 */
export function isoWeekOf(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7; // Mon=1 … Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

// ---------------------------------------------------------------------------
// Month-end split
// ---------------------------------------------------------------------------

/** What a struck ("gestrichen") cell prints as: a day that deliberately
 * isn't filled in, as opposed to one somebody forgot. Formulas read it as 0
 * (see lib/formula.ts#numFromValue), and both renderers print it verbatim —
 * `formatGermanDate` passes anything that isn't an ISO date straight through,
 * so a struck Datum cell needs no special casing either. */
export const STRUCK = "–";

const MONTH_NAMES_DE = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

/** German month name for a 1-based month number. */
export function germanMonthName(month: number): string {
  return MONTH_NAMES_DE[month - 1] ?? "";
}

export interface CalendarDate {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
}

/** Parses a date field's value — ISO `YYYY-MM-DD` (what the date picker and
 * the week auto-fill store) or German `DD.MM.YYYY` (what someone might type
 * by hand) — rejecting anything that isn't a real calendar day (so 29.02. only
 * parses in a leap year). */
export function parseFieldDate(value: FieldValue): CalendarDate | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  let year: number, month: number, day: number;
  if (m) {
    year = Number(m[1]);
    month = Number(m[2]);
    day = Number(m[3]);
  } else {
    m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(v);
    if (!m) return null;
    day = Number(m[1]);
    month = Number(m[2]);
    year = Number(m[3]);
  }
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return { year, month, day };
}

function monthKey(d: CalendarDate): number {
  return d.year * 12 + (d.month - 1);
}

function hasText(v: FieldValue): boolean {
  return typeof v === "string" && v.trim() !== "" && v.trim() !== STRUCK;
}

function positiveNumber(v: FieldValue): boolean {
  if (typeof v !== "string") return false;
  const n = parseFloat(v.trim().replace(",", "."));
  return Number.isFinite(n) && n > 0;
}

interface DayRow {
  cells: TemplateField[];
  date: CalendarDate | null;
  worked: boolean;
}

/**
 * Groups one page's fields into day rows (Montag…Sonntag, by label — the same
 * `detectDay` the fill form uses to build its day blocks) and decides, per
 * row, whether any work was actually entered. "Work" means a Von or Bis time,
 * or a Stunden value above zero — a Pause on its own, or "0" hours, doesn't
 * count, which is what lets an empty weekend day or a holiday get struck
 * instead of printed as 0 hours. Disabled fields are ignored: they never
 * print, and a stale value left over in one mustn't make a day look worked.
 */
function buildDayRows(pageFields: TemplateField[], values: FillValues): DayRow[] {
  const byDay = new Map<string, TemplateField[]>();
  for (const f of pageFields) {
    if (f.disabled) continue;
    const day = detectDay(f.label);
    if (!day) continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(f);
  }
  const rows: DayRow[] = [];
  for (const cells of byDay.values()) {
    const dateField =
      cells.find((c) => c.kind === "date") ?? cells.find((c) => detectColumn(c.label) === "datum") ?? null;
    const workCells = cells.filter((c) => {
      const col = detectColumn(c.label);
      return col === "von" || col === "bis" || col === "stunden";
    });
    const worked =
      workCells.length > 0
        ? workCells.some((c) => {
            const col = detectColumn(c.label);
            return col === "stunden" ? positiveNumber(values[c.id]) : hasText(values[c.id]);
          })
        : cells.some((c) => c !== dateField && detectColumn(c.label) !== "pause" && hasText(values[c.id]));
    rows.push({ cells, date: dateField ? parseFieldDate(values[dateField.id]) : null, worked });
  }
  return rows;
}

interface PagePart {
  month?: { year: number; month: number };
  struckIds: Set<string>;
}

/**
 * Decides how one filled-in week page is printed.
 *
 * A TN may not reach past the end of a month (the form's own rule), so a week
 * whose *worked* days fall in two different months becomes one TN per month:
 * each keeps its own month's days and strikes the other month's. A month that
 * only contributes days nobody worked (e.g. the 1st falls on a Saturday) gets
 * no TN of its own — its days are simply struck on the one that remains — so
 * a weekend month change never produces an empty second sheet. Independently
 * of any split, days with no work entered are struck rather than left blank
 * or printed as "0". A page with no work on it at all is left exactly as it
 * is: that's a sheet nobody has filled in yet, not one full of days off.
 */
function planPage(pageFields: TemplateField[], values: FillValues): PagePart[] {
  const rows = buildDayRows(pageFields, values);
  if (rows.length === 0 || !rows.some((r) => r.worked)) return [{ struckIds: new Set() }];

  const struckUnless = (keep: (r: DayRow) => boolean) => {
    const s = new Set<string>();
    for (const r of rows) if (!keep(r)) for (const c of r.cells) s.add(c.id);
    return s;
  };

  const workMonths = [
    ...new Set(rows.filter((r) => r.worked && r.date).map((r) => monthKey(r.date!))),
  ].sort((a, b) => a - b);

  if (workMonths.length <= 1) return [{ struckIds: struckUnless((r) => r.worked) }];

  return workMonths.map((key, i) => ({
    month: { year: Math.floor(key / 12), month: (key % 12) + 1 },
    // A worked row without a (parseable) date can't be assigned to a month
    // — keep it on the first TN rather than silently dropping hours.
    struckIds: struckUnless((r) => r.worked && (r.date ? monthKey(r.date) === key : i === 0)),
  }));
}

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase();
}

function uniqueLabel(candidate: string, used: Set<string>): string {
  let label = candidate;
  for (let n = 2; used.has(normalizeLabel(label)); n++) label = `${candidate} ${n}`;
  used.add(normalizeLabel(label));
  return label;
}

/** The value a struck cell prints: a dash for anything text-like, unchecked
 * for a checkbox, nothing for a signature or matrix. */
function struckValue(f: TemplateField): FieldValue {
  if (f.kind === "text" || f.kind === "multiline" || f.kind === "date") return STRUCK;
  if (f.kind === "checkbox") return false;
  return undefined;
}

/** One printed TN page and where it came from. */
export interface TimesheetPage {
  /** Index of the filled-in page (after any Endlos-Modus expansion) it's built from. */
  sourcePage: number;
  /** 1-based part number, and how many TNs that source page became (1 when not split). */
  part: number;
  parts: number;
  /** The month this part covers — only set when the source page was split. */
  month?: { year: number; month: number };
}

export interface TimesheetOutput {
  /** Every field, re-paged onto the output pages; split parts after the first
   * are copies with `::tn<part>` ids and unique labels (their formulas
   * re-pointed at their own siblings, since formulas resolve labels
   * first-match-wins — see lib/formula.ts#evaluateFormulas). */
  fields: TemplateField[];
  /** Raw (pre-formula) values keyed by output field id. */
  values: FillValues;
  pages: TimesheetPage[];
  /** Struck cells and their printed value — re-apply these *after*
   * evaluating formulas, so a struck day row that happens to carry a formula
   * of its own still prints "–" instead of a computed 0. */
  struck: FillValues;
  /** False when nothing was split or struck — the output is the input. */
  changed: boolean;
}

/**
 * Turns the filled-in week pages into the TN pages that actually get
 * printed: one per week, or two when the worked days of a week straddle a
 * month change — both carrying the same KW, Name, Vorname, Kunde and every
 * other non-day field, since those are copied over unchanged; only day rows
 * get struck. Each TN's Total-Std formula then sums only its own days, simply
 * because the other month's Stunden cells on it are struck ("–" reads as 0).
 * Pause handling is untouched — whatever the template's Stunden values
 * already net out (or its formulas compute) carries over as-is.
 *
 * Deterministic in its inputs, so the fill form's preview and the server's
 * export independently arrive at the same pages without exchanging anything
 * beyond the values the form already submits.
 */
export function buildTimesheetOutput(
  fields: TemplateField[],
  pageCount: number,
  values: FillValues
): TimesheetOutput {
  const byPage: TemplateField[][] = Array.from({ length: pageCount }, () => []);
  const offPage: TemplateField[] = [];
  for (const f of fields) {
    if (f.page >= 0 && f.page < pageCount) byPage[f.page].push(f);
    else offPage.push(f);
  }

  const usedLabels = new Set(fields.map((f) => normalizeLabel(f.label)));
  const outFields: TemplateField[] = [];
  const outValues: FillValues = {};
  const struck: FillValues = {};
  const pages: TimesheetPage[] = [];
  let changed = false;

  byPage.forEach((pageFields, sourcePage) => {
    const parts = planPage(pageFields, values);
    if (parts.length > 1 || parts[0].struckIds.size > 0) changed = true;

    parts.forEach((plan, i) => {
      const outPage = pages.length;
      pages.push({
        sourcePage,
        part: i + 1,
        parts: parts.length,
        month: parts.length > 1 ? plan.month : undefined,
      });

      const labelMap = new Map<string, string>();
      const clones = pageFields.map((f) => {
        const clone: TemplateField = { ...f, page: outPage };
        if (i > 0) {
          clone.id = `${f.id}::tn${i + 1}`;
          // Linked fields keep their label — same as the Endlos-Modus
          // expansion does — they're one shared input by design.
          if (!f.linkKey) {
            clone.label = uniqueLabel(`${f.label} · TN ${i + 1}`, usedLabels);
            labelMap.set(normalizeLabel(f.label), clone.label);
          }
        }
        return clone;
      });
      if (i > 0) {
        for (const clone of clones) {
          if (!clone.formula) continue;
          clone.formula = clone.formula.replace(/\{([^}]+)\}/g, (whole, label: string) => {
            const mapped = labelMap.get(normalizeLabel(label));
            return mapped ? `{${mapped}}` : whole;
          });
        }
      }

      pageFields.forEach((f, idx) => {
        const clone = clones[idx];
        if (plan.struckIds.has(f.id)) {
          const v = struckValue(f);
          outValues[clone.id] = v;
          struck[clone.id] = v;
        } else if (values[f.id] !== undefined) {
          outValues[clone.id] = values[f.id];
        }
      });
      outFields.push(...clones);
    });
  });

  // Off-page fields never print (every renderer skips a page that doesn't
  // exist) but may still feed a formula, so carry them along unchanged.
  for (const f of offPage) {
    outFields.push({ ...f, page: -1 });
    if (values[f.id] !== undefined) outValues[f.id] = values[f.id];
  }

  return { fields: outFields, values: outValues, pages, struck, changed };
}
