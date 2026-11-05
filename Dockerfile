# Rezonest Work OS. See docs/DEPLOYMENT.md.
FROM node:24-alpine

# openssl: the database library. postgresql16-client: pg_dump for backups, matching Postgres 16.
RUN apk add --no-cache openssl libc6-compat postgresql16-client
RUN npm install --global pnpm@11.25.0

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

COPY . .
# Only needed so the build can finish. The real address comes from the environment when it runs.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" AUTH_SECRET="build-time-only" pnpm build

RUN mkdir -p /app/storage && chown -R node:node /app/storage /app/.next
USER node
ENV NODE_ENV=production PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD wget -q --spider http://localhost:3000/login || exit 1

# Applies any new database changes, then starts the app.
CMD ["sh", "-c", "pnpm prisma migrate deploy && pnpm start"]
