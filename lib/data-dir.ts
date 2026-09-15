import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Where Codebase AI keeps its database, cloned repositories, model cache and encryption key.
// CODEBASE_AI_DATA_DIR wins; otherwise ./.data, or a temp directory when the app directory is read-only
// (serverless hosting), so the API keeps responding instead of crashing.

export const TEMP_DATA_DIR = path.join(os.tmpdir(), "codebase-ai");

let resolved: string | null = null;

export function dataDir(): string {
  if (resolved) return resolved;
  if (process.env.CODEBASE_AI_DATA_DIR) {
    resolved = process.env.CODEBASE_AI_DATA_DIR;
    return resolved;
  }
  const local = path.join(process.cwd(), ".data");
  try {
    fs.mkdirSync(local, { recursive: true });
    fs.accessSync(local, fs.constants.W_OK);
    resolved = local;
  } catch {
    fs.mkdirSync(TEMP_DATA_DIR, { recursive: true });
    resolved = TEMP_DATA_DIR;
  }
  return resolved;
}
