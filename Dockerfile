# syntax=docker/dockerfile:1

# --- Build stage: web ---
FROM oven/bun:1 AS web-builder
WORKDIR /app/web
COPY web/package.json web/bun.lock* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install
COPY web/src ./src
COPY web/index.html ./
COPY web/vite.config.ts ./
COPY web/tsconfig.json ./
COPY tsconfig.base.json /app/
RUN bun run build

# --- Build stage: server ---
FROM oven/bun:1 AS server-builder
WORKDIR /app/server
COPY server/package.json server/bun.lock* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install
COPY server/src ./src
COPY server/tsconfig.json ./
COPY tsconfig.base.json /app/

# --- Runtime ---
FROM oven/bun:1-slim AS runtime

# Non-root user
RUN groupadd -r doomscroller && useradd -r -g doomscroller -m doomscroller

WORKDIR /app

# Copy server source (Bun runs TS directly, no transpile needed)
COPY --from=server-builder /app/server/node_modules ./server/node_modules
COPY --from=server-builder /app/server/src ./server/src
COPY --from=server-builder /app/server/package.json ./server/

# Copy built web assets
COPY --from=web-builder /app/web/dist ./web/dist

# Create data directory
RUN mkdir -p /app/data && chown -R doomscroller:doomscroller /app/data

# Environment
ENV PORT=6767
ENV DATA_DIR=/app/data
ENV LLM_BASE_URL=http://llm:8081
ENV LLM_MODEL=gemma-4

EXPOSE 6767

USER doomscroller

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD bun -e "fetch('http://localhost:6767/health').then(r => process.exit(r.ok ? 0 : 1))"

WORKDIR /app
CMD ["bun", "run", "server/src/index.ts"]
