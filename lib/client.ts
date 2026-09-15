// Shared client-side types and helpers.
import type { GithubRepo } from "@/lib/repository/github";

export type { GithubRepo };

export interface ProgressStep {
  label: string;
  status: "running" | "done" | "error";
}

export interface ModuleStat {
  module: string;
  files: number;
  lines: number;
  entities: number;
  connections: number;
}

export interface RepoStats {
  files: number;
  indexedFiles: number;
  sourceFiles: number;
  lines: number;
  functions: number;
  components: number;
  classes: number;
  interfaces: number;
  models: number;
  routes: number;
  modules: number;
  entities: number;
  relationships: number;
  languages: { name: string; lines: number; percent: number }[];
  frameworks: string[];
  entryPoints: string[];
  largestModules: ModuleStat[];
  mostConnectedModules: ModuleStat[];
  complexFiles: { path: string; lines: number; entities: number }[];
}

export interface Repo {
  id: string;
  name: string;
  url: string;
  branch: string | null;
  commit_sha: string | null;
  status: "queued" | "indexing" | "ready" | "error";
  progress: ProgressStep[];
  stats: RepoStats;
  error: string | null;
  created_at: string;
  metadata?: Partial<GithubRepo>;
  provider?: "local" | "git" | "github" | null;
  private?: boolean;
  indexed_at?: string | null;
  suggestions?: string[];
}

export interface SessionInfo {
  user: { login: string; name: string | null; avatarUrl: string | null } | null;
  githubConfigured: boolean;
  installUrl: string | null;
}

export interface AccessibleRepo extends GithubRepo {
  project: { id: string; status: Repo["status"]; indexedAt: string | null } | null;
}

export const EXTENSION_ID = "codebase-ai.codebase-ai";

export const vscodeProjectUrl = (repoId: string) => `vscode://${EXTENSION_ID}/project?id=${encodeURIComponent(repoId)}`;

export const githubLoginUrl = (returnTo: string) => `/api/auth/github/login?returnTo=${encodeURIComponent(returnTo)}`;

export function timeAgo(date: string | null | undefined) {
  if (!date) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export const formatCount = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

export interface EntityLite {
  id: number;
  symbol_name: string;
  symbol_type: string;
  file_path: string;
  start_line: number;
  end_line: number;
  parent?: string | null;
  route?: string | null;
  module?: string;
  relationship_type?: string;
  refs?: number;
}

export interface Source {
  n: number;
  id: number;
  file: string;
  symbol: string;
  type: string;
  startLine: number;
  endLine: number;
  route: string | null;
  reason: string;
}

export interface CodeTarget {
  path: string;
  start?: number;
  end?: number;
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status, data?.code);
  return data as T;
}

export function codeUrl(repoId: string, t: CodeTarget) {
  const q = new URLSearchParams({ path: t.path });
  if (t.start) q.set("start", String(t.start));
  if (t.end) q.set("end", String(t.end));
  return `/repo/${repoId}/files?${q}`;
}

export const lineRange = (s?: number, e?: number) => (s ? (e && e !== s ? `${s}–${e}` : `${s}`) : "");
