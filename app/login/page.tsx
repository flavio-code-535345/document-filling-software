"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "request">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [requested, setRequested] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        mode === "login" ? "/api/auth/login" : "/api/auth/register",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "Fehler beim Anmelden.");
        return;
      }
      if (mode === "request") {
        setRequested(true);
        return;
      }
      router.push("/");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <div className="rounded-xl border border-line bg-surface p-6">
        <h1 className="text-xl font-semibold">DocFlow</h1>
        <p className="mb-6 text-sm text-ink-dim">
          {mode === "login" ? "Bitte anmelden." : "Zugang anfordern"}
        </p>

        {requested ? (
          <div className="rounded-lg border border-accent bg-surface-2 p-4 text-sm">
            Deine Anfrage wurde gespeichert. Ein Administrator muss sie freischalten,
            bevor du dich anmelden kannst.
            <button
              className="mt-4 block text-accent underline"
              onClick={() => {
                setRequested(false);
                setMode("login");
              }}
            >
              Zum Login
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <label className="block text-sm">
              Benutzername
              <input
                className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
              />
            </label>
            <label className="block text-sm">
              Passwort
              <input
                type="password"
                className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                required
              />
            </label>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-accent-strong px-4 py-2 font-semibold text-white"
            >
              {mode === "login" ? "Anmelden" : "Zugang anfordern"}
            </button>

            <button
              type="button"
              className="w-full text-center text-sm text-ink-dim underline hover:text-ink"
              onClick={() => {
                setMode(mode === "login" ? "request" : "login");
                setError(null);
              }}
            >
              {mode === "login"
                ? "Noch keinen Zugang? Anfrage stellen"
                : "Schon registriert? Anmelden"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
