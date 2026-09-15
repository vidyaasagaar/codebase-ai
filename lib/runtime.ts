import { TEMP_DATA_DIR, dataDir } from "./data-dir";

// What this deployment can do. Indexing needs a long-running process, persistent writable storage and git;
// serverless platforms (Netlify, Vercel, AWS Lambda) freeze functions after each response and reset storage,
// so hosted previews serve the product without indexing instead of failing mid-request.

export interface Capabilities {
  indexing: boolean;
  reason: string | null;
}

const HOSTED_REASON =
  "Repository indexing isn't available on this hosted preview — it needs a persistent server with Git and disk access. " +
  "Run Codebase AI locally (npm run dev) or use the VS Code extension to analyze repositories.";

let cached: Capabilities | null = null;

export function capabilities(): Capabilities {
  if (cached) return cached;
  const mode = process.env.CODEBASE_AI_MODE;
  const serverless = Boolean(
    process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT || process.env.NETLIFY || process.env.VERCEL,
  );
  const ephemeralStorage = dataDir() === TEMP_DATA_DIR && !process.env.CODEBASE_AI_DATA_DIR;
  const indexing = mode === "full" ? true : mode === "hosted" ? false : !(serverless || ephemeralStorage);
  cached = { indexing, reason: indexing ? null : HOSTED_REASON };
  return cached;
}
