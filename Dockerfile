# syntax=docker/dockerfile:1

# Multi-stage: the build stages compile the frontend and backend; the runtime image
# only carries production dependencies, the built files and git (the server runs git http-backend).

FROM node:24-bookworm-slim AS base
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

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# The data directory is the only writable place; mount a volume on it to keep the blog.
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
VOLUME ["/app/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/site').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/server/main.mjs"]
