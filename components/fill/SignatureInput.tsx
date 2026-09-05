"use client";

import { useEffect, useState } from "react";
import SignaturePad from "../SignaturePad";
import QrSignModal from "../QrSignModal";

/**
 * Signature input for the fill form: inline pad, phone via QR, or the user's
 * saved default signature. Offers "als Standard speichern" after signing.
 */
export default function SignatureInput({
  value,
  hasDefaultSignature,
  onChange,
}: {
  value: string | null;
  hasDefaultSignature: boolean;
  onChange: (dataUrl: string | null) => void;
}) {
  const [mode, setMode] = useState<"none" | "pad" | "qr">("none");
  const [justSigned, setJustSigned] = useState(false);

  useEffect(() => {
    if (value) setJustSigned(true);
  }, [value]);

  const applySaved = async () => {
    const res = await fetch("/api/signature", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    if (data.signature) onChange(data.signature);
  };

  const saveAsDefault = async () => {
    if (!value) return;
    await fetch("/api/signature", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signature: value }),
    });
  };

  if (value) {
    return (
      <div>
        <img
          src={value}
          alt="Unterschrift"
          className="max-h-24 rounded-lg border border-line bg-white p-2"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {justSigned && (
            <button
              type="button"
              className="rounded border border-line px-2 py-1 text-xs hover:border-accent"
              onClick={saveAsDefault}
              title="Diese Unterschrift als Standard speichern"
            >
              ★ Als Standard speichern
            </button>
          )}
          <button
            type="button"
            className="rounded border border-line px-2 py-1 text-xs text-red-400 hover:border-red-400"
            onClick={() => {
              onChange(null);
              setJustSigned(false);
            }}
          >
            Entfernen
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded border border-line px-3 py-1.5 text-sm hover:border-accent"
          onClick={() => setMode(mode === "pad" ? "none" : "pad")}
        >
          ✍ Hier unterschreiben
        </button>
        <button
          type="button"
          className="rounded border border-line px-3 py-1.5 text-sm hover:border-accent"
          onClick={() => setMode("qr")}
        >
          📱 Per Handy unterschreiben
        </button>
        {hasDefaultSignature && (
          <button
            type="button"
            className="rounded border border-line px-3 py-1.5 text-sm hover:border-accent"
            onClick={applySaved}
          >
            ⚡ Gespeicherte Unterschrift
          </button>
        )}
      </div>

      {mode === "pad" && (
        <div className="mt-3 max-w-md">
          <SignaturePad height={160} onChange={(d) => d && onChange(d)} />
        </div>
      )}

      {mode === "qr" && (
        <QrSignModal
          onApply={(d) => {
            onChange(d);
            setMode("none");
          }}
          onClose={() => setMode("none")}
        />
      )}
    </div>
  );
}
