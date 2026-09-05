"use client";

import { useCallback, useState } from "react";
import SignaturePad from "../SignaturePad";

/**
 * Public phone signature page: big pad, re-measure friendly, "Fertig" preview
 * step (rotation resets the canvas bitmap, so the drawn PNG is snapshotted
 * before submitting), then single-use POST to the session API.
 */
export default function PhoneSign({ sessionId }: { sessionId: string }) {
  const [step, setStep] = useState<"draw" | "preview" | "sent" | "error">("draw");
  const [padKey, setPadKey] = useState(0);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-mount the pad on orientation change → bitmap reset, so require Fertig first.
  const snapshot = useCallback((d: string | null) => {
    setDataUrl(d);
  }, []);

  const finish = () => {
    if (!dataUrl) return;
    setStep("preview");
  };

  const send = async () => {
    if (!dataUrl) return;
    try {
      const res = await fetch(`/api/sign-session/${sessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Senden fehlgeschlagen.");
      setStep("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Senden fehlgeschlagen.");
      setStep("error");
    }
  };

  return (
    <div className="flex min-h-[100dvh] flex-col bg-canvas text-ink">
      <header className="border-b border-line bg-surface px-4 py-3">
        <h1 className="text-lg font-semibold">DocFlow Sign</h1>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-6">
        {step === "draw" && (
          <>
            <p className="text-ink-dim">Bitte hier unterschreiben.</p>
            <div className="w-full max-w-2xl">
              <SignaturePad key={padKey} height={300} onChange={snapshot} />
            </div>
            <div className="flex w-full max-w-2xl gap-3">
              <button
                className="flex-1 rounded-lg border border-line py-3 text-ink-dim"
                onClick={() => {
                  setPadKey((k) => k + 1);
                  setDataUrl(null);
                }}
              >
                Neu zeichnen
              </button>
              <button
                className="flex-1 rounded-lg bg-accent-strong py-3 font-semibold text-white"
                disabled={!dataUrl}
                onClick={finish}
              >
                Fertig
              </button>
            </div>
          </>
        )}

        {step === "preview" && dataUrl && (
          <>
            <p className="text-ink-dim">So sieht deine Unterschrift aus:</p>
            <img
              src={dataUrl}
              alt="Unterschrift"
              className="max-h-40 rounded-lg border border-line bg-white p-3"
            />
            <div className="flex w-full max-w-2xl gap-3">
              <button
                className="flex-1 rounded-lg border border-line py-3 text-ink-dim"
                onClick={() => setStep("draw")}
              >
                Zurück
              </button>
              <button
                className="flex-1 rounded-lg bg-accent-strong py-3 font-semibold text-white"
                onClick={send}
              >
                Senden
              </button>
            </div>
          </>
        )}

        {step === "sent" && (
          <div className="text-center">
            <p className="text-xl font-semibold text-green-400">
              Unterschrift übermittelt ✓
            </p>
            <p className="mt-2 text-ink-dim">
              Du kannst dieses Fenster jetzt schließen.
            </p>
          </div>
        )}

        {step === "error" && (
          <div className="text-center">
            <p className="text-red-400">{error || "Ein Fehler ist aufgetreten."}</p>
            <button
              className="mt-4 rounded-lg border border-line px-4 py-2"
              onClick={() => {
                setError(null);
                setStep("draw");
                setPadKey((k) => k + 1);
              }}
            >
              Erneut versuchen
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
