# syntax=docker/dockerfile:1

# Node is pinned to a patch release. 24.22.1 carries the fixes of the October 2026 Node.js security
# release (including the Brotli memory-write flaw CVE-2026-111497). Bump this with every Node security release.
ARG NODE_IMAGE=node:24.22.1-bookworm-slim

# Multi-stage: the build stages compile the frontend and backend; the runtime image
# only carries production dependencies, the built files and git (the server runs git http-backend).

FROM ${NODE_IMAGE} AS base
RUN corepack enable
WORKDIR /app

# Native modules (better-sqlite3, sharp) normally install prebuilt binaries. The
# compiler is only a fallback for platforms without one.
FROM base AS native-tools
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

FROM native-tools AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build

FROM native-tools AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

# One container, two processes: nginx (port 80, gzip, the public port) and brog (127.0.0.1:8080, as
# the node user). The nginx config is copied in, not mounted, so the image is self-contained.
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    BROG_HOST=127.0.0.1 \
    BROG_PORT=8080 \
    BROG_TRUST_PROXY=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates nginx-light tini \
 && rm -rf /var/lib/apt/lists/* \
 && rm -f /etc/nginx/sites-enabled/default
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY deploy/nginx/brog.conf /etc/nginx/conf.d/brog.conf
COPY deploy/docker-entrypoint.sh /usr/local/bin/brog-start
# The data directory is the only writable place; mount a volume on it to keep the blog.
RUN chmod +x /usr/local/bin/brog-start \
 && mkdir -p /app/data && chown -R node:node /app/data
VOLUME ["/app/data"]
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1/api/site').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/brog-start"]
