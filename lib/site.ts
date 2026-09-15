// Public site identity used for page metadata, structured data, robots and sitemap.

export const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://codebaseee.netlify.app").replace(/\/+$/, "");

export const SITE_NAME = "Codebase AI";

export const SITE_TAGLINE = "AI code intelligence for any Git repository";

export const SITE_DESCRIPTION =
  "Codebase AI indexes any Git repository — public, private GitHub, or a local folder — into functions, classes, API routes and a dependency graph, then answers architecture, flow, dependency and change-impact questions with exact file and line citations. Local parsing, local embeddings and pgvector search, with a web dashboard and a VS Code extension.";

export const SITE_KEYWORDS = [
  "codebase AI", "code intelligence", "RAG for code", "codebase question answering", "AI code search",
  "semantic code search", "developer onboarding", "architecture visualization", "dependency graph",
  "change impact analysis", "Tree-sitter", "pgvector", "GitHub private repositories", "VS Code extension",
  "code citations", "API route detection",
];
