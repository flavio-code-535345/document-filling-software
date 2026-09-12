# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This repo also has an `AGENTS.md` with detailed conventions, known footguns, and environment notes — **read it too**; it is not duplicated here in full.

## Project

DocFlow (Vordruckwerk) — self-hosted PDF form-filling engine. Admins upload scanned paper-form PDFs and visually place fillable fields (text, multiline, date, checkbox, signature, checkbox-matrix) on top of them; users fill a plain web form with a live PDF preview, optionally sign via touchscreen or phone QR code, and download/email the print-ready filled PDF. Next.js 16 App Router, TypeScript strict, React 19, Tailwind CSS 4 (dark theme), single Docker container, file-based persistence (no database). UI text is German; code/comments are English.

The **first** user ever registered becomes admin automatically; later registrations become access requests an admin must approve.

## Commands

```bash
npm install                 # postinstall copies the pdfjs worker into public/
npm run dev                 # http://localhost:3000 — needs AUTH_SECRET (>=32 chars) in .env or env
npx tsc --noEmit             # typecheck — run before every non-trivial change; no separate lint script
npm run build                # standalone output for Docker; needs AUTH_SECRET set in the shell or it
                              # fails at build-time page collection, not just at request time
npm start                    # run the production build
```

There is no unit-test framework pinned. "Testing" here means: typecheck, `npm run build`, and manual smoke-testing via the dev server (register the first user, upload a PDF, place fields, fill it, check the exported PDF).

CI (`.github/workflows/pr-ci.yml`): every push/PR to `main` runs `npm ci && npm run build`. A push to `main` (or manual `workflow_dispatch`) additionally **builds and pushes a Docker image to Docker Hub** (`docflow:latest` + `:<sha>`). Pushing to `main` is a real release — confirm with the user before `git push`.

## Architecture

Two halves of the app share the same field model (`lib/types.ts#TemplateField`, `StoredTemplate`) but live in separate directory trees and separate rendering pipelines:

- **`components/editor/`** — admin template designer. `TemplateEditor.tsx` is the orchestrator (zoom/pan state, tool selection, save/discard, keyboard shortcuts, multi-select/align/link) and composes `PdfPageView.tsx` (pdf.js canvas + pointer-driven drag/resize/marquee-select/region-drag tools), `Inspector.tsx` (draggable per-field property popover, including the formula editor), `FieldListPanel.tsx`, `AlignToolbar.tsx`.
- **`components/fill/`** — end-user fill form. `FillForm.tsx` (values, server-side drafts, date-series, semantic day/timesheet grouping) + `PagePreview.tsx` (read-only live SVG preview).

Persistence is a single JSON blob per install: `$DATA_DIR/store.json` (serialized writes via `lib/store.ts#withStore`) plus `$DATA_DIR/templates/<uuid>.pdf`. All API routes are Route Handlers under `app/api/**` with `export const runtime = "nodejs"`, returning German error strings via `lib/api.ts`.

**Field coordinates** are PDF points, top-left origin, always in *un-rotated media-box space* even when a page is rotated. Two independent renderers draw the exact same field from that one coordinate space and must be kept in sync: `lib/pdf/fill.ts` (server-side pdf-lib export) and `components/PreviewSvg.tsx` (editor overlay + fill-form live preview), sharing placement math from `lib/geometry.ts`. Text measurement also has two independent implementations that must stay behaviorally identical: pdf-lib's `font.widthOfTextAtSize` on the server vs. `lib/pdf/client.ts#measureText`/`wrapClient` (canvas 2D context) in the browser.

**Page rotation** (`StoredTemplate.pageRotations[page]`, `0|90|180|270`): pdf-lib rotates the whole page at export time, so field coordinates never change; previews replicate this by CSS-rotating a canvas+SVG wrapper div. Any pointer→coordinate math in the editor (`PdfPageView.tsx#toPt`) must inverse-rotate screen coordinates back to media space, and the click/drag-to-zoom tool in the same file works in raw screen-pixel space specifically to avoid needing that inversion for scroll anchoring.

**Formula fields** (`lib/formula.ts`): an Excel-like engine — hand-written tokenizer + recursive-descent parser (no `eval`) — for computed, read-only fields that reference other fields by label (`{Label}`) and can chain onto other formula fields. Supports `+ - * / %`, comparisons (`= <> < <= > >=`), and `SUM MIN MAX AVG ABS ROUND ROUNDUP ROUNDDOWN CEIL FLOOR MOD IF AND OR NOT`. `evaluateFormulas` is the authoritative evaluator used both by the fill form (live) and `lib/pdf/fill.ts` (export time); `previewFormula` is a separate non-swallowing variant used only by the editor's `Inspector.tsx` to surface real parser errors while a formula is being typed. Note: `,` is both the German decimal separator and the function-argument separator — a bare `N,N` is ambiguous and resolves in favor of the decimal; use a space after commas or `;` to disambiguate.

**Linking**: fields sharing a `TemplateField.linkKey` collapse into one input in the fill form (`FillForm.tsx#groupFields`); create/remove links from the editor's `AlignToolbar` on a 2+ field selection.

Drafts are server-side (`Store.savedFills` + `/api/fills`), not `localStorage` — one reserved auto-draft per user+template plus named drafts.
