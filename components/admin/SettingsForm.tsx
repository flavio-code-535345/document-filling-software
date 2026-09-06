"use client";

import { useState } from "react";
import type { AIProvider, Settings } from "@/lib/types";

const TABS = [
  { id: "general", label: "Allgemein" },
  { id: "pdf", label: "PDF & E-Mail" },
  { id: "smtp", label: "SMTP" },
  { id: "ai", label: "KI" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const AI_PROVIDERS: { id: AIProvider; label: string; models: string[] }[] = [
  {
    id: "gemini",
    label: "Gemini (Google)",
    models: ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro", "gemini-2.0-flash"],
  },
  {
    id: "openai",
    label: "ChatGPT (OpenAI)",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"],
  },
  {
    id: "anthropic",
    label: "Claude (Anthropic)",
    models: [
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-3-7-sonnet-latest",
      "claude-3-5-sonnet-latest",
      "claude-3-5-haiku-latest",
      "claude-opus-4",
    ],
  },
];

function isKnownModel(m: string, list: string[]): boolean {
  return list.includes(m);
}

/** Tabbed admin settings with sticky save bar. App name syncs to the header
 *  instantly via a window CustomEvent after save. */
export default function SettingsForm({ settings: initial }: { settings: Settings }) {
  const [tab, setTab] = useState<TabId>("general");
  const [settings, setSettings] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const startClaudeOAuth = () => {
    const generatePKCE = () => {
      const array = new Uint8Array(32);
      crypto.getRandomValues(array);
      return btoa(String.fromCharCode(...array)).replace(/[+/=]/g, (c) =>
        c === "+" ? "-" : c === "/" ? "_" : ""
      );
    };

    const generateChallenge = async (verifier: string) => {
      const encoder = new TextEncoder();
      const data = encoder.encode(verifier);
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return btoa(String.fromCharCode(...hashArray)).replace(/[+/=]/g, (c) =>
        c === "+" ? "-" : c === "/" ? "_" : ""
      );
    };

    (async () => {
      try {
        const codeVerifier = generatePKCE();
        const codeChallenge = await generateChallenge(codeVerifier);
        const state = generatePKCE();

        sessionStorage.setItem(`pkce_${state}`, codeVerifier);

        const host = window.location.host;
        const protocol = window.location.protocol.replace(":", "");
        const redirectUri = `${protocol}://${host}/api/auth/claude-callback`;

        const params = new URLSearchParams({
          client_id: "50dd0d1c-4b95-484e-bfef-d44c895e4cbe",
          redirect_uri: redirectUri,
          response_type: "code",
          state,
          scope: "profile api-key inference",
          code_challenge: codeChallenge,
          code_challenge_method: "S256",
        });

        const authUrl = `https://claude.ai/oauth/authorize?${params.toString()}`;
        const popup = window.open(authUrl, "claude-auth", "width=600,height=700");

        const checkPopup = setInterval(() => {
          if (!popup || popup.closed) {
            clearInterval(checkPopup);
            const urlParams = new URLSearchParams(window.location.search);
            const token = urlParams.get("oauth_success");
            const tokenValue = urlParams.get("token");
            if (token && tokenValue) {
              patchProvider("anthropic", "cliToken", tokenValue);
              setMessage("Claude-Authentifizierung erfolgreich!");
              window.history.replaceState({}, document.title, window.location.pathname);
            }
          }
        }, 500);
      } catch (err) {
        setError(err instanceof Error ? err.message : "OAuth-Fehler");
      }
    })();
  };

  const patch = (section: keyof Settings, key: string, value: string | number | boolean) => {
    setSettings((s) => ({
      ...s,
      [section]: { ...s[section], [key]: value },
    }));
  };

  const patchAI = (
    patchFn: (
      ai: NonNullable<Settings["ai"]>
    ) => NonNullable<Settings["ai"]>
  ) => {
    setSettings((s) => ({ ...s, ai: patchFn(s.ai) }));
  };

  const patchProvider = (provider: AIProvider, key: "apiKey" | "model", value: string) => {
    patchAI((ai) => ({
      ...ai,
      providers: {
        ...ai.providers,
        [provider]: { ...ai.providers[provider], [key]: value },
      },
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
              Aktiver Anbieter
              <select
                className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2"
                value={settings.ai.provider}
                onChange={(e) => patch("ai", "provider", e.target.value as AIProvider)}
              >
                {AI_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>

            {AI_PROVIDERS.map((p) => {
              const cfg = settings.ai.providers?.[p.id] ?? { apiKey: "", model: p.models[0] };
              const active = settings.ai.provider === p.id;
              return (
                <div
                  key={p.id}
                  className={`space-y-3 rounded-lg border p-3 ${
                    active ? "border-accent bg-accent/5" : "border-line"
                  }`}
                >
                  <p className="flex items-center justify-between text-sm font-medium">
                    {p.label}
                    {active && (
                      <span className="rounded bg-accent/20 px-1.5 py-0.5 text-xs text-accent">
                        aktiv
                      </span>
                    )}
                  </p>
                  <label className="block text-xs text-ink-dim">
                    API-Schlüssel
                    <input
                      type="password"
                      className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm"
                      value={cfg.apiKey}
                      autoComplete="off"
                      placeholder={p.id === "gemini" ? "AIza…" : p.id === "openai" ? "sk-…" : "sk-ant-…"}
                      onChange={(e) => patchProvider(p.id, "apiKey", e.target.value)}
                    />
                  </label>
                  <ProviderModelSelect
                    providerId={p.id}
                    models={p.models}
                    value={cfg.model}
                    onChange={(m) => patchProvider(p.id, "model", m)}
                  />
                </div>
              );
            })}

            <p className="text-xs text-ink-dim">
              Der Editor bekommt damit einen „KI-Scan“-Button, der leere Felder im
              Dokument erkennt und automatisch als Felder anlegt. Alternativ greifen die
              Umgebungsvariablen <code>GEMINI_API_KEY</code>, <code>OPENAI_API_KEY</code> und{" "}
              <code>ANTHROPIC_API_KEY</code>.
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

function ProviderModelSelect({
  providerId,
  models,
  value,
  onChange,
}: {
  providerId: AIProvider;
  models: string[];
  value: string;
  onChange: (model: string) => void;
}) {
  const [choice, setChoice] = useState<string>(isKnownModel(value, models) ? value : "custom");

  return (
    <label className="block text-xs text-ink-dim">
      Modell
      <select
        className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm"
        value={choice}
        onChange={(e) => {
          const v = e.target.value;
          setChoice(v);
          if (v !== "custom") onChange(v);
        }}
      >
        {models.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
        <option value="custom">Anderes Modell…</option>
      </select>
      {choice === "custom" && (
        <input
          className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm"
          value={value}
          placeholder="Modellnamen eingeben"
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}
