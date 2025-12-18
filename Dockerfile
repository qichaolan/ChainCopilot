# Stage 1: Dependencies
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --only=production

# Stage 2: Builder
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Build-time environment variables (non-sensitive)
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm run build

# Stage 3: Runner
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Install Python, pip and build dependencies for pycurl
RUN apk add --no-cache python3 py3-pip curl-dev gcc musl-dev python3-dev

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built assets
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Copy OpenBB scripts and install Python dependencies
COPY lib/openbb ./lib/openbb
RUN pip3 install --no-cache-dir --break-system-packages -r lib/openbb/requirements.txt

# Copy LEAPS CoAgent and install dependencies
COPY agents ./agents
RUN pip3 install --no-cache-dir --break-system-packages -r agents/leaps_coagent/requirements.txt

# Create .venv symlink for the Python script path
RUN mkdir -p .venv/bin && ln -s /usr/bin/python3 .venv/bin/python

# Fix OpenBB permissions - it needs to write .build.lock file
RUN chmod -R 777 /usr/lib/python3.12/site-packages/openbb || true

# Copy startup script
COPY start.sh ./start.sh
RUN chmod +x start.sh

# Set ownership
RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000
EXPOSE 8000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["./start.sh"]
