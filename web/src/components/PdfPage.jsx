import { useEffect, useRef, useState } from 'react';
import { renderPage } from '../lib/pdf.js';

const TYPE_COLORS = {
  text: '#2563eb',
  date: '#7c3aed',
  signature: '#059669',
  checkbox: '#d97706',
  image: '#db2777',
};

/**
 * PdfPage — renders one PDF page (pdf.js) plus an interactive overlay:
 *  - drag on empty space with an active tool -> creates a field
 *  - click a box -> select; drag -> move; corner handle -> resize
 * All coordinates are stored in PDF points, top-left origin, scale-independent.
 */
export default function PdfPage({ doc, pageIndex, width, fields, activeTool, selectedId, onSelect, onFieldsChange }) {
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const [geom, setGeom] = useState(null); // { scale, pageWidthPt, pageHeightPt }
  const dragState = useRef(null); // { mode: 'create'|'move'|'resize', ... }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!doc) return;
      const g = await renderPage(doc, pageIndex, canvasRef.current, width);
      if (!cancelled) setGeom(g);
    })();
    return () => { cancelled = true; };
  }, [doc, pageIndex, width]);

  const toPt = (e) => {
    const rect = overlayRef.current.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / geom.scale,
      y: (e.clientY - rect.top) / geom.scale,
    };
  };

  const pageFields = fields.filter((f) => f.page === pageIndex);

  const onPointerDown = (e) => {
    if (!geom) return;
    const handle = e.target.dataset?.handle;
    const boxId = e.target.dataset?.fieldId || e.target.closest('[data-field-id]')?.dataset.fieldId;
    const p = toPt(e);

    if (handle && boxId) {
      const field = fields.find((f) => f.id === boxId);
      dragState.current = { mode: 'resize', id: boxId, start: p, orig: { ...field } };
      onSelect(boxId);
    } else if (boxId) {
      const field = fields.find((f) => f.id === boxId);
      dragState.current = { mode: 'move', id: boxId, start: p, orig: { ...field } };
      onSelect(boxId);
    } else if (activeTool) {
      const id = `fld_${Math.random().toString(36).slice(2, 10)}`;
      const field = {
        id, tag: '', type: activeTool, page: pageIndex,
        x: Math.round(p.x), y: Math.round(p.y), w: 4, h: 4,
        fontSize: 11, color: '#111111', align: 'left', conditions: [],
      };
      dragState.current = { mode: 'create', id, start: p, orig: field };
      onFieldsChange([...fields, field]);
      onSelect(id);
    } else {
      onSelect(null);
      return;
    }
    e.preventDefault();
    overlayRef.current.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e) => {
    const drag = dragState.current;
    if (!drag || !geom) return;
    const p = toPt(e);
    const dx = p.x - drag.start.x;
    const dy = p.y - drag.start.y;
    const next = fields.map((f) => {
      if (f.id !== drag.id) return f;
      const o = drag.orig;
      if (drag.mode === 'create') {
        return {
          ...f,
          x: Math.round(Math.min(drag.start.x, p.x)),
          y: Math.round(Math.min(drag.start.y, p.y)),
          w: Math.max(4, Math.round(Math.abs(dx))),
          h: Math.max(4, Math.round(Math.abs(dy))),
        };
      }
      if (drag.mode === 'move') {
        return { ...f, x: Math.round(o.x + dx), y: Math.round(o.y + dy) };
      }
      return { ...f, w: Math.max(4, Math.round(o.w + dx)), h: Math.max(4, Math.round(o.h + dy)) };
    });
    onFieldsChange(next);
  };

  const onPointerUp = () => { dragState.current = null; };

  return (
    <div className="pdf-page" style={{ width }}>
      <canvas ref={canvasRef} className="pdf-canvas" />
      <div
        ref={overlayRef}
        className={`pdf-overlay tool-${activeTool || 'select'}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {geom && pageFields.map((f) => (
          <div
            key={f.id}
            data-field-id={f.id}
            className={`field-box ${selectedId === f.id ? 'selected' : ''}`}
            style={{
              left: f.x * geom.scale,
              top: f.y * geom.scale,
              width: f.w * geom.scale,
              height: f.h * geom.scale,
              borderColor: TYPE_COLORS[f.type] || '#2563eb',
              backgroundColor: `${TYPE_COLORS[f.type] || '#2563eb'}18`,
            }}
          >
            <span className="field-label" style={{ background: TYPE_COLORS[f.type] || '#2563eb' }}>
              {f.tag || f.type}
            </span>
            {f.type === 'signature' && f.defaultValue?.startsWith('data:image') && (
              <img src={f.defaultValue} alt="" className="field-signature-preview" />
            )}
            {selectedId === f.id && (
              <span data-handle="se" data-field-id={f.id} className="resize-handle" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
