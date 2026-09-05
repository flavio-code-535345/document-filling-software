# DocFlow (Vordruckwerk)

Self-hosted PDF form-filling engine — single Docker container, no database.

Admins upload scanned paper form PDFs and visually place fillable fields
(text, multiline, date, checkbox, signature, checkbox-matrix). Users log in,
fill a plain web form with live PDF preview, optionally sign via touchscreen
or their phone (QR code), and download the print-ready filled PDF and/or have
it emailed.

## Run locally

```bash
# .env (min. 32 Zeichen):
AUTH_SECRET=$(openssl rand -hex 32)   # on Windows: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

npm install
npm run dev     # http://localhost:3000
```

**Important:** register the FIRST user immediately — only the very first
registered account becomes administrator. Later registrations become access
requests that admins approve under *Benutzerverwaltung*.

## Docker

Three-stage build (`deps → build → run`, standalone output). The
`postinstall` script copies the pdfjs worker into `public/`, which is why
`COPY scripts ./scripts` happens BEFORE `npm ci` in the deps stage.

```bash
docker build -t flavio11113/docflow:latest .
docker compose up -d        # AUTH_SECRET from .env, data volume at /app/data
```

Deploy behind HTTPS (reverse proxy), then set `COOKIE_SECURE=true`.

## Structure

- `app/api/**` — Route Handlers (auth, templates, fill, sign-session, users, settings, signature, profile)
- `app/**` — pages (home, login, fill, sign (public), profile, admin{ editor, settings, users })
- `lib/types.ts` — domain model (single source of truth)
- `lib/auth.ts` — scrypt passwords + HMAC session tokens (node:crypto only)
- `lib/store.ts` — file store (`$DATA_DIR/store.json`, serialized writes)
- `lib/pdf/fill.ts` — server-side pdf-lib rendering
- `lib/geometry.ts` — placement math shared by server fill and browser SVG previews
- `components/editor/**` — visual field editor (tools, drag/resize/snap, matrix, Feintuning)
- `components/fill/**` — fill form with live SVG preview
- `components/sign/**` — public phone signature page
- `scripts/copy-pdf-worker.mjs` — copies pdfjs worker into `public/` (postinstall)

## Matrix tool

Two clicks stamp a matrix: first = top-left cell center, second = bottom-right
cell center (defines origin + pitch from the default 3×3 labels). Label rows
and columns are edited as lists (box grows/shrinks with pitch). Drift inputs
compensate rotated scans; "🎯 Feintuning" adjusts per-column (Alt = per-row)
offsets in 0.25 pt steps via the arrow keys.

## Env vars

| Var | Required | Purpose |
| --- | --- | --- |
| `AUTH_SECRET` | yes | session signature (≥32 chars) |
| `DATA_DIR` | no | store location (default `./data`) |
| `COOKIE_SECURE` | no | `true` behind HTTPS |
