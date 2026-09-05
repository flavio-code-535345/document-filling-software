FROM --platform=linux/amd64 node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY config.js ./
COPY .env.example ..

# Production stage
FROM --platform=linux/amd64 node:24-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package.json ./
RUN npm ci --omit=dev && npm install --global serve
COPY --from=builder /app/src/ ./
COPY --from=builder /app/scripts/ ./
COPY --from=builder /app/config.js ./
COPY --from=builder /app/.env.example ..

EXPOSE 4000
CMD ["node", "src/index.js"]