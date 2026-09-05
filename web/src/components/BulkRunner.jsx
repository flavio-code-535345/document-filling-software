import { useEffect, useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import { api } from '../api/client.js';

/**
 * BulkRunner — CSV in, hundreds of PDFs out.
 * Upload CSV -> map columns to template tags -> set output options ->
 * start job -> live progress -> download zip / combined PDF.
 */
export default function BulkRunner({ templates }) {
  const [templateId, setTemplateId] = useState('');
  const [schema, setSchema] = useState(null);
  const [csvFile, setCsvFile] = useState(null);
  const [columns, setColumns] = useState([]);
  const [previewRows, setPreviewRows] = useState([]);
  const [rowCount, setRowCount] = useState(0);
  const [mapping, setMapping] = useState({});
  const [filenamePattern, setFilenamePattern] = useState('document-{{_index}}');
  const [combine, setCombine] = useState(true);
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => {
    if (!templateId) { setSchema(null); return; }
    api.getTemplate(templateId).then(setSchema).catch(() => setSchema(null));
  }, [templateId]);

  const tags = useMemo(() => (schema?.fields || []).map((f) => f.tag).filter(Boolean), [schema]);

  const handleCsv = (file) => {
    setCsvFile(file);
    setError(null);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      preview: 6,
      complete: (res) => {
        setColumns(res.meta.fields || []);
        setPreviewRows(res.data.slice(0, 5));
        // auto-map exact header matches
        const auto = {};
        for (const col of res.meta.fields || []) if (tags.includes(col)) auto[col] = col;
        setMapping((m) => ({ ...auto, ...m }));
      },
    });
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => setRowCount(res.data.length),
    });
  };

  useEffect(() => () => clearInterval(pollRef.current), []);

  const start = async () => {
    setError(null);
    if (!templateId) return setError('Choose a template.');
    if (!csvFile) return setError('Upload a CSV file.');
    try {
      const { jobId } = await api.startBulkJob(templateId, csvFile, {
        mapping, filenamePattern, combine,
      });
      setJob({ id: jobId, status: 'queued', completed: 0, total: rowCount });
      pollRef.current = setInterval(async () => {
        try {
          const j = await api.getJob(jobId);
          setJob(j);
          if (j.status === 'done' || j.status === 'failed') clearInterval(pollRef.current);
        } catch { clearInterval(pollRef.current); }
      }, 800);
    } catch (err) { setError(err.message); }
  };

  const progress = job?.total ? Math.round(((job.completed + job.failed) / job.total) * 100) : 0;

  return (
    <div className="bulk">
      <h3>Bulk generation</h3>

      <div className="bulk-grid">
        <section>
          <h4>1. Template</h4>
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">— choose —</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.fieldCount} fields)</option>)}
          </select>
          {tags.length > 0 && <p className="hint">Tags: {tags.map((t) => <code key={t}>{`{{${t}}}`}</code>)}</p>}
        </section>

        <section>
          <h4>2. Data (CSV)</h4>
          <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && handleCsv(e.target.files[0])} />
          {rowCount > 0 && <p className="hint">{rowCount} data rows detected</p>}
          {previewRows.length > 0 && (
            <table className="mini-table">
              <thead><tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
              <tbody>
                {previewRows.map((r, i) => (
                  <tr key={i}>{columns.map((c) => <td key={c}>{String(r[c] ?? '').slice(0, 24)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section>
          <h4>3. Column mapping</h4>
          {columns.length === 0 && <p className="hint">Upload a CSV first.</p>}
          {columns.map((col) => (
            <div className="map-row" key={col}>
              <code>{col}</code>
              <span>→</span>
              <select value={mapping[col] ?? col} onChange={(e) => setMapping({ ...mapping, [col]: e.target.value })}>
                <option value={col}>{col}</option>
                {tags.filter((t) => t !== col).map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          ))}
        </section>

        <section>
          <h4>4. Output</h4>
          <label>Filename pattern
            <input value={filenamePattern} onChange={(e) => setFilenamePattern(e.target.value)} />
          </label>
          <label className="row-inline">
            <input type="checkbox" checked={combine} onChange={(e) => setCombine(e.target.checked)} />
            Also produce one combined PDF
          </label>
          <button className="primary big" onClick={start} disabled={job?.status === 'running' || job?.status === 'queued'}>
            Generate {rowCount > 0 ? `${rowCount} documents` : 'documents'}
          </button>
          {error && <p className="error">{error}</p>}
        </section>
      </div>

      {job && (
        <div className="job-status">
          <h4>Job {job.id} — {job.status}</h4>
          <div className="progress"><div className="progress-bar" style={{ width: `${progress}%` }} /></div>
          <p>{job.completed}/{job.total} generated{job.failed ? `, ${job.failed} failed` : ''}</p>
          {job.errors?.slice(0, 5).map((e, i) => <p key={i} className="error">Row {e.row}: {e.message}</p>)}
          {job.status === 'done' && (
            <div className="row gap">
              <a className="button primary" href={api.jobDownloadUrl(job.id)}>Download ZIP</a>
              {job.combinedFile && <a className="button" href={api.jobDownloadUrl(job.id, 'combined')}>Download combined PDF</a>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
