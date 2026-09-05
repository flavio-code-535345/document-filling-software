# AGENTS.md

## Project
DocFlow — PDF template automation studio. Monorepo, no workspace tool: `server/` (Express + Socket.io + pdf-lib, ESM) and `web/` (React 18 + Vite).

## Commands
- Dev: `npm --prefix server run dev` (:4000) and `npm --prefix web run dev` (:5173, proxies /api + /socket.io)
- Build: `npm --prefix web run build` (server then serves `web/dist` statically)
- Tests: `npm --prefix server run selftest | test:ws | test:e2e` — run all three after changing engine, gateway, or routes.

## Conventions
- Server is ESM (`"type": "module"`); use `import`, `.js` extensions in relative imports.
- Field coordinates: PDF points, TOP-LEFT origin everywhere except inside `pdfEngine.js` which converts to bottom-left for pdf-lib. Keep it that way.
- Runtime data lives in `server/data/` (gitignored) — templates, jobs, audit.log. Never commit it.
- Socket events are namespaced `session:*` / `signature:*`; payloads always validated server-side in `signatureGateway.js`.
- No database: persistence goes through `store/fileStore.js`; sessions through `store/sessionStore.js` (Redis-swap documented inside).
- Keep dependencies minimal; no UI framework on the web side.

## Environment
- Node.js ≥ 18.17 required. In this workspace, if `node` is not on PATH, a portable copy lives at `C:\Users\Flavio\AppData\Local\Temp\opencode\nodejs` — prefix `$env:PATH` in each PowerShell call.
- Server env vars: see `server/.env.example`.
