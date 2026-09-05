import { useState } from 'react';
import QrSignatureBridge from './QrSignatureBridge.jsx';
import DrawPad from './DrawPad.jsx';

/**
 * SignatureModal — three ways to capture a signature:
 *   1. Phone via QR code (live WebSocket transfer)
 *   2. Draw with mouse (DrawPad)
 *   3. Upload a transparent PNG / JPEG
 * Result is delivered as a PNG/JPEG data-URL via onApply.
 */
export default function SignatureModal({ fieldLabel, onApply, onClose }) {
  const [tab, setTab] = useState('qr');
  const [drawn, setDrawn] = useState(null);
  const [uploadError, setUploadError] = useState(null);

  const handleUpload = (e) => {
    setUploadError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setUploadError('Please upload a PNG or JPEG (transparent PNG recommended).');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setUploadError('Image too large (max 2MB).');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => { onApply(reader.result); onClose(); };
    reader.readAsDataURL(file);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Add signature — {fieldLabel}</h3>
          <button className="ghost" onClick={onClose}>✕</button>
        </div>

        <div className="tabs">
          <button className={tab === 'qr' ? 'active' : ''} onClick={() => setTab('qr')}>Phone (QR)</button>
          <button className={tab === 'draw' ? 'active' : ''} onClick={() => setTab('draw')}>Draw</button>
          <button className={tab === 'upload' ? 'active' : ''} onClick={() => setTab('upload')}>Upload</button>
        </div>

        {tab === 'qr' && (
          <QrSignatureBridge fieldLabel={fieldLabel} onApply={onApply} onClose={onClose} />
        )}

        {tab === 'draw' && (
          <>
            <DrawPad onChange={setDrawn} />
            <div className="row gap">
              <button className="primary" disabled={!drawn} onClick={() => { onApply(drawn); onClose(); }}>
                Use this signature
              </button>
            </div>
          </>
        )}

        {tab === 'upload' && (
          <>
            <input type="file" accept="image/png,image/jpeg" onChange={handleUpload} />
            {uploadError && <p className="error">{uploadError}</p>}
            <p className="hint">Transparent PNG works best — it is scaled to fit the signature box.</p>
          </>
        )}
      </div>
    </div>
  );
}
