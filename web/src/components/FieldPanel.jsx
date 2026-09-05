const FIELD_TYPES = ['text', 'date', 'signature', 'checkbox', 'image'];
const OPS = ['equals', 'notEquals', 'contains', 'truthy', 'falsy'];

/**
 * FieldPanel — property editor for the selected field: variable tag, type,
 * formatting, conditional visibility, and signature capture.
 */
export default function FieldPanel({ field, allTags, onChange, onDelete, onSignClick }) {
  if (!field) {
    return <div className="field-panel empty">Select a field on the page, or drag to create one with a tool above.</div>;
  }

  const set = (patch) => onChange({ ...field, ...patch });
  const cond = field.conditions?.[0] || null;

  return (
    <div className="field-panel">
      <h4>Field settings</h4>

      <label>Variable tag
        <input
          value={field.tag}
          placeholder="client_name"
          onChange={(e) => set({ tag: e.target.value.replace(/[^\w.-]/g, '_') })}
        />
      </label>

      <label>Type
        <select value={field.type} onChange={(e) => set({ type: e.target.value })}>
          {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </label>

      {field.type === 'date' && (
        <label>Date format
          <input value={field.format || 'YYYY-MM-DD'} onChange={(e) => set({ format: e.target.value })} />
        </label>
      )}

      {(field.type === 'text' || field.type === 'date') && (
        <>
          <label>Font size
            <input type="number" min="5" max="72" value={field.fontSize}
              onChange={(e) => set({ fontSize: Number(e.target.value) || 11 })} />
          </label>
          <label>Align
            <select value={field.align || 'left'} onChange={(e) => set({ align: e.target.value })}>
              <option value="left">left</option><option value="center">center</option><option value="right">right</option>
            </select>
          </label>
          <label className="row-inline">
            <input type="checkbox" checked={Boolean(field.bold)} onChange={(e) => set({ bold: e.target.checked })} />
            Bold
          </label>
        </>
      )}

      {field.type === 'text' && (
        <label>Value template
          <input
            value={field.template || ''}
            placeholder={`{{${field.tag || 'tag'}}} or "Hello {{first_name}}!"`}
            onChange={(e) => set({ template: e.target.value || undefined })}
          />
        </label>
      )}

      <label>Default value
        <input value={field.defaultValue || ''} onChange={(e) => set({ defaultValue: e.target.value || undefined })} />
      </label>

      <details>
        <summary>Conditional visibility</summary>
        <div className="cond-grid">
          <select
            value={cond?.when || ''}
            onChange={(e) => {
              const when = e.target.value;
              set({ conditions: when ? [{ when, op: cond?.op || 'equals', equals: cond?.equals ?? '' }] : [] });
            }}
          >
            <option value="">always visible</option>
            {allTags.filter((t) => t !== field.tag).map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          {cond && (
            <>
              <select value={cond.op || 'equals'} onChange={(e) => set({ conditions: [{ ...cond, op: e.target.value }] })}>
                {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
              {!['truthy', 'falsy'].includes(cond.op) && (
                <input value={cond.equals ?? ''} placeholder="value"
                  onChange={(e) => set({ conditions: [{ ...cond, equals: e.target.value }] })} />
              )}
            </>
          )}
        </div>
        <p className="hint">Only rendered for rows where this condition passes.</p>
      </details>

      {field.type === 'signature' && (
        <button className="primary" onClick={() => onSignClick(field)}>
          Capture signature…
        </button>
      )}

      <button className="danger" onClick={() => onDelete(field.id)}>Delete field</button>
    </div>
  );
}
