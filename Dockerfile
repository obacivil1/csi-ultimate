# ────────────────────────────────────────────────────────────────
# CSI-Ultimate — Production Dockerfile
# ────────────────────────────────────────────────────────────────
# Build:    docker build -t csi-ultimate .
# Run:      docker run -d --name csi -e CSI_LOG_LEVEL=INFO \
#             -v "$(pwd)/data:/app/data" \
#             -v "$(pwd)/state:/app/state" \
#             -v "$(pwd)/config:/app/config" \
#             csi-ultimate core/run.mjs expatriates.com "Job Seekers" engineer 1w
#
# Run with dashboard:
#           docker run -it --rm csi-ultimate core/run.mjs expatriates.com "Job Seekers" engineer 1w --uat
#
# Run server:
#           docker run -d --name csi-server -p 3031:3031 \
#             csi-ultimate node engine/server.mjs
# ────────────────────────────────────────────────────────────────

# ── Stage 1: System dependencies ────────────────────────────────
FROM node:22-bookworm-slim AS base

# Install Playwright system deps (minimal set)
# chromium + firefox + webkit
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    wget \
    git \
    gnupg \
    # Playwright chromium dependencies
    libnss3 \
    libnspr4 \
    libatk1.0-0t64 \
    libatk-bridge2.0-0t64 \
    libcups2t64 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2t64 \
    libwayland-client0 \
    # Fonts
    fonts-liberation \
    fonts-noto \
    fonts-noto-color-emoji \
    fonts-freefont-ttf \
    # Utilities
    procps \
    vim-tiny \
    && rm -rf /var/lib/apt/lists/*

# ── Stage 2: Application ────────────────────────────────────────
FROM base AS build

WORKDIR /app

# Copy package files first for layer caching
COPY package.json package-lock.json ./

# Install ALL dependencies (including playwright browsers)
RUN npm ci --omit=dev && \
    npx playwright install chromium --with-deps 2>&1 | tail -5

# Copy application source
COPY . .

# ── Stage 3: Production runtime ─────────────────────────────────
FROM base AS runtime

WORKDIR /app

# Copy only what's needed from build stage
COPY --from=build /app ./

# Runtime user (non-root)
RUN groupadd -r csi && useradd -r -g csi -d /app -s /sbin/nologin csi && \
    chown -R csi:csi /app /data /state /config /logs

USER csi

# Volumes for persistent data
VOLUME ["/app/data", "/app/state", "/app/config", "/app/logs"]

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "const c = require('http'); c.get('http://localhost:3031/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))" \
  || node -e "process.exit(process.memoryUsage().heapUsed < 500*1024*1024 ? 0 : 1)"

# Default: show help
CMD ["node", "core/run.mjs", "--help"]

# ── Labels ──────────────────────────────────────────────────────
LABEL org.opencontainers.image.title="CSI-Ultimate"
LABEL org.opencontainers.image.description="Multi-site classifieds extraction pipeline with self-healing and live observability"
LABEL org.opencontainers.image.version="9.0.0"
LABEL org.opencontainers.image.source="https://github.com/obaida/csi-ultimate"
