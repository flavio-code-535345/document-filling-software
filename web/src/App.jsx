import { useCallback, useEffect, useState } from 'react';
import { api } from './api/client.js';
import TemplateEditor from './components/TemplateEditor.jsx';
import BulkRunner from './components/BulkRunner.jsx';

/** Template manager: upload + list. */
function TemplateManager({ onOpen, refreshKey }) {
  const [templates, setTemplates] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const reload = useCallback(() => api.listTemplates().then(setTemplates).catch((e) => setError(e.message)), []);
  useEffect(() => { reload(); }, [reload, refreshKey]);

  const upload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setError(null);
    try { await api.uploadTemplate(file, file.name.replace(/\.pdf$/i, '')); await reload(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); e.target.value = ''; }
  };

  return (
    <div className="template-manager">
      <div className="row gap spread">
        <h3>Templates</h3>
        <label className="button primary">
          {busy ? 'Uploading…' : 'Upload PDF'}
          <input type="file" accept="application/pdf" hidden onChange={upload} disabled={busy} />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      {templates.length === 0 && <p className="hint">Upload a baseline PDF to create your first template.</p>}
      <ul className="template-list">
        {templates.map((t) => (
          <li key={t.id}>
            <div>
              <strong>{t.name}</strong>
              <span className="hint"> {t.pageCount} pages · {t.fieldCount} fields · {new Date(t.updatedAt).toLocaleString()}</span>
            </div>
            <div className="row gap">
              <button onClick={() => onOpen(t.id)}>Open editor</button>
              <button className="ghost danger" onClick={async () => { await api.deleteTemplate(t.id); reload(); }}>Delete</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState('templates');
  const [templates, setTemplates] = useState([]);
  const [activeTemplate, setActiveTemplate] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [serverOk, setServerOk] = useState(null);

  const refreshTemplates = useCallback(() => {
    api.listTemplates().then(setTemplates).catch(() => setTemplates([]));
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    api.health().then(() => setServerOk(true)).catch(() => setServerOk(false));
    refreshTemplates();
  }, [refreshTemplates]);

  const openEditor = async (id) => {
    setActiveTemplate(await api.getTemplate(id));
    setTab('editor');
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>DocFlow <span className="tagline">PDF Automation Studio</span></h1>
        <nav>
          <button className={tab === 'templates' ? 'active' : ''} onClick={() => setTab('templates')}>Templates</button>
          <button className={tab === 'editor' ? 'active' : ''} disabled={!activeTemplate} onClick={() => setTab('editor')}>Editor</button>
          <button className={tab === 'bulk' ? 'active' : ''} onClick={() => setTab('bulk')}>Bulk generation</button>
        </nav>
        <span className={`server-dot ${serverOk ? 'ok' : 'bad'}`} title={serverOk ? 'Server connected' : 'Server offline'} />
      </header>

      <main>
        {serverOk === false && (
          <p className="error">Server not reachable at <code>:4000</code> — start it with <code>npm run dev:server</code>.</p>
        )}
        {tab === 'templates' && <TemplateManager onOpen={openEditor} refreshKey={refreshKey} />}
        {tab === 'editor' && activeTemplate && <TemplateEditor template={activeTemplate} onSaved={refreshTemplates} />}
        {tab === 'bulk' && <BulkRunner templates={templates} />}
      </main>
    </div>
  );
}
