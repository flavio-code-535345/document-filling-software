import { useEffect, useRef, useState } from 'react';

/**
 * DrawPad — pressure-agnostic signature canvas with pointer events.
 * Works with mouse (desktop fallback) and touch (mobile signing page).
 */
export default function DrawPad({ width = 560, height = 220, onChange, stroke = '#0b1526' }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const last = useRef(null);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = '100%';
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2.6;
  }, [width, height, stroke]);

  const pos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e) => {
    e.preventDefault();
    drawing.current = true;
    last.current = pos(e);
    canvasRef.current.setPointerCapture?.(e.pointerId);
  };
  const move = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const p = pos(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (empty) { setEmpty(false); onChange?.(toDataUrl()); }
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    onChange?.(toDataUrl());
  };

  const toDataUrl = () => canvasRef.current.toDataURL('image/png');

  const clear = () => {
    const canvas = canvasRef.current;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    setEmpty(true);
    onChange?.(null);
  };

  return (
    <div className="drawpad">
      <canvas
        ref={canvasRef}
        className="drawpad-canvas"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        style={{ touchAction: 'none' }}
      />
      <div className="row gap">
        <button className="ghost" type="button" onClick={clear} disabled={empty}>Clear</button>
        <span className="hint">Sign inside the box</span>
      </div>
    </div>
  );
}
