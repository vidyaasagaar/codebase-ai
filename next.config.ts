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
  // Well-known aliases for the public product summaries served from /public.
  async rewrites() {
    return [
      { source: "/.well-known/llms.txt", destination: "/llms.txt" },
      { source: "/.well-known/llms-full.txt", destination: "/llms-full.txt" },
    ];
  },
};

export default nextConfig;
