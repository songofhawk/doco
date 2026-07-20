# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS frontend-builder

WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@11.7.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY patches ./patches
RUN --mount=type=cache,id=doco-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY index.html tsconfig*.json vite.config.ts eslint.config.js ./
COPY public ./public
COPY src ./src

ARG VITE_API_BASE=/app-api/v1
ARG VITE_MAX_DOCUMENT_CHARACTERS=100000
ARG VITE_MAX_YDOC_SNAPSHOT_BYTES=5242880
ENV VITE_API_BASE=$VITE_API_BASE
ENV VITE_MAX_DOCUMENT_CHARACTERS=$VITE_MAX_DOCUMENT_CHARACTERS
ENV VITE_MAX_YDOC_SNAPSHOT_BYTES=$VITE_MAX_YDOC_SNAPSHOT_BYTES

RUN pnpm run build


FROM node:22-alpine3.22 AS backend-dependencies

WORKDIR /app/backend
RUN apk add --no-cache python3 make g++
COPY backend/package.json backend/package-lock.json ./
RUN --mount=type=cache,id=doco-npm,target=/root/.npm \
    npm ci --omit=dev


FROM node:22-alpine3.22 AS backend

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8000
ENV DOCO_DB_PATH=/data/doco.db
ENV DOCO_ATTACHMENTS_PATH=/data/attachments

WORKDIR /app/backend

COPY --from=backend-dependencies /app/backend/node_modules ./node_modules
COPY backend/*.js backend/schema.sql ./
COPY backend/open-api ./open-api

RUN mkdir -p /data/attachments && chown -R node:node /data

USER node
EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "server.js"]


FROM caddy:2.10-alpine AS caddy-binary

RUN setcap -r /usr/bin/caddy


FROM alpine:3.22 AS frontend

ENV XDG_CONFIG_HOME=/config
ENV XDG_DATA_HOME=/data

RUN apk add --no-cache ca-certificates

COPY --from=caddy-binary /usr/bin/caddy /usr/bin/caddy
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=frontend-builder /app/dist /srv

USER nobody:nogroup
WORKDIR /srv
EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD ["wget", "--spider", "--quiet", "http://127.0.0.1:8080/healthz"]

ENTRYPOINT ["/usr/bin/caddy"]
CMD ["run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
