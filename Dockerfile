# Multi-stage build for MJR-EHR
# Stage 1: Builder - Node.js alpine with build dependencies
# Stage 2: Runtime - Slim Node.js alpine with only production runtime

# ==========================================
# STAGE 1: BUILDER
# ==========================================

FROM node:22-alpine AS builder

# Install build dependencies
RUN apk add --no-cache \
  python3 \
  make \
  g++

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build frontend with Vite
RUN npm run build

# ==========================================
# STAGE 2: RUNTIME
# ==========================================

FROM node:22-alpine

# Set working directory
WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1000 ehr && \
    adduser -u 1000 -G ehr -s /sbin/nologin -D ehr

# Copy package files from builder
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev && \
    npm cache clean --force

# Copy built frontend from builder
COPY --from=builder /app/dist ./dist

# Copy server code
COPY server ./server

# Create data directory for SQLite with proper permissions
RUN mkdir -p /data && \
    chown -R ehr:ehr /app /data

# Switch to non-root user
USER ehr

# Expose application port
EXPOSE 3000

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})" || exit 1

# Set environment variables with defaults
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/mjr-ehr.db

# Volume for persistent SQLite database and logs
VOLUME ["/data"]

# Start application
CMD ["node", "server/server.js"]
