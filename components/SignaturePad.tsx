"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Touch-friendly signature pad (pointer events). Canvas auto-resizes to its
 * container; callers should re-mount it on orientation changes that reset the
 * bitmap (phone). Exports PNG data URLs via onChange.
 */
export default function SignaturePad({
  height = 200,
  onChange,
  stroke = "#0b1220",
  compact = false,
}: {
  height?: number;
  onChange?: (dataUrl: string | null) => void;
  stroke?: string;
  compact?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = (canvas.clientWidth || 300) * dpr;
    canvas.height = height * dpr;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = stroke;
    ctx.lineWidth = compact ? 2.5 : 3;
  }, [height, stroke, compact]);

  const pos = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    drawingRef.current = true;
    lastRef.current = pos(e);
    canvasRef.current?.setPointerCapture(e.pointerId);
  };

  const move = (e: React.PointerEvent) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    const p = pos(e);
    const ctx = canvasRef.current?.getContext("2d");
    const last = lastRef.current;
    if (!ctx || !last) return;
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastRef.current = p;
    if (empty) {
      setEmpty(false);
      onChange?.(toDataUrl());
    }
  };

  const end = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    onChange?.(toDataUrl());
  };

  const toDataUrl = () => canvasRef.current?.toDataURL("image/png") ?? null;

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
    setEmpty(true);
    onChange?.(null);
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        className="w-full rounded-lg border border-line bg-white"
        style={{ touchAction: "none", cursor: "crosshair", height }}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
      <button
        type="button"
        disabled={empty}
        onClick={clear}
        className="mt-1 rounded border border-line px-2 py-0.5 text-xs hover:border-accent"
      >
        Löschen
      </button>
    </div>
  );
}
