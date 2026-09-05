# AGENTS.md

## Project
DocFlow (Vordruckwerk) — self-hosted PDF form-filling engine. Next.js 16 App Router, TypeScript strict, React 19, Tailwind CSS 4 (dark theme). Single Docker container, file-based persistence. UI text in German, code/comments in English.

## Commands
- Dev: `npm run dev` (:3000). Requires `.env` (or env vars): `AUTH_SECRET` (≥32 chars), optional `DATA_DIR`.
- Build: `npm run build` → standalone output (`output: "standalone"` for Docker).
- Tests (manual smoke): boot dev server, or `node .next/standalone/server.js` after build. (No unit-test framework pinned yet.)

## Conventions
- `lib/types.ts` is the single source of truth for the domain model.
- Persistence: `$DATA_DIR/store.json` + `$DATA_DIR/templates/<uuid>.pdf`. Never commit `data/`.
- Auth: password scrypt (`scrypt:salt:hash`), sessions = HMAC token cookie `vw_session` (7d). Secret from `AUTH_SECRET`; fails loudly at request time, never at build time.
- All API routes: Route Handlers, `export const runtime = "nodejs"`, German errors `{ error: "..." }` via `lib/api.ts`.
- Field coordinates: PDF points, TOP-LEFT origin. Server fill (`lib/pdf/fill.ts`) and browser previews (SVG) both use `lib/geometry.ts` — keep the math in sync there only.
- pdfjs-dist v6: `getDocument({ url })`, `page.render({ canvas, viewport })`; worker in `public/` (postinstall script `scripts/copy-pdf-worker.mjs`). Load pdfjs only via `lib/pdf/client.ts`.
- React 19 gotchas: no `ref.current` writes during render; no sync `setState` in effect bodies; cancel previous `page.render()` tasks before re-render (StrictMode-safe).
- Sticky UI: app navbar is `top-0 z-40`; page toolbars stick at `top-16`.
- Email (nodemailer) is best-effort: log errors, never block downloads.

## Environment
- Node ≥ 20 (Docker: node:24-alpine). In this workspace, if `node` is not on PATH, a portable copy lives at `C:\Users\Flavio\AppData\Local\Temp\opencode\nodejs` — prefix `$env:PATH` in each PowerShell call.
- Deploy notes: register the admin immediately after first deploy (only the FIRST registered user becomes admin); put HTTPS in front; then `COOKIE_SECURE=true`.
