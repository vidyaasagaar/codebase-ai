// GitHub REST API: repository lookup (validation + metadata), public search, and — with a signed-in user's token —
// the repositories that user is authorized to access. GitHub stays the source of truth for access.
// Unauthenticated calls: 60 requests/hour, 10 searches/minute (GITHUB_TOKEN raises that).

const API = "https://api.github.com";
export const MAX_REPO_SIZE_KB = 250_000;
export const LARGE_REPO_KB = 50_000;

export interface GithubRepo {
  id: number;
  fullName: string;
  name: string;
  owner: string;
  ownerType: "User" | "Organization";
  private: boolean;
  url: string;
  description: string | null;
  stars: number;
  forks: number;
  language: string | null;
  sizeKb: number;
  defaultBranch: string;
  updatedAt: string;
  topics: string[];
  archived: boolean;
}

export class GithubError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const REAUTH_MESSAGE = "Your GitHub authorization expired. Reconnect GitHub to continue.";

function headers(token?: string) {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "codebase-ai",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const auth = token ?? process.env.GITHUB_TOKEN;
  if (auth) h.Authorization = `Bearer ${auth}`;
  return h;
}

const rawGh = (path: string, token?: string) => fetch(`${API}${path}`, { headers: headers(token), cache: "no-store" });

const rateLimited = (res: Response) =>
  res.status === 429 || (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0");

async function ensureOk(res: Response, token: string | undefined, notFound: string) {
  if (rateLimited(res)) {
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    const when = reset ? ` Resets at ${new Date(reset * 1000).toLocaleTimeString()}.` : "";
    throw new GithubError(`GitHub API rate limit reached. Please try again later.${when}`, 429);
  }
  if (res.status === 401) throw new GithubError(token ? REAUTH_MESSAGE : "GitHub rejected the configured GITHUB_TOKEN.", 401);
  if (res.status === 404) throw new GithubError(notFound, 404);
  if (res.status === 403) throw new GithubError("GitHub denied access to this resource.", 403);
  if (!res.ok) throw new GithubError(`GitHub API error (${res.status}).`, 502);
}

async function gh<T>(path: string, token?: string, notFound = "Repository not found on GitHub (it may be private or misspelled)."): Promise<T> {
  const res = await rawGh(path, token);
  await ensureOk(res, token, notFound);
  return res.json() as Promise<T>;
}

interface RawRepo {
  id: number; name: string; full_name: string; html_url: string; description: string | null; private: boolean;
  owner: { login: string; type: string }; stargazers_count: number; forks_count: number; language: string | null;
  size: number; default_branch: string; pushed_at: string; topics?: string[]; archived: boolean;
}

const slim = (r: RawRepo): GithubRepo => ({
  id: r.id,
  fullName: r.full_name,
  name: r.name,
  owner: r.owner.login,
  ownerType: r.owner.type === "Organization" ? "Organization" : "User",
  private: r.private,
  url: r.html_url,
  description: r.description,
  stars: r.stargazers_count,
  forks: r.forks_count,
  language: r.language,
  sizeKb: r.size,
  defaultBranch: r.default_branch,
  updatedAt: r.pushed_at,
  topics: (r.topics ?? []).slice(0, 6),
  archived: r.archived,
});

const repoPath = (fullName: string) => `/repos/${fullName.split("/").map(encodeURIComponent).join("/")}`;

// Accepts https://github.com/owner/repo, .git suffix, /tree/branch paths and git@github.com:owner/repo.git
export function parseGithubUrl(url: string): { owner: string; repo: string; branch?: string } | null {
  const m = url.trim().match(/^(?:https?:\/\/(?:www\.)?github\.com\/|git@github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([^?#]+))?\/?(?:[?#].*)?$/);
  return m ? { owner: m[1], repo: m[2], branch: m[3] } : null;
}

export async function getGithubRepo(owner: string, repo: string, token?: string) {
  const notFound = token
    ? "Repository not found, or your GitHub authorization doesn't include it."
    : "Repository not found on GitHub (it may be private or misspelled).";
  return slim(await gh<RawRepo>(repoPath(`${owner}/${repo}`), token, notFound));
}

export async function searchGithubRepos(q: string, language?: string) {
  const parts = [q.trim() || "realworld stars:>300", "fork:false", `size:<${MAX_REPO_SIZE_KB}`];
  if (language) parts.push(`language:${language}`);
  const params = new URLSearchParams({ q: parts.join(" "), sort: "stars", order: "desc", per_page: "12" });
  const data = await gh<{ total_count: number; items: RawRepo[] }>(`/search/repositories?${params}`);
  return { total: data.total_count, items: data.items.map(slim) };
}

const MAX_PAGES = 5;

// Repositories the signed-in user may access. For a GitHub App this is every repository in installations the user
// can see (personal, organization, collaborator); a classic OAuth App token falls back to /user/repos.
export async function listAccessibleRepos(token: string): Promise<{ repos: GithubRepo[]; installations: number | null }> {
  const byId = new Map<number, GithubRepo>();
  const res = await rawGh("/user/installations?per_page=100", token);
  let installations: number | null = null;

  if (res.ok) {
    const data = (await res.json()) as { installations: { id: number }[] };
    installations = data.installations.length;
    for (const inst of data.installations.slice(0, 30)) {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const { repositories } = await gh<{ repositories: RawRepo[] }>(
          `/user/installations/${inst.id}/repositories?per_page=100&page=${page}`, token);
        repositories.forEach((r) => byId.set(r.id, slim(r)));
        if (repositories.length < 100) break;
      }
    }
  } else if (res.status === 401 || rateLimited(res)) {
    await ensureOk(res, token, "");
  } else {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const repos = await gh<RawRepo[]>(`/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`, token);
      repos.forEach((r) => byId.set(r.id, slim(r)));
      if (repos.length < 100) break;
    }
  }

  const repos = [...byId.values()].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  return { repos, installations };
}

// Live access check used to enforce GitHub permissions on already-indexed private repositories.
export async function checkRepoAccess(fullName: string, token: string): Promise<"ok" | "no_access" | "bad_token" | "error"> {
  try {
    const res = await rawGh(repoPath(fullName), token);
    if (res.ok) return "ok";
    if (res.status === 401) return "bad_token";
    if (res.status === 404 || (res.status === 403 && !rateLimited(res))) return "no_access";
    return "error";
  } catch {
    return "error";
  }
}
