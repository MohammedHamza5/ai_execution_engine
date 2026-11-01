# ==============================================================================
# Stage 1: Build & Prune
# ==============================================================================
FROM node:22-alpine AS builder

WORKDIR /app

# Copy dependency manifests
COPY package*.json tsconfig.json ./
RUN npm ci

# Copy source files and build
COPY src/ ./src/
RUN npm run build

# Prune development dependencies
RUN npm prune --production

# ==============================================================================
# Stage 2: Production Runtime
# ==============================================================================
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Install lightweight tools for healthcheck probe
RUN apk add --no-cache wget

# Create non-root system user for container security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy compiled artifacts and production dependencies
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY src/db/migrations ./dist/db/migrations
COPY src/db/migrations ./src/db/migrations

# Set file permissions
RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

# Container healthcheck probe against liveness route
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

ENTRYPOINT ["node", "dist/index.js"]
