# ── Stage 1: build the Vite frontend ─────────────────────────────────────────
FROM oven/bun:1 AS builder
WORKDIR /app

# Install dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Copy source and build
COPY . .
RUN bun run build

# ── Stage 2: production runtime ───────────────────────────────────────────────
FROM oven/bun:1 AS runner
WORKDIR /app

# Copy only what the server needs at runtime
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# Copy built frontend (served as static files by the Express server)
COPY --from=builder /app/dist ./dist

# Copy server source and any support files
COPY server/ ./server/
COPY src/     ./src/
COPY tsconfig.json ./
COPY vite.config.ts ./
COPY remappings.txt ./

# Data directory for persistent JSON files
RUN mkdir -p .data

# Expose the API port (Render sets PORT env var automatically)
EXPOSE 3001

# Start only the Express server — it serves the built frontend as static files
CMD ["bun", "run", "server/index.ts"]
