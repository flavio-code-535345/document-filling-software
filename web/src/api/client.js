/** API client for the DocFlow server. */
const base = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${base}${path}`, options);
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try { message = (await res.json()).error || message; } catch { /* non-JSON */ }
    throw new Error(message);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res;
}

export const api = {
  health: () => request('/health'),

  // Templates
  listTemplates: () => request('/templates'),
  getTemplate: (id) => request(`/templates/${id}`),
  templatePdfUrl: (id) => `${base}/templates/${id}/pdf`,
  uploadTemplate: (file, name) => {
    const fd = new FormData();
    fd.append('pdf', file);
    if (name) fd.append('name', name);
    return request('/templates', { method: 'POST', body: fd });
  },
  saveFields: (id, fields) =>
    request(`/templates/${id}/fields`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    }),
  autodetect: (id, useAI = false) =>
    request(`/templates/${id}/autodetect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ useAI }),
    }),
  deleteTemplate: (id) => request(`/templates/${id}`, { method: 'DELETE' }),

  // Generation
  preview: (templateId, row) =>
    fetch(`${base}/generate/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId, row }),
    }).then((r) => {
      if (!r.ok) throw new Error('Preview failed');
      return r.blob();
    }),
  startBulkJob: (templateId, csvFile, options) => {
    const fd = new FormData();
    fd.append('templateId', templateId);
    fd.append('csv', csvFile);
    fd.append('options', JSON.stringify(options));
    return request('/generate', { method: 'POST', body: fd });
  },
  getJob: (id) => request(`/jobs/${id}`),
  jobDownloadUrl: (id, file) => `${base}/jobs/${id}/download${file ? `?file=${encodeURIComponent(file)}` : ''}`,

  // Signature sessions
  createSignatureSession: (context) =>
    request('/signature-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context }),
    }),
};
