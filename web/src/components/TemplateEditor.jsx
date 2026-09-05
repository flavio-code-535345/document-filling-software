import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { loadPdf } from '../lib/pdf.js';
import PdfPage from './PdfPage.jsx';
import FieldPanel from './FieldPanel.jsx';
import SignatureModal from './SignatureModal.jsx';

const TOOLS = [
  { id: null, label: 'Select' },
  { id: 'text', label: '+ Text' },
  { id: 'date', label: '+ Date' },
  { id: 'signature', label: '+ Signature' },
  { id: 'checkbox', label: '+ Checkbox' },
];

/**
 * TemplateEditor — visual designer: renders the uploaded PDF, lets the user
 * draw variable fields, auto-detect AcroForm/AI fields, capture signatures,
 * save the schema, and generate a test-filled preview.
 */
export default function TemplateEditor({ template, onSaved }) {
  const [doc, setDoc] = useState(null);
  const [fields, setFields] = useState(template.fields || []);
  const [activeTool, setActiveTool] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [pageWidth, setPageWidth] = useState(760);
  const [status, setStatus] = useState('');
  const [signField, setSignField] = useState(null);
  const [previewRow, setPreviewRow] = useState('{}');
  const stageRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    loadPdf(api.templatePdfUrl(template.id)).then((d) => { if (!cancelled) setDoc(d); });
    return () => { cancelled = true; };
  }, [template.id]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPageWidth(Math.min(860, Math.max(320, el.clientWidth - 8))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const selected = useMemo(() => fields.find((f) => f.id === selectedId) || null, [fields, selectedId]);
  const allTags = useMemo(() => [...new Set(fields.map((f) => f.tag).filter(Boolean))], [fields]);

  const updateField = (next) => setFields(fields.map((f) => (f.id === next.id ? next : f)));
  const deleteField = (id) => { setFields(fields.filter((f) => f.id !== id)); setSelectedId(null); };

  const save = async () => {
    setStatus('Saving…');
    try {
      await api.saveFields(template.id, fields);
      setStatus(`Saved ${fields.length} fields.`);
      onSaved?.();
    } catch (err) { setStatus(`Save failed: ${err.message}`); }
  };

  const autodetect = async (useAI = false) => {
    setStatus(useAI ? 'AI is scanning the document…' : 'Detecting form fields…');
    try {
      const res = await api.autodetect(template.id, useAI);
      if (res.fields.length === 0) {
        setStatus('No fillable fields found. Try the AI option or draw boxes manually.');
        return;
      }
      const existing = new Set(fields.map((f) => `${f.tag}@${f.page}:${f.x},${f.y}`));
      const fresh = res.fields.filter((f) => !existing.has(`${f.tag}@${f.page}:${f.x},${f.y}`));
      setFields([...fields, ...fresh]);
      setStatus(`Auto-detect (${res.provider}) added ${fresh.length} fields.`);
    } catch (err) { setStatus(`Auto-detect failed: ${err.message}`); }
  };

  const preview = async () => {
    setStatus('Rendering preview…');
    try {
      let row = {};
      try { row = JSON.parse(previewRow || '{}'); } catch { setStatus('Preview data is not valid JSON.'); return; }
      // Signature defaults flow in automatically through field.defaultValue
      const blob = await api.preview(template.id, row);
      window.open(URL.createObjectURL(blob), '_blank');
      setStatus('Preview opened in a new tab.');
    } catch (err) { setStatus(`Preview failed: ${err.message}`); }
  };

  return (
    <div className="editor">
      <div className="toolbar">
        {TOOLS.map((t) => (
          <button key={t.label} className={activeTool === t.id ? 'active' : ''} onClick={() => setActiveTool(t.id)}>
            {t.label}
          </button>
        ))}
        <span className="spacer" />
        <button onClick={() => autodetect(false)} title="Reads fillable AcroForm widgets from the PDF">Auto-detect</button>
        <button onClick={() => autodetect(true)} title="Uses a multimodal AI model (requires OPENAI_API_KEY on the server)">AI detect ✨</button>
        <button className="primary" onClick={save}>Save schema</button>
      </div>

      <div className="editor-body">
        <div className="editor-stage" ref={stageRef}>
          {doc && Array.from({ length: doc.numPages }, (_, i) => (
            <PdfPage
              key={i}
              doc={doc}
              pageIndex={i}
              width={pageWidth}
              fields={fields}
              activeTool={activeTool}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onFieldsChange={setFields}
            />
          ))}
        </div>

        <aside className="editor-side">
          <FieldPanel
            field={selected}
            allTags={allTags}
            onChange={updateField}
            onDelete={deleteField}
            onSignClick={(f) => setSignField(f)}
          />

          <div className="preview-box">
            <h4>Test fill</h4>
            <textarea
              rows={5}
              value={previewRow}
              onChange={(e) => setPreviewRow(e.target.value)}
              placeholder={`{\n  ${allTags.map((t) => `"${t}": "…"`).join(',\n  ') || '"client_name": "Ada"'}\n}`}
              spellCheck={false}
            />
            <button onClick={preview}>Generate preview PDF</button>
          </div>

          {status && <p className="status-line">{status}</p>}
        </aside>
      </div>

      {signField && (
        <SignatureModal
          fieldLabel={signField.tag || 'signature'}
          onApply={(dataUrl) => updateField({ ...signField, defaultValue: dataUrl })}
          onClose={() => setSignField(null)}
        />
      )}
    </div>
  );
}
