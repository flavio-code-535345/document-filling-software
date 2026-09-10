# AGENTS.md

## Project
DocFlow (Vordruckwerk) — self-hosted PDF form-filling engine. Next.js 16 App Router, TypeScript strict, React 19, Tailwind CSS 4 (dark theme). Single Docker container, file-based persistence. UI text in German, code/comments in English.

Two halves of the app share the same field model but are separate directory trees:
- `components/editor/` — admin template designer. `TemplateEditor.tsx` is the orchestrator (state, save/discard, keyboard shortcuts) and composes `PdfPageView.tsx` (canvas + drag/resize/marquee-select), `Inspector.tsx` (per-field property panel), `FieldListPanel.tsx`, `AlignToolbar.tsx` (align/distribute/link, shown on multi-select).
- `components/fill/` — end-user fill form. `FillForm.tsx` (values, drafts, date-series, semantic timesheet grouping) + `PagePreview.tsx` (read-only live preview).

## Commands
- Dev: `npm run dev` (:3000). Requires `.env` (or env vars): `AUTH_SECRET` (≥32 chars), optional `DATA_DIR`.
- Typecheck (fast, use before every non-trivial change): `npx tsc --noEmit`.
- Build: `npm run build` → standalone output (`output: "standalone"` for Docker). Needs `AUTH_SECRET` set in the shell (e.g. `$env:AUTH_SECRET="..."`) or it fails at build-time page collection, not just at request time.
- Tests (manual smoke): boot dev server, or `node .next/standalone/server.js` after build. (No unit-test framework pinned yet.)
- CI (`.github/workflows/pr-ci.yml`): on every push/PR to `main` it runs `npm ci && npm run build`. On push to `main` (or manual `workflow_dispatch`) a second job **builds and pushes a Docker image to Docker Hub** (`docflow:latest` + `:<sha>`) using `DOCKER_USERNAME`/`DOCKER_PASSWORD` secrets. Pushing to `main` is a real release, not just a cosmetic sync — confirm with the user before `git push`.

## Conventions
- `lib/types.ts` is the single source of truth for the domain model (`TemplateField`, `StoredTemplate`, `Store`, etc.).
- Persistence: `$DATA_DIR/store.json` (single JSON blob, serialized writes via `lib/store.ts#withStore`) + `$DATA_DIR/templates/<uuid>.pdf`. Never commit `data/`.
- Auth: password scrypt (`scrypt:salt:hash`), sessions = HMAC token cookie `vw_session` (7d). Secret from `AUTH_SECRET`; fails loudly at request time, never at build time.
- All API routes: Route Handlers, `export const runtime = "nodejs"`, German errors `{ error: "..." }` via `lib/api.ts` (`jsonError`/`jsonErrorFor`/`parseJsonBody`).
- Field coordinates: PDF points, TOP-LEFT origin, always in **un-rotated media-box space** even when `pageRotations` is set. `lib/pdf/fill.ts` (server export) and `components/PreviewSvg.tsx` (editor overlay + fill-form preview) render the exact same field, so any text-placement change must update **both**, using the shared math in `lib/geometry.ts` (`baselineFromTop`, `textAlignX`, `fitSingleLine`, `fitMultiline`, `multilineFirstBaseline`, matrix helpers). Server measures text via pdf-lib `font.widthOfTextAtSize`; browser measures via `lib/pdf/client.ts#measureText`/`wrapClient` (canvas 2D context) — keep the `measure` fn signature `(text, size) => width` identical on both sides.
- `TemplateField.linkKey`: fields sharing a `linkKey` collapse into one input in the fill form (`FillForm.tsx#groupFields`); create/remove links from the editor's `AlignToolbar` (shown on 2+ field selection). Legacy fallback: fields with identical `label`+`kind` and no `linkKey` also group.
- `StoredTemplate.pageRotations[page]` (`0|90|180|270`): server rotates via `page.setRotation(degrees(rot))` in `fill.ts` (pdf-lib rotates background + drawn content together, so field coords never change). Previews replicate this visually by wrapping canvas+SVG in a CSS-rotated `<div>` centered inside an outer box sized to the *display* (width/height swapped for 90/270) — see `PdfPageView.tsx`/`PagePreview.tsx`. The editor's pointer→field-coordinate math (`toPt` in `PdfPageView.tsx`) must inverse-rotate screen coords back to media space.
- pdfjs-dist v6: `getDocument({ url })`, `page.render({ canvas, viewport })`; worker in `public/` (postinstall script `scripts/copy-pdf-worker.mjs`). Load pdfjs only via `lib/pdf/client.ts`.
- Drafts are server-side, not `localStorage`: `Store.savedFills` + `/api/fills` routes. One reserved auto-draft per user+template (`auto: true`, debounced ~800ms save from `FillForm.tsx`) plus named drafts the user can select and overwrite.
- React 19 gotchas: no `ref.current` writes during render; no sync `setState` in effect bodies; cancel previous `page.render()` tasks before re-render (StrictMode-safe).
- Sticky UI: app navbar is `top-0 z-40`; page toolbars stick at `top-16`.
- Email (nodemailer) is best-effort: log errors, never block downloads.

## Known footguns (already hit in this repo — don't reintroduce)
- Never read `localStorage`/`window` inside a `useState(() => …)` lazy initializer in `components/fill/*` or `components/editor/*` — these are client components rendered under SSR, so the lazy initializer runs on the server too, producing empty state that mismatches the client's hydrated state. Load such data in a `useEffect` after mount instead.
- Never gate a `<canvas>`'s mount on state that is only set by measuring that same canvas via its ref — the canvas then never mounts, the measurement effect never runs, and the state never updates (permanent blank render). Always mount the canvas unconditionally and gate overlays/siblings around it.

## Environment
- Node ≥ 20 (Docker: node:24-alpine). In this workspace, if `node` is not on PATH, a portable copy lives at `C:\Users\Flavio\AppData\Local\Temp\opencode\nodejs` — prefix `$env:PATH` in each PowerShell call.
- Deploy notes: register the admin immediately after first deploy (only the FIRST registered user becomes admin); put HTTPS in front; then `COOKIE_SECURE=true`.
