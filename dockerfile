FROM node:18-alpine AS base

FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --only=production

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN addgroup --system --gid 1001 echoverse
RUN adduser --system --uid 1001 echoverse

FROM base AS runner
WORKDIR /app

ENV NODE_ENV production
ENV PORT 3001

RUN addgroup --system --gid 1001 echoverse
RUN adduser --system --uid 1001 echoverse

COPY --from=builder --chown=echoverse:echoverse /app/server.js ./
COPY --from=builder --chown=echoverse:echoverse /app/package.json ./
COPY --from=deps --chown=echoverse:echoverse /app/node_modules ./node_modules
COPY --from=builder --chown=echoverse:echoverse /app/public ./public

RUN mkdir -p /app/data && chown echoverse:echoverse /app/data

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/api/health', (res) => { \
    if (res.statusCode === 200) { \
      process.exit(0); \
    } else { \
      process.exit(1); \
    } \
  }).on('error', () => process.exit(1))"

USER echoverse

EXPOSE 3001

ENV DATABASE_PATH=/app/data/echoverse.db

CMD ["node", "server.js"]