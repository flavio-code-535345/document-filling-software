# DocFlow — PDF Automation Studio

Fill, automate, and sign PDF documents at scale. Upload a baseline PDF, draw
variable fields on it, then bulk-generate hundreds of personalized copies from
CSV/JSON — and capture live signatures from any phone via QR code.

## Feature set

### Core
- **Visual template designer** — upload a PDF, drag bounding boxes, assign
  variable tags (`{{client_name}}`), types (text / date / signature / checkbox /
  image), fonts, alignment, defaults.
- **Bulk automation engine** — CSV upload or JSON payload → one PDF per row,
  live progress, ZIP download plus an optional merged `combined.pdf`.
  Templating supports interpolation (`Hello {{first_name}}`), fallback filters
  (`{{middle_name | "n/a"}}`), and date formatting tokens (`DD.MM.YYYY`).
- **Live QR mobile signature** — the desktop editor shows a session QR code;
  scanning it opens a signing canvas on the phone; the signature streams over
  WebSockets and lands in the editor canvas in real time.
- **Fallback signatures** — draw with mouse or upload a transparent PNG/JPEG.

### Beyond the brief ("inspiration & abilities")
1. **AI form-field auto-detection** — one click scans the PDF and proposes
   fields. Works offline via AcroForm introspection; with `OPENAI_API_KEY` set,
   a multimodal model also detects blanks/lines in flat, scanned-style PDFs.
2. **Conditional logic templating** — per-field visibility rules
   (`country equals DE`) so one template serves many data shapes.
3. **Automated dispatch workflows** — after a job finishes, PDFs can be emailed
   per-row (SMTP) and/or the manifest pushed to a webhook (CRM/DMS integration).
4. **Compliance audit trail** — append-only JSONL log of template changes,
   jobs, and signature events (`server/data/audit.log`).
5. **Signature session security model** — separate host/signer tokens, TTL
   expiry, payload caps, single-recipient delivery (see below).

## Tech stack & architecture

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | React 18 + Vite | fast dev loop, tiny bundle, easy LAN serving for phones |
| PDF rendering (client) | pdf.js (`pdfjs-dist` 3.11) | pixel-accurate page previews in the editor |
| Backend | Node.js (ESM) + Express 4 | simple, ubiquitous, streams PDFs well |
| PDF engine | pdf-lib | pure-JS, embeds fonts/images, AcroForm read, merge support |
| Realtime | Socket.io 4 | rooms + acks, auto-reconnect, websocket transport |
| Storage | filesystem (`server/data`) | zero-config; swap for Postgres/S3 behind the store interface |
| Sessions | in-memory TTL store | Redis drop-in documented in `sessionStore.js` |
| Jobs | in-process async runner | BullMQ/SQS-ready seam in `bulkProcessor.js` |
| Email | nodemailer (optional) | per-row dispatch when SMTP env vars are set |

```
web/  (React SPA, :5173)                    server/ (Express + Socket.io, :4000)
├─ src/pages/MobileSign.jsx   ◄── phone ──► ├─ src/sockets/signatureGateway.js
├─ src/components/                          ├─ src/routes/{templates,generate,
│   ├─ TemplateEditor.jsx                     signatureSessions}.js
│   ├─ PdfPage.jsx (draw/move/resize)       ├─ src/services/
│   ├─ BulkRunner.jsx (CSV→PDFs)            │   ├─ pdfEngine.js (render/merge)
│   ├─ SignatureModal.jsx                   │   ├─ bulkProcessor.js (job runner)
│   │   └─ QrSignatureBridge.jsx            │   ├─ autodetect.js (AcroForm+AI)
│   └─ DrawPad.jsx                          │   └─ dispatch.js (email/webhook)
└─ src/hooks/useSignatureSocket.js          └─ src/store/{fileStore,sessionStore}.js
```

In production, `npm run build` + `npm start` serves the SPA from the server
itself (single origin, phone-friendly). In dev, Vite proxies `/api` and
`/socket.io` to `:4000`.

## WebSocket signature flow (QR pairing)

```
Desktop editor (HOST)                     Server                    Phone (SIGNER)
─────────────────────                     ──────                    ────────────────
POST /api/signature-sessions ───────────► create session
◄── { sessionId, hostToken,              TTL 10 min
      signerToken, signerUrl }           signerUrl = app/#/sign?session&token=<signerToken>
render QR(signerUrl)
                                              ▲ scan QR, open page
session:join {hostToken, role:'host'} ─► room sig:<id>        session:join {signerToken, role:'signer'}
◄── session:peer-joined                  mark "paired" ◄──────────────┘
signature:request {label} ──────────────► forward ──────────► signature:requested
                                                               (user draws)
◄── signature:applied {dataUrl} ◄──────── validate+store ◄──── signature:submit {dataUrl}
render on canvas instantly                 audit log
signature:ack {accepted:true} ──────────► forward ──────────► signature:ack ("Delivered")
```

Security properties:
- Host and signer hold **different** 128-bit random tokens; the QR only ever
  carries the signer token.
- Tokens are single-session and expire (`SIGN_SESSION_TTL_MINUTES`, default 10).
- Signature images are delivered **only** to the host socket — never broadcast.
- Payloads capped (2.5 MB) and must be PNG/JPEG data URLs; socket frames capped
  at 4 MB (`maxHttpBufferSize`).

## Getting started

Prereqs: Node.js ≥ 18.17.

```bash
# 1. install
npm --prefix server install
npm --prefix web install

# 2. run (two terminals)
npm --prefix server run dev     # API + WebSocket on :4000
npm --prefix web run dev        # SPA on :5173, --host enabled for phones
```

Open `http://<your-LAN-IP>:5173` (not `localhost`, if you want phone signing
to work) — the QR code encodes whatever host you used.

Production single-port mode:

```bash
npm --prefix web run build
npm --prefix server start       # serves API + SPA + WS on :4000
```

## REST API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/templates` | upload baseline PDF (multipart `pdf`) |
| GET | `/api/templates` / `/:id` / `/:id/pdf` | list / schema / raw PDF |
| PUT | `/api/templates/:id/fields` | save field schema |
| POST | `/api/templates/:id/autodetect` | `{useAI?}` → proposed fields |
| POST | `/api/generate` | bulk job: multipart CSV or JSON `{templateId, rows, options}` |
| POST | `/api/generate/preview` | single test-filled PDF |
| GET | `/api/jobs/:id` | job status/progress |
| GET | `/api/jobs/:id/download[?file=combined]` | ZIP / combined PDF |
| POST | `/api/signature-sessions` | create QR signing session |
| GET | `/api/signature-sessions/:id` | public status (no secrets) |

## Field schema (excerpt)

```json
{
  "id": "fld_x1", "tag": "client_name", "type": "text",
  "page": 0, "x": 120, "y": 96, "w": 220, "h": 18,
  "fontSize": 11, "align": "left", "bold": false,
  "template": "Hello {{first_name}}!",
  "conditions": [{ "when": "country", "op": "equals", "equals": "DE" }]
}
```

Coordinates are **PDF points, top-left origin** (the engine converts to
pdf-lib's bottom-left origin). Types: `text`, `date`, `signature`, `checkbox`,
`image`.

## Tests

```bash
npm --prefix server run selftest   # engine: interpolation, autodetect, render, merge
npm --prefix server run test:ws    # full QR socket flow (pair, submit, ack, limits)
npm --prefix server run test:e2e   # REST pipeline: upload → detect → bulk → download
```

## Configuration

See `server/.env.example` — port, public web URL (for QR links), session TTL,
upload limits, OpenAI (AI detection), SMTP (email dispatch), webhook URL.

## Roadmap seams (designed, not yet built)
- Redis-backed sessions + BullMQ workers for horizontal scaling
- OCR pipeline (Tesseract/Azure) for scanned paper → template
- Template versioning UI + diff rollback
- Hosted e-sign provider bridge (DocuSign/Stripe Identity style hand-off)
