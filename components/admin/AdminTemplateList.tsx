"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export interface AdminTemplateInfo {
  id: string;
  name: string;
  pageCount: number;
  fieldCount: number;
  updatedAt: string;
}

export default function AdminTemplateList({
  templates: initial,
}: {
  templates: AdminTemplateInfo[];
}) {
  const [templates, setTemplates] = useState(initial);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const upload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return setError("Bitte eine PDF-Datei wählen.");
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("name", name || file.name.replace(/\.pdf$/i, ""));
      fd.append("pdf", file);
      const res = await fetch("/api/templates", { method: "POST", body: fd });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Upload fehlgeschlagen.");
      router.push(`/admin/templates/${data.template.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Vorlage „${name}" wirklich löschen?`)) return;
    const res = await fetch(`/api/templates/${id}`, { method: "DELETE" });
    if (res.ok) {
      setTemplates(templates.filter((t) => t.id !== id));
      router.refresh();
    }
  };

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Vorlagen</h1>

      <form
        onSubmit={upload}
        className="mb-8 rounded-xl border border-line bg-surface p-4"
      >
        <h2 className="mb-3 font-medium">Neue Vorlage hochladen</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            Name
            <input
              className="mt-1 block w-56 rounded-lg border border-line bg-canvas px-3 py-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z. B. Urlaubsantrag"
            />
          </label>
          <label className="text-sm">
            PDF
            <input
              type="file"
              accept="application/pdf"
              className="mt-1 block w-64 text-sm"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-accent-strong px-4 py-2 font-semibold text-white"
          >
            {busy ? "Lädt hoch…" : "Hochladen"}
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </form>

      {templates.length === 0 ? (
        <p className="text-ink-dim">Noch keine Vorlagen.</p>
      ) : (
        <ul className="space-y-2">
          {templates.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between rounded-lg border border-line bg-surface px-4 py-3"
            >
              <div>
                <p className="font-medium">{t.name}</p>
                <p className="text-xs text-ink-dim">
                  {t.pageCount} Seite{t.pageCount === 1 ? "" : "n"} · {t.fieldCount}{" "}
                  Feld{t.fieldCount === 1 ? "" : "er"} ·{" "}
                  {new Date(t.updatedAt).toLocaleDateString("de-DE")}
                </p>
              </div>
              <div className="flex gap-2">
                <Link
                  href={`/admin/templates/${t.id}`}
                  className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-sm hover:border-accent"
                >
                  Bearbeiten
                </Link>
                <button
                  onClick={() => remove(t.id, t.name)}
                  className="rounded-lg border border-line px-3 py-1.5 text-sm text-red-400 hover:border-red-400"
                >
                  Löschen
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
