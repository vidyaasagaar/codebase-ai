import * as vscode from "vscode";

// Client for the Codebase AI server. The session token lives in VS Code SecretStorage and is only ever sent to the
// configured server URL — never to URLs that arrive through deep links. The extension never sees GitHub tokens.

export interface Project {
  id: string;
  name: string;
  url: string;
  status: "queued" | "indexing" | "ready" | "error";
  provider?: "local" | "git" | "github" | null;
  private?: boolean;
  indexed_at?: string | null;
  error?: string | null;
  metadata?: { fullName?: string; defaultBranch?: string; url?: string };
  stats?: { entities?: number; files?: number };
}

export interface SessionUser {
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

const TOKEN_KEY = "codebaseAI.sessionToken";

export class CodebaseApi {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  get serverUrl() {
    return vscode.workspace.getConfiguration("codebaseAI").get<string>("serverUrl", "http://localhost:3000").replace(/\/+$/, "");
  }

  getToken() {
    return this.secrets.get(TOKEN_KEY);
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    const token = await this.getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    try {
      return await fetch(`${this.serverUrl}${path}`, { ...init, headers });
    } catch {
      throw new ApiError(`Cannot reach Codebase AI at ${this.serverUrl}. Is the server running?`, 0, "offline");
    }
  }

  async json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.request(path, init);
    const data = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
    if (!res.ok) throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status, data?.code);
    return data as T;
  }

  session() {
    return this.json<{ user: SessionUser | null; githubConfigured: boolean }>("/api/auth/session");
  }

  projects() {
    return this.json<Project[]>("/api/repositories");
  }

  project(id: string) {
    return this.json<Project>(`/api/repositories/${encodeURIComponent(id)}`);
  }

  analyzeLocal(folderPath: string) {
    return this.json<{ id: string }>("/api/repositories", { method: "POST", body: JSON.stringify({ url: folderPath }) });
  }

  analyzeGitHub(fullName: string) {
    return this.json<{ id: string }>("/api/repositories", { method: "POST", body: JSON.stringify({ github: fullName }) });
  }

  reindex(id: string) {
    return this.json<{ reindexing: boolean }>(`/api/repositories/${encodeURIComponent(id)}/index`, { method: "POST" });
  }

  async exchangeCode(code: string, state: string) {
    const result = await this.json<{ token: string; user: SessionUser }>("/api/extension/token", {
      method: "POST",
      body: JSON.stringify({ code, state }),
    });
    await this.secrets.store(TOKEN_KEY, result.token);
    return result.user;
  }

  async signOut() {
    await this.request("/api/auth/logout", { method: "POST", body: "{}" }).catch(() => undefined);
    await this.secrets.delete(TOKEN_KEY);
  }
}
