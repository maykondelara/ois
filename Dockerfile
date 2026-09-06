FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
RUN apt-get update && apt-get install --no-install-recommends -y openssl && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

FROM dependencies AS build
WORKDIR /app
COPY . .
# Build-time values are generated inside this transient layer solely because
# server-only configuration is validated while Next compiles route modules.
RUN export AUTH_SECRET="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')"; \
    export APP_URL="http://127.0.0.1:3100"; \
    pnpm prisma generate && pnpm build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install --no-install-recommends -y openssl && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/tsconfig.json ./
COPY --from=build /app/next.config.ts ./
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/poc ./poc
COPY --from=build /app/src ./src
COPY --from=build /app/.next ./.next
CMD ["sh", "-c", "./node_modules/.bin/prisma generate && ./node_modules/.bin/tsx poc/migration-runner.ts"]
