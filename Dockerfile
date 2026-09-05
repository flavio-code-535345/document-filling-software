# ── Stage 1: dependencies (postinstall copies the pdfjs worker, so
#    scripts/ must be copied BEFORE `npm ci`) ──────────────────────────────
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci

# ── Stage 2: build ────────────────────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# AUTH_SECRET is only enforced at request time; a placeholder keeps the
# build phase green. The real secret is injected at runtime.
ENV AUTH_SECRET=build-placeholder-0123456789abcdef0123456789abcdef
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── Stage 3: run (standalone output) ──────────────────────────────────────
FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

RUN mkdir -p /app/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
