import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native / WASM packages must be loaded from node_modules at runtime, not bundled.
  serverExternalPackages: [
    "@electric-sql/pglite",
    "web-tree-sitter",
    "tree-sitter-wasms",
    "@huggingface/transformers",
    "onnxruntime-node",
  ],
};

export default nextConfig;
