"use client";

import { useState } from "react";
import SignaturePad from "../SignaturePad";

/** Own email address + default signature management. */
export default function ProfileForm({
  initialEmail,
  initialSignature,
}: {
  initialEmail: string;
  initialSignature: string | null;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [signature, setSignature] = useState<string | null>(initialSignature);
  const [showPad, setShowPad] = useState(false);
  const [padDraft, setPadDraft] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const saveEmail = async () => {
    setError(null);
    setMessage(null);
    const res = await fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return setError(data?.error || "Speichern fehlgeschlagen.");
    setMessage("E-Mail gespeichert.");
  };

  const saveSignature = async (sig: string) => {
    setError(null);
    setMessage(null);
    const res = await fetch("/api/signature", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signature: sig }),
    });
    if (!res.ok) return setError("Signatur konnte nicht gespeichert werden.");
    setSignature(sig);
    setShowPad(false);
    setMessage("Unterschrift gespeichert.");
  };

  const deleteSignature = async () => {
    await fetch("/api/signature", { method: "DELETE" });
    setSignature(null);
    setShowPad(false);
    setMessage("Unterschrift entfernt.");
  };

  return (
    <div className="mx-auto max-w-xl space-y-8">
      <h1 className="text-2xl font-semibold">Mein Profil</h1>

      <section className="rounded-xl border border-line bg-surface p-5">
        <h2 className="mb-3 font-medium">E-Mail-Adresse</h2>
        <p className="mb-3 text-xs text-ink-dim">
          Wird beim Versand ausgefüllter Dokumente als Ziel verwendet.
        </p>
        <div className="flex gap-2">
          <input
            type="email"
            className="flex-1 rounded-lg border border-line bg-canvas px-3 py-2 text-sm"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@firma.de"
          />
          <button
            className="rounded-lg border border-line px-4 py-2 text-sm hover:border-accent"
            onClick={saveEmail}
          >
            Speichern
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-line bg-surface p-5">
        <h2 className="mb-3 font-medium">Standard-Unterschrift</h2>
        {signature ? (
          <div>
            <img
              src={signature}
              alt="Standard-Unterschrift"
              className="max-h-32 rounded-lg border border-line bg-white p-2"
            />
            <div className="mt-2 flex gap-2">
              <button
                className="rounded-lg border border-line px-3 py-1.5 text-sm hover:border-accent"
                onClick={() => setShowPad(true)}
              >
                Neu zeichnen
              </button>
              <button
                className="rounded-lg border border-line px-3 py-1.5 text-sm text-red-400 hover:border-red-400"
                onClick={deleteSignature}
              >
                Entfernen
              </button>
            </div>
          </div>
        ) : (
          <button
            className="rounded-lg border border-line px-3 py-1.5 text-sm hover:border-accent"
            onClick={() => setShowPad(true)}
          >
            Unterschrift erstellen
          </button>
        )}

        {showPad && (
          <div className="mt-4">
            <SignaturePad height={160} onChange={setPadDraft} />
            <div className="mt-2 flex gap-2">
              <button
                className="rounded-lg bg-accent-strong px-4 py-1.5 text-sm font-semibold text-white"
                disabled={!padDraft}
                onClick={() => padDraft && saveSignature(padDraft)}
              >
                Speichern
              </button>
              <button
                className="rounded-lg border border-line px-4 py-1.5 text-sm"
                onClick={() => setShowPad(false)}
              >
                Abbrechen
              </button>
            </div>
          </div>
        )}
      </section>

      {message && <p className="text-sm text-green-400">{message}</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
