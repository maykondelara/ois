FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
RUN apt-get update && apt-get install --no-install-recommends -y openssl && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install --no-install-recommends -y openssl && rm -rf /var/lib/apt/lists/*
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY tsconfig.json ./
COPY prisma ./prisma
COPY poc ./poc
COPY src ./src
CMD ["sh", "-c", "./node_modules/.bin/prisma generate && ./node_modules/.bin/tsx poc/migration-runner.ts"]
