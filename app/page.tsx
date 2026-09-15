"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, GitBranch, Loader2, Trash2, Boxes, Search, Star, Lock, Globe, Building2, User, Info } from "lucide-react";
import { api, formatCount, timeAgo, type Repo, type GithubRepo, type AccessibleRepo, type Capabilities } from "@/lib/client";
import { GithubAccount, useSession } from "@/components/auth/github-account";
import { LARGE_REPO_KB } from "@/lib/repository/github";

const GITHUB_MESSAGES: Record<string, { text: string; tone: "error" | "info" }> = {
  denied: { text: "GitHub access was not granted. Please authorize Codebase AI to continue.", tone: "error" },
  state: { text: "GitHub sign-in expired or was started in another tab. Please try again.", tone: "error" },
  failed: { text: "GitHub sign-in failed. Please try again.", tone: "error" },
  not_configured: { text: "GitHub sign-in isn't configured on this server (set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET).", tone: "error" },
  installed: { text: "Codebase AI was installed on GitHub. Continue with GitHub to choose repositories.", tone: "info" },
};

const LANGUAGES = ["", "TypeScript", "JavaScript", "Python", "Java", "Go"];

export default function Home() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [notice, setNotice] = useState<(typeof GITHUB_MESSAGES)[string] | null>(null);
  const { session, reload: reloadSession } = useSession();
  const [caps, setCaps] = useState<Capabilities | null>(null);

  const load = () => api<Repo[]>("/api/repositories").then(setRepos).catch(() => {});
  useEffect(() => { load(); }, []);
  useEffect(() => { api<Capabilities>("/api/capabilities").then(setCaps).catch(() => {}); }, []);

  // Result of a GitHub sign-in round trip (?github_error=… / ?github_installed=1), shown once.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const key = sp.get("github_error") ?? (sp.get("github_installed") ? "installed" : null);
    if (!key) return;
    setNotice(GITHUB_MESSAGES[key] ?? GITHUB_MESSAGES.failed);
    window.history.replaceState(null, "", "/");
  }, []);

  async function analyze(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { id } = await api<{ id: string }>("/api/repositories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), branch: branch.trim() || undefined }),
      });
      router.push(`/repo/${id}`);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this repository and all of its indexed data?")) return;
    await api(`/api/repositories/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:py-20">
      <div className="flex items-center gap-2 text-sm font-semibold tracking-wide">
        <Boxes className="size-5 text-accent" /> CODEBASE AI
        <div className="ml-auto font-normal tracking-normal">
          <GithubAccount session={session} onChange={() => { reloadSession(); load(); }} />
        </div>
      </div>
      {notice && (
        <p className={`mt-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${notice.tone === "error" ? "border-danger/30 bg-danger/5 text-danger" : "border-accent/30 bg-accent-soft text-accent"}`}>
          <Info className="mt-0.5 size-4 shrink-0" /> {notice.text}
        </p>
      )}
      <h1 className="mt-6 text-3xl font-semibold tracking-tight sm:text-4xl">Understand any repository in minutes.</h1>
      <p className="mt-3 text-muted">
        Paste a Git repository or pick one from GitHub. Codebase AI parses it into functions, classes, routes and dependencies,
        then answers your questions with exact source references.
      </p>

      {caps?.indexing === false && (
        <p className="mt-6 flex items-start gap-2 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-accent">
          <Info className="mt-0.5 size-4 shrink-0" />
          <span>
            {caps.reason}{" "}
            <a href="https://github.com/vidyaasagaar/codebase-ai#readme" target="_blank" rel="noreferrer" className="underline">Setup guide</a>
          </span>
        </p>
      )}

      <form onSubmit={analyze} className="mt-8 rounded-xl border border-border bg-panel p-3 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
            className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 py-2.5 font-mono text-sm outline-none focus:border-accent"
            autoFocus
          />
          <input
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="branch (optional)"
            className="rounded-lg border border-border bg-bg px-3 py-2.5 font-mono text-sm outline-none focus:border-accent sm:w-40"
          />
          <button
            disabled={!url.trim() || submitting || caps?.indexing === false}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />} Analyze
          </button>
        </div>
        {error && <p className="mt-2 px-1 text-sm text-danger">{error}</p>}
      </form>

      {session?.user && <YourRepositories indexing={caps?.indexing !== false} />}

      <GithubPicker selected={url} onSelect={(r) => { setUrl(r.url); setBranch(""); setError(null); }} />

      {repos.length > 0 && (
        <section className="mt-12">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Indexed repositories</h2>
          <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-panel">
            {repos.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                {r.private ? <Lock className="size-4 shrink-0 text-muted" aria-label="Private" /> : <GitBranch className="size-4 shrink-0 text-muted" />}
                <Link href={`/repo/${r.id}`} className="min-w-0 flex-1">
                  <div className="truncate font-medium">{r.name}</div>
                  <div className="truncate font-mono text-xs text-muted">
                    {r.branch ?? "default"}{r.commit_sha ? ` @ ${r.commit_sha.slice(0, 7)}` : ""}
                    {r.status === "ready" && r.stats?.entities ? ` · ${r.stats.entities} entities` : ""}
                  </div>
                </Link>
                <StatusBadge status={r.status} />
                <button onClick={() => remove(r.id)} className="text-muted hover:text-danger" aria-label="Delete repository">
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-10 text-xs leading-relaxed text-muted">
        Data handling: repositories are cloned and indexed on this machine (<code className="font-mono">.data/</code>) and persist until
        you delete them, which removes the clone, embeddings and graph. Embeddings are computed locally; only the retrieved snippets for a
        question are sent to the configured LLM.
      </p>

      <footer className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-4 text-xs text-muted">
        <span>Codebase AI</span>
        <a href="https://github.com/vidyaasagaar/codebase-ai" target="_blank" rel="noreferrer" className="hover:text-fg">GitHub</a>
        <a href="https://github.com/vidyaasagaar/codebase-ai/blob/main/docs/PROJECT_ANALYSIS.md" target="_blank" rel="noreferrer" className="hover:text-fg">Project analysis</a>
        <a href="/llms.txt" className="hover:text-fg">llms.txt</a>
      </footer>
    </main>
  );
}

// Repositories the signed-in GitHub account is authorized to access (GitHub decides; nothing is inferred here).
function YourRepositories({ indexing }: { indexing: boolean }) {
  const router = useRouter();
  const [data, setData] = useState<{ repos: AccessibleRepo[]; installations: number | null; installUrl: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api<{ repos: AccessibleRepo[]; installations: number | null; installUrl: string | null }>("/api/github/repositories")
      .then(setData)
      .catch((err) => setError((err as Error).message));
  }, []);

  async function analyze(r: AccessibleRepo) {
    setBusy(r.fullName);
    setError(null);
    try {
      const { id } = await api<{ id: string }>("/api/repositories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ github: r.fullName }),
      });
      router.push(`/repo/${id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  }

  const shown = (data?.repos ?? []).filter((r) => r.fullName.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-xs font-semibold uppercase tracking-wider text-muted">
          Your repositories{data ? ` · ${data.repos.length}` : ""}
        </h2>
        {data?.installUrl && (
          <a href={data.installUrl} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">Manage access on GitHub</a>
        )}
        <div className="flex items-center gap-2 rounded-lg border border-border bg-panel px-2 py-1.5 focus-within:border-accent">
          <Search className="size-3.5 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search repositories…" className="w-44 bg-transparent text-sm outline-none" />
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      {!data && !error && <Loader2 className="mt-3 size-4 animate-spin text-muted" />}
      {data && data.repos.length === 0 && (
        <div className="mt-3 rounded-xl border border-dashed border-border p-4 text-sm text-muted">
          {data.installations === 0
            ? "Codebase AI isn't installed on your GitHub account or any organization yet."
            : "This GitHub authorization doesn't include any repositories."}
          {data.installUrl && (
            <a href={data.installUrl} target="_blank" rel="noreferrer" className="ml-1 text-accent hover:underline">Choose repositories on GitHub</a>
          )}
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {shown.slice(0, 60).map((r) => (
          <div key={r.id} className="min-w-0 rounded-xl border border-border bg-panel p-3">
            <div className="truncate font-mono text-sm font-medium" title={r.fullName}>{r.fullName}</div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[11px] text-muted">
              <span className="inline-flex items-center gap-1">
                {r.private ? <><Lock className="size-3" /> Private</> : <><Globe className="size-3" /> Public</>}
              </span>
              <span className="inline-flex items-center gap-1">
                {r.ownerType === "Organization" ? <><Building2 className="size-3" /> Organization</> : <><User className="size-3" /> Personal</>}
              </span>
              {r.language && <span>{r.language}</span>}
              <span className="inline-flex items-center gap-1"><GitBranch className="size-3" />{r.defaultBranch}</span>
            </div>
            {r.sizeKb > LARGE_REPO_KB && <p className="mt-1.5 text-[11px] text-warn">Large repository — indexing may take longer than usual.</p>}
            <div className="mt-3 flex items-center gap-2">
              <button onClick={() => analyze(r)} disabled={busy !== null || !indexing}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">
                {busy === r.fullName && <Loader2 className="size-3 animate-spin" />} {r.project ? "Analyze again" : "Analyze"}
              </button>
              {r.project && (
                <Link href={`/repo/${r.project.id}`} className="rounded-md border border-border px-2.5 py-1 text-xs hover:border-accent">
                  Open · {r.project.status === "ready" ? `indexed ${timeAgo(r.project.indexedAt)}` : r.project.status}
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// Live repository search backed by the GitHub REST API (via /api/github/search).
function GithubPicker({ selected, onSelect }: { selected: string; onSelect: (r: GithubRepo) => void }) {
  const [q, setQ] = useState("");
  const [language, setLanguage] = useState("");
  const [results, setResults] = useState<GithubRepo[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ q, language });
        const data = await api<{ total: number; items: GithubRepo[] }>(`/api/github/search?${params}`);
        setResults(data.items);
        setTotal(data.total);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }, q ? 600 : 0);
    return () => clearTimeout(t);
  }, [q, language]);

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-xs font-semibold uppercase tracking-wider text-muted">
          {q ? `GitHub results · ${formatCount(total)}` : "Find a repository on GitHub · popular RealWorld apps"}
        </h2>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-panel px-2 py-1.5 focus-within:border-accent">
          {loading ? <Loader2 className="size-3.5 animate-spin text-muted" /> : <Search className="size-3.5 text-muted" />}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search GitHub, e.g. fastapi jwt" className="w-48 bg-transparent text-sm outline-none" />
        </div>
        <select value={language} onChange={(e) => setLanguage(e.target.value)} className="rounded-lg border border-border bg-panel px-2 py-1.5 text-sm outline-none">
          {LANGUAGES.map((l) => <option key={l} value={l}>{l || "Any language"}</option>)}
        </select>
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      {results && results.length === 0 && !loading && <p className="mt-3 text-sm text-muted">No repositories found.</p>}

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {results?.map((r) => (
          <button
            key={r.fullName}
            type="button"
            onClick={() => onSelect(r)}
            className={`min-w-0 rounded-xl border bg-panel p-3 text-left transition-colors hover:border-accent ${selected === r.url ? "border-accent ring-2 ring-accent/20" : "border-border"}`}
          >
            <div className="truncate font-mono text-sm font-medium">{r.fullName}</div>
            <p className="mt-1 line-clamp-2 min-h-10 text-xs text-muted">{r.description ?? "No description"}</p>
            <div className="mt-2 flex items-center gap-3 font-mono text-[11px] text-muted">
              <span className="inline-flex items-center gap-1"><Star className="size-3" />{formatCount(r.stars)}</span>
              {r.language && <span>{r.language}</span>}
              <span>{r.sizeKb >= 1024 ? `${Math.round(r.sizeKb / 1024)} MB` : `${r.sizeKb} KB`}</span>
              {r.archived && <span className="text-warn">archived</span>}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function StatusBadge({ status }: { status: Repo["status"] }) {
  const style =
    status === "ready" ? "text-ok border-ok/30" : status === "error" ? "text-danger border-danger/30" : "text-warn border-warn/30";
  return <span className={`rounded-full border px-2 py-0.5 text-xs ${style}`}>{status}</span>;
}
