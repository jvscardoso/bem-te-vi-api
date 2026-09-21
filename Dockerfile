# syntax=docker/dockerfile:1

# ---- build: instala tudo, gera o Prisma Client e compila ----
FROM node:24-bookworm-slim AS build
WORKDIR /app

# openssl: exigido pelo schema engine do Prisma (migrate deploy)
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json tsconfig.build.json nest-cli.json ./
# O generate só lê o schema; a DATABASE_URL não é usada, mas o prisma.config.ts exige que exista.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate

COPY src ./src
RUN npm run build

# ---- runtime ----
# Mantém node_modules completo (com a CLI do Prisma e tsx) porque a subida roda
# `prisma migrate deploy` e o seed do catálogo de permissões.
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/prisma.config.ts /app/package.json ./

USER node
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Com várias réplicas, mova migrate/seed para uma etapa única de release (não em cada container).
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed && exec node dist/main"]
