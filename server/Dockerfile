# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma.config.ts tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
RUN npm run db:generate && npm run build

# Cible volontairement séparée : à exécuter une fois avant le déploiement du runtime.
FROM build AS migrate
CMD ["npm", "run", "db:migrate:deploy"]

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY certs ./certs

USER node
EXPOSE 3001
CMD ["node", "dist/src/index.js"]
