# ---- Build the web frontend (React + Vite) ----
FROM node:24-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- Build server dependencies ----
FROM node:24-alpine AS deps
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci

# ---- Runtime image ----
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY server/package.json ./
COPY server/src ./src

# Serve the built frontend from the server (app.js serves web/dist statically)
COPY --from=web /web/dist ./web/dist

RUN mkdir -p /data

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]
