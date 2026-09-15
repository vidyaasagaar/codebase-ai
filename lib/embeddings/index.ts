import path from "node:path";
import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import { DATA_DIR } from "@/lib/db";

// Local embedding model (bge-small-en-v1.5, 384 dims) — no API key, source code never leaves the machine.

const MODEL = "Xenova/bge-small-en-v1.5";
const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

type G = typeof globalThis & { __embedder?: Promise<FeatureExtractionPipeline> };

function getEmbedder() {
  const g = globalThis as G;
  if (!g.__embedder) {
    // Loaded lazily: the native ONNX runtime is only needed for indexing and answering, so other API routes never
    // depend on it being loadable (e.g. on serverless hosts).
    g.__embedder = import("@huggingface/transformers")
      .then(({ pipeline, env }) => {
        env.cacheDir = path.join(DATA_DIR, "models");
        return pipeline("feature-extraction", MODEL, { dtype: "q8" }) as Promise<FeatureExtractionPipeline>;
      })
      .catch((err) => {
        g.__embedder = undefined; // allow retry, e.g. after a failed model download
        throw err;
      });
  }
  return g.__embedder;
}

export async function embedDocuments(texts: string[], onProgress?: (done: number) => void): Promise<number[][]> {
  const fe = await getEmbedder();
  const out: number[][] = [];
  const BATCH = 32;
  for (let i = 0; i < texts.length; i += BATCH) {
    const t = await fe(texts.slice(i, i + BATCH), { pooling: "cls", normalize: true });
    out.push(...(t.tolist() as number[][]));
    onProgress?.(Math.min(texts.length, i + BATCH));
  }
  return out;
}

export async function embedQuery(text: string): Promise<number[]> {
  const fe = await getEmbedder();
  const t = await fe([QUERY_PREFIX + text], { pooling: "cls", normalize: true });
  return (t.tolist() as number[][])[0];
}

// camelCase / snake_case / paths → words, keeping the original identifiers too.
export function identifierWords(text: string): string {
  const split = text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_\-./\\:]+/g, " ");
  return `${text} ${split}`;
}
