import path from "node:path";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";

// PGlite = PostgreSQL compiled to WASM, with the pgvector extension.
// Data persists in .data/pg. Swap for a pg Pool against a real Postgres by
// reimplementing `query` — the rest of the app only uses this function.

export const DATA_DIR = process.env.CODEBASE_AI_DATA_DIR ?? path.join(process.cwd(), ".data");
export const EMBEDDING_DIM = 384;

const SCHEMA = `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS repositories (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  url         TEXT NOT NULL,
  branch      TEXT,
  commit_sha  TEXT,
  status      TEXT NOT NULL DEFAULT 'queued',
  progress    JSONB NOT NULL DEFAULT '[]',
  stats       JSONB NOT NULL DEFAULT '{}',
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';
-- Repository source (additive): 'local' | 'git' | 'github'. Private repositories are readable only by
-- GitHub connections that GitHub itself authorizes (see lib/auth/access.ts).
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS provider_repository_id TEXT;
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS private BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS owner_connection_id TEXT;
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS indexed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS files (
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  path          TEXT NOT NULL,
  language      TEXT NOT NULL,
  module        TEXT NOT NULL,
  size          INT NOT NULL,
  line_count    INT NOT NULL,
  PRIMARY KEY (repository_id, path)
);

CREATE TABLE IF NOT EXISTS code_entities (
  id            SERIAL PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  file_path     TEXT NOT NULL,
  symbol_name   TEXT NOT NULL,
  symbol_type   TEXT NOT NULL,
  language      TEXT NOT NULL,
  start_line    INT NOT NULL,
  end_line      INT NOT NULL,
  content       TEXT NOT NULL,
  module        TEXT NOT NULL,
  parent        TEXT,
  exported      BOOLEAN NOT NULL DEFAULT false,
  route         TEXT,
  imports       JSONB NOT NULL DEFAULT '[]',
  search        TSVECTOR,
  embedding     VECTOR(${EMBEDDING_DIM})
);
CREATE INDEX IF NOT EXISTS code_entities_repo_idx ON code_entities(repository_id);
CREATE INDEX IF NOT EXISTS code_entities_symbol_idx ON code_entities(repository_id, lower(symbol_name));
CREATE INDEX IF NOT EXISTS code_entities_search_idx ON code_entities USING GIN(search);

CREATE TABLE IF NOT EXISTS relationships (
  repository_id     TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  source_entity_id  INT NOT NULL REFERENCES code_entities(id) ON DELETE CASCADE,
  target_entity_id  INT NOT NULL REFERENCES code_entities(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL,
  PRIMARY KEY (source_entity_id, target_entity_id, relationship_type)
);
CREATE INDEX IF NOT EXISTS relationships_target_idx ON relationships(target_entity_id);

CREATE TABLE IF NOT EXISTS file_imports (
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  source_file   TEXT NOT NULL,
  target_file   TEXT NOT NULL,
  PRIMARY KEY (repository_id, source_file, target_file)
);

-- GitHub integration. Access/refresh tokens are stored AES-256-GCM encrypted; session tokens only as SHA-256 hashes.
CREATE TABLE IF NOT EXISTS github_connections (
  id                 TEXT PRIMARY KEY,
  github_user_id     BIGINT NOT NULL UNIQUE,
  login              TEXT NOT NULL,
  name               TEXT,
  avatar_url         TEXT,
  access_token_enc   TEXT NOT NULL,
  refresh_token_enc  TEXT,
  token_expires_at   TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash     TEXT PRIMARY KEY,
  connection_id  TEXT NOT NULL REFERENCES github_connections(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS extension_auth_codes (
  code_hash      TEXT PRIMARY KEY,
  connection_id  TEXT NOT NULL REFERENCES github_connections(id) ON DELETE CASCADE,
  state          TEXT NOT NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  used_at        TIMESTAMPTZ
);
`;

type G = typeof globalThis & { __pglite?: Promise<PGlite> };

function getDb(): Promise<PGlite> {
  const g = globalThis as G;
  if (!g.__pglite) {
    g.__pglite = (async () => {
      const dir = path.join(DATA_DIR, "pg");
      fs.mkdirSync(dir, { recursive: true });
      const db = await PGlite.create(dir, { extensions: { vector } });
      await db.exec(SCHEMA);
      return db;
    })().catch((err) => {
      g.__pglite = undefined;
      throw err;
    });
  }
  return g.__pglite;
}

export async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const db = await getDb();
  const res = await db.query<T>(sql, params);
  return res.rows;
}

export async function exec(sql: string): Promise<void> {
  const db = await getDb();
  await db.exec(sql);
}

export async function transaction<T>(fn: (q: typeof query) => Promise<T>): Promise<T> {
  const db = await getDb();
  return db.transaction(async (tx) =>
    fn(async <R,>(sql: string, params: unknown[] = []) => (await tx.query<R>(sql, params)).rows),
  );
}

export const toVector = (v: number[] | Float32Array) => `[${Array.from(v).join(",")}]`;
