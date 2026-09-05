"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

/**
 * QR phone-signature flow (desktop side): creates a session, shows the QR,
 * polls for the phone's signature, applies it. Cancels on close.
 */
export default function QrSignModal({
  onApply,
  onClose,
}: {
  onApply: (dataUrl: string) => void;
  onClose: () => void;
}) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"creating" | "waiting" | "received" | "error">("creating");
  const [error, setError] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const closedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/sign-session", { method: "POST" });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || "Sitzung konnte nicht erstellt werden.");
        if (cancelled) return;
        sessionIdRef.current = data.id;
        const url = `${window.location.origin}/sign/${data.id}`;
        const qr = await QRCode.toDataURL(url, { width: 240, margin: 1 });
        if (cancelled) return;
        setQrDataUrl(qr);
        setStatus("waiting");

        pollRef.current = setInterval(async () => {
          if (closedRef.current) return;
          try {
            const pollRes = await fetch(`/api/sign-session/${data.id}`, { cache: "no-store" });
            if (!pollRes.ok) {
              clearInterval(pollRef.current!);
              setStatus("error");
              setError("Sitzung abgelaufen.");
              return;
            }
            const pollData = await pollRes.json();
            if (pollData.signature) {
              clearInterval(pollRef.current!);
              setStatus("received");
              onApply(pollData.signature);
            }
          } catch {
            /* transient poll error — keep waiting */
          }
        }, 1500);
      } catch (err) {
        if (!cancelled) {
          setStatus("error");
          setError(err instanceof Error ? err.message : "Fehler beim Erstellen der Sitzung.");
        }
      }
    })();

    return () => {
      cancelled = true;
      closedRef.current = true;
      if (pollRef.current) clearInterval(pollRef.current);
      const id = sessionIdRef.current;
      if (id) {
        void fetch(`/api/sign-session/${id}`, { method: "DELETE" }).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-xl border border-line bg-surface p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold">📱 Per Handy unterschreiben</h3>
          <button className="text-ink-dim hover:text-ink" onClick={onClose}>
            ✕
          </button>
        </div>

        {status === "creating" && <p className="text-sm text-ink-dim">Sitzung wird erstellt…</p>}

        {status === "waiting" && qrDataUrl && (
          <div className="text-center">
            <img src={qrDataUrl} alt="QR-Code zum Unterschreiben" className="mx-auto rounded-lg bg-white p-2" />
            <p className="mt-3 text-sm text-ink-dim">
              Mit dem Handy scannen, unterschreiben, abschicken.
            </p>
          </div>
        )}

        {status === "received" && (
          <p className="text-sm text-green-400">Unterschrift empfangen! ✓</p>
        )}

        {status === "error" && (
          <p className="text-sm text-red-400">{error || "Ein Fehler ist aufgetreten."}</p>
        )}

        <button
          className="mt-4 w-full rounded-lg border border-line py-2 text-sm hover:border-accent"
          onClick={onClose}
        >
          {status === "received" ? "Übernehmen" : "Abbrechen"}
        </button>
      </div>
    </div>
  );
}
