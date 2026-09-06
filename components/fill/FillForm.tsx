"use client";

import { useMemo, useState } from "react";
import type { FieldKind, FieldValue, StoredTemplate, TemplateField } from "@/lib/types";
import type { PreviewValues } from "@/components/PreviewSvg";
import PagePreview from "./PagePreview";
import MatrixInput, { type MatrixSelection } from "./MatrixInput";
import SignatureInput from "./SignatureInput";

interface LinkedGroup {
  key: string;
  fields: TemplateField[];
}

/** Groups fields that share label AND kind into one control (fills all copies). */
function groupFields(fields: TemplateField[]): LinkedGroup[] {
  const groups = new Map<string, TemplateField[]>();
  for (const f of fields) {
    const key = `${f.kind}|${f.label}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f);
  }
  return [...groups.values()].map((fields) => ({ key: `${fields[0].kind}|${fields[0].label}`, fields }));
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
  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [sendEmail, setSendEmail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Series mode: select multiple groups, fill them with one value or a date range.
  const [series, setSeries] = useState<Set<string>>(new Set());
  const [seriesValue, setSeriesValue] = useState("");
  const [seriesStart, setSeriesStart] = useState("");
  const [seriesEnd, setSeriesEnd] = useState("");

  const toggleSeries = (key: string) => {
    setSeries((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectedSeriesGroups = useMemo(
    () => groups.filter((g) => series.has(g.key)),
    [groups, series]
  );

  const seriesKind = useMemo(() => {
    if (selectedSeriesGroups.length === 0) return null;
    const firstKind = selectedSeriesGroups[0].fields[0].kind;
    return selectedSeriesGroups.every((g) => g.fields[0].kind === firstKind)
      ? firstKind
      : "mixed";
  }, [selectedSeriesGroups]);

  const applySeriesValue = () => {
    if (selectedSeriesGroups.length < 2 || !seriesValue) return;
    const value: FieldValue = seriesValue;
    for (const g of selectedSeriesGroups) setGroupValue(g, value);
  };

  const applyDateRange = () => {
    if (selectedSeriesGroups.length < 2 || !seriesStart || !seriesEnd) return;
    const start = new Date(seriesStart);
    const end = new Date(seriesEnd);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return;

    // Visual order: page → y → x (top-to-bottom down the document).
    const ordered = [...selectedSeriesGroups].sort((a, b) => {
      const fa = a.fields[0];
      const fb = b.fields[0];
      return fa.page - fb.page || fa.y - fb.y || fa.x - fb.x;
    });

    const dates: string[] = [];
    let cursor = new Date(start);
    while (cursor <= end && dates.length < ordered.length) {
      dates.push(cursor.toISOString().slice(0, 10));
      cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    }
    ordered.forEach((g, i) => {
      if (dates[i]) setGroupValue(g, dates[i]);
    });
  };

  const clearSeries = () => {
    setSeries(new Set());
    setSeriesValue("");
    setSeriesStart("");
    setSeriesEnd("");
  };

  const pages = useMemo(() => {
    const out: TemplateField[][] = Array.from({ length: template.pageCount }, () => []);
    for (const g of groups) {
      const page = g.fields[0].page;
      if (page >= 0 && page < template.pageCount) out[page].push(...g.fields.slice(0, 1));
      else out[0]?.push(g.fields[0]);
    }
    return out;
  }, [groups, template.pageCount]);

  const setGroupValue = (group: LinkedGroup, next: FieldValue) => {
    setValues((v) => {
      const copy = { ...v };
      for (const f of group.fields) copy[f.id] = next;
      return copy;
    });
  };

  const previewValues: PreviewValues = useMemo(
    () => values as PreviewValues,
    [values]
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
          {pages.map((pageFields, pageIndex) =>
            pageFields.length === 0 ? null : (
              <section key={pageIndex} className="rounded-xl border border-line bg-surface p-4">
                <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-ink-dim">
                  Seite {pageIndex + 1}
                </h2>
                <div className="space-y-5">
                  {pageFields.map((f) => {
                    const group = groups.find(
                      (g) => g.fields[0].id === f.id
                    )!;
                    const linked = group.fields.length > 1;
                    return (
                      <div key={f.id}>
                        <FieldControl
                          group={group}
                          value={values[f.id]}
                          hasDefaultSignature={hasDefaultSignature}
                          linked={linked}
                          seriesChecked={series.has(group.key)}
                          onToggleSeries={() => toggleSeries(group.key)}
                          onFocus={() => jumpPreview(pageIndex)}
                          onChange={(v) => setGroupValue(group, v)}
                        />
                      </div>
                    );
                  })}
                </div>
              </section>
            )
          )}

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
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Floating series bar: same value or date range across selected fields */}
      {selectedSeriesGroups.length >= 2 && (
        <div className="fixed bottom-4 left-1/2 z-40 w-[min(92vw,720px)] -translate-x-1/2 rounded-xl border border-accent bg-surface p-4 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold">
              Serie: {selectedSeriesGroups.length} Felder (
              {seriesKind === "mixed" ? "gemischt" : seriesKind})
            </p>
            <button className="text-xs text-ink-dim hover:text-ink" onClick={clearSeries}>
              Auswahl aufheben
            </button>
          </div>

          {seriesKind === "date" ? (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-xs text-ink-dim">
                  Von
                  <input
                    type="date"
                    className="mt-1 block rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm"
                    value={seriesStart}
                    onChange={(e) => setSeriesStart(e.target.value)}
                  />
                </label>
                <label className="text-xs text-ink-dim">
                  Bis
                  <input
                    type="date"
                    className="mt-1 block rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm"
                    value={seriesEnd}
                    onChange={(e) => setSeriesEnd(e.target.value)}
                  />
                </label>
                <button
                  className="rounded-lg bg-accent-strong px-4 py-1.5 text-sm font-semibold text-white"
                  disabled={!seriesStart || !seriesEnd}
                  onClick={applyDateRange}
                >
                  Datumsreihe anwenden (oben → unten)
                </button>
              </div>
              <p className="mt-1.5 text-xs text-ink-dim">
                Füllt die Felder in Leserichtung (Seite → von oben nach unten) mit
                fortlaufenden Daten.
              </p>
            </>
          ) : seriesKind !== "mixed" ? (
            <div className="flex flex-wrap items-center gap-3">
              <input
                className="flex-1 min-w-40 rounded-lg border border-line bg-canvas px-3 py-1.5 text-sm"
                placeholder={seriesKind === "checkbox" ? "true / 1 / x" : "Wert für alle Felder"}
                value={seriesValue}
                onChange={(e) => setSeriesValue(e.target.value)}
              />
              <button
                className="rounded-lg bg-accent-strong px-4 py-1.5 text-sm font-semibold text-white"
                disabled={!seriesValue}
                onClick={applySeriesValue}
              >
                Auf alle anwenden
              </button>
            </div>
          ) : (
            <p className="text-sm text-ink-dim">
              Für einen Serienwert müssen alle ausgewählten Felder dieselbe Art haben.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function FieldControl({
  group,
  value,
  hasDefaultSignature,
  linked,
  seriesChecked,
  onToggleSeries,
  onFocus,
  onChange,
}: {
  group: LinkedGroup;
  value: FieldValue;
  hasDefaultSignature: boolean;
  linked: boolean;
  seriesChecked: boolean;
  onToggleSeries: () => void;
  onFocus: () => void;
  onChange: (value: FieldValue) => void;
}) {
  const f = group.fields[0];
  const label = f.label || "Feld";

  const control = (() => {
    switch (f.kind) {
      case "text":
      case "date":
        return (
          <input
            type={f.kind === "date" ? "date" : "text"}
            className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm"
            value={typeof value === "string" ? value : ""}
            onFocus={onFocus}
            onChange={(e) => onChange(String(e.target.value))}
          />
        );
      case "multiline":
        return (
          <textarea
            rows={Math.max(3, Math.round(f.height / 18))}
            className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm"
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
        <input
          type="checkbox"
          title="Dieses Feld zur Serie hinzufügen (gleicher Wert auf mehrere Felder)"
          checked={seriesChecked}
          onChange={onToggleSeries}
          className="h-4 w-4 shrink-0 rounded accent-[#3b82f6]"
        />
        <label className="text-sm font-medium" htmlFor={f.id}>
          {label}
        </label>
        {f.required && <span className="text-sm text-red-400">*</span>}
        {linked && (
          <span
            className="text-xs text-accent"
            title="Ein Wert füllt alle Kopien im Dokument"
          >
            🔗 {group.fields.length}×
          </span>
        )}
        {seriesChecked && (
          <span className="rounded bg-accent/20 px-1.5 py-0.5 text-xs text-accent">
            Serie
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
