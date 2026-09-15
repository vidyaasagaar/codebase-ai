# Codebase AI — full server: indexing (git + Tree-sitter + local embeddings), PostgreSQL + pgvector, chat and graphs.
# Needs a long-running container with a persistent volume mounted at /app/.data.

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    ONNXRUNTIME_NODE_INSTALL_CUDA=skip
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# Bounded JS heap leaves room for the native embedding runtime and embedded PostgreSQL (WASM).
# Measured: indexing a ~900-entity repository peaks around 1.6 GB total with a 384 MB heap.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    CODEBASE_AI_MODE=full \
    NODE_OPTIONS=--max-old-space-size=512 \
    PORT=3000
COPY --from=build /app ./
RUN mkdir -p /app/.data
EXPOSE 3000
CMD ["sh", "-c", "node_modules/.bin/next start -H 0.0.0.0 -p ${PORT:-3000}"]
