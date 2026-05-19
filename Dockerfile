# syntax=docker/dockerfile:1.6
#
# Multi-stage Dockerfile for the Musk-IT HVAC platform.
# - Stage "deps":   installs only production node_modules
# - Stage "py":     installs the Python engine deps (bin energy calc)
# - Stage "runtime": small image with node 20 + python 3.11 runtime
#
# Build:   docker build -t hvac-muskit .
# Run:     docker run -p 3000:3000 --env-file .env hvac-muskit
#

# ---------- stage 1: node deps ------------------------------------
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# ---------- stage 2: runtime --------------------------------------
FROM node:20-bookworm-slim AS runtime

# Install Python 3 for the bin-energy engine, plus tini for clean signal handling
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 python3-pip tini ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# Non-root app user
RUN useradd --system --create-home --shell /usr/sbin/nologin app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

WORKDIR /app

# Copy production dependencies and project files
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=app:app . ./

# Ensure server-data dir is writable for runtime project storage
RUN mkdir -p /app/server-data && chown -R app:app /app

USER app
EXPOSE 3000

# Healthcheck — server.js responds on / with 200 when the static page is served.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT}/ > /dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
