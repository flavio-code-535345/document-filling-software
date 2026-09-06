"use client";

import { useState } from "react";
import type { Settings } from "@/lib/types";

const TABS = [
  { id: "general", label: "Allgemein" },
  { id: "pdf", label: "PDF & E-Mail" },
  { id: "smtp", label: "SMTP" },
  { id: "ai", label: "KI" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const AI_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-pro",
  "gemini-2.0-flash",
];

function isKnownModel(m: string): m is (typeof AI_MODELS)[number] {
  return (AI_MODELS as readonly string[]).includes(m);
}

/** Tabbed admin settings with sticky save bar. App name syncs to the header
 *  instantly via a window CustomEvent after save. */
export default function SettingsForm({ settings: initial }: { settings: Settings }) {
  const [tab, setTab] = useState<TabId>("general");
  const [settings, setSettings] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const patch = (section: keyof Settings, key: string, value: string | number | boolean) => {
    setSettings((s) => ({
      ...s,
      [section]: { ...s[section], [key]: value },
    }));
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Speichern fehlgeschlagen.");
      window.dispatchEvent(
        new CustomEvent("vw:app-settings-changed", {
          detail: { appName: settings.general.appName, appIcon: settings.general.appIcon },
        })
      );
      setMessage("Einstellungen gespeichert.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Speichern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-2xl font-semibold">Einstellungen</h1>

      <div className="mb-4 flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`rounded-t-lg px-4 py-2 text-sm ${
              tab === t.id ? "border border-b-0 border-line bg-surface text-ink" : "text-ink-dim hover:text-ink"
            }`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-line bg-surface p-5">
        {tab === "general" && (
          <div className="space-y-4">
            <label className="block text-sm">
              App-Name
              <input
                className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2"
                value={settings.general.appName}
                onChange={(e) => patch("general", "appName", e.target.value)}
              />
            </label>
            <label className="block text-sm">
              App-Icon (Emoji)
              <input
                className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2"
                value={settings.general.appIcon}
                onChange={(e) => patch("general", "appIcon", e.target.value)}
              />
            </label>
          </div>
        )}

        {tab === "pdf" && (
          <div className="space-y-4">
            <label className="block text-sm">
              Standardschriftgröße (pt)
              <input
                type="number"
                min={5}
                max={72}
                className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2"
                value={settings.pdf.defaultFontSize}
                onChange={(e) => patch("pdf", "defaultFontSize", Number(e.target.value) || 11)}
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.pdf.emailEnabled}
                onChange={(e) => patch("pdf", "emailEnabled", e.target.checked)}
              />
              E-Mail-Versand aktivieren
            </label>
            <label className="block text-sm">
              Fallback-Empfängeradresse
              <input
                type="email"
                className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2"
                value={settings.pdf.emailTo}
                onChange={(e) => patch("pdf", "emailTo", e.target.value)}
              />
            </label>
          </div>
        )}

        {tab === "smtp" && (
          <div className="space-y-4">
            <label className="block text-sm">
              SMTP-Host
              <input
                className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2"
                value={settings.smtp.host}
                onChange={(e) => patch("smtp", "host", e.target.value)}
              />
            </label>
            <div className="grid grid-cols-2 gap-4">
              <label className="block text-sm">
                Port
                <input
                  type="number"
                  className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2"
                  value={settings.smtp.port}
                  onChange={(e) => patch("smtp", "port", Number(e.target.value) || 587)}
                />
              </label>
              <label className="flex items-center gap-2 pt-6 text-sm">
                <input
                  type="checkbox"
                  checked={settings.smtp.secure}
                  onChange={(e) => patch("smtp", "secure", e.target.checked)}
                />
                SSL/TLS (Port 465)
              </label>
            </div>
            <label className="block text-sm">
              Benutzername
              <input
                className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2"
                value={settings.smtp.user}
                autoComplete="off"
                onChange={(e) => patch("smtp", "user", e.target.value)}
              />
            </label>
            <label className="block text-sm">
              Passwort
              <input
                type="password"
                className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2"
                value={settings.smtp.pass}
                autoComplete="new-password"
                onChange={(e) => patch("smtp", "pass", e.target.value)}
              />
            </label>
            <label className="block text-sm">
              Absenderadresse
              <input
                type="email"
                className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2"
                value={settings.smtp.from}
                onChange={(e) => patch("smtp", "from", e.target.value)}
              />
            </label>
          </div>
        )}

        {tab === "ai" && (
          <div className="space-y-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.ai.enabled}
                onChange={(e) => patch("ai", "enabled", e.target.checked)}
              />
              KI-Felderkennung aktivieren
            </label>
            <label className="block text-sm">
              Google-Gemini-API-Schlüssel
              <input
                type="password"
                className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2"
                value={settings.ai.apiKey}
                autoComplete="off"
                placeholder="AIza…"
                onChange={(e) => patch("ai", "apiKey", e.target.value)}
              />
            </label>
            <label className="block text-sm">
              Modell
              <select
                className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2"
                value={isKnownModel(settings.ai.model) ? settings.ai.model : "custom"}
                onChange={(e) => {
                  if (e.target.value === "custom") return;
                  patch("ai", "model", e.target.value);
                }}
              >
                {AI_MODELS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
                <option value="custom">Anderes Modell…</option>
              </select>
              {!isKnownModel(settings.ai.model) && (
                <input
                  className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2"
                  value={settings.ai.model}
                  onChange={(e) => patch("ai", "model", e.target.value)}
                />
              )}
            </label>
            <p className="text-xs text-ink-dim">
              Der Editor bekommt damit einen „KI-Scan“-Button, der leere Felder im
              Dokument erkennt und automatisch als Felder anlegt. Alternativ kann der
              Schlüssel als Umgebungsvariable <code>GEMINI_API_KEY</code> gesetzt werden.
            </p>
          </div>
        )}
      </div>

      {message && <p className="mt-3 text-sm text-green-400">{message}</p>}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      {/* Sticky save bar below navbar */}
      <div className="sticky top-16 z-30 -mx-4 mt-6 flex justify-end border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur">
        <button
          className="rounded-lg bg-accent-strong px-6 py-2 font-semibold text-white"
          disabled={busy}
          onClick={save}
        >
          {busy ? "Speichert…" : "Speichern"}
        </button>
      </div>
    </div>
  );
}
