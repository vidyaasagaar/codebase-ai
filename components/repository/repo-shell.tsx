"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Boxes, LayoutDashboard, MessageSquare, Network, FolderTree, Route, Zap, CheckCircle2, Loader2, XCircle, ArrowLeft, Lock,
} from "lucide-react";
import { api, type ApiError, type Repo, type Source, type EntityLite } from "@/lib/client";
import { ContinueWithGithub } from "@/components/auth/github-account";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  focus?: EntityLite | null;
  queryType?: string;
  evidence?: "strong" | "moderate" | "weak";
  sources?: Source[];
  verification?: { unverifiedPaths: string[]; invalidCitations: string[] };
  error?: string;
  pending?: boolean;
}

interface RepoContextValue {
  repo: Repo;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  focus: EntityLite | null;
  setFocus: (e: EntityLite | null) => void;
  reload: () => void;
}

const RepoContext = createContext<RepoContextValue | null>(null);

export function useRepo() {
  const ctx = useContext(RepoContext);
  if (!ctx) throw new Error("useRepo must be used inside RepoShell");
  return ctx;
}

const NAV = [
  { href: "", label: "Overview", icon: LayoutDashboard, section: "Explore" },
  { href: "/chat", label: "Ask AI", icon: MessageSquare, section: "Explore" },
  { href: "/architecture", label: "Architecture", icon: Network, section: "Explore" },
  { href: "/files", label: "Files", icon: FolderTree, section: "Explore" },
  { href: "/routes", label: "API Routes", icon: Route, section: "Explore" },
  { href: "/impact", label: "Dependencies & Impact", icon: Zap, section: "Analysis" },
];

export function RepoShell({ id, children }: { id: string; children: React.ReactNode }) {
  const [repo, setRepo] = useState<Repo | null>(null);
  const [failure, setFailure] = useState<{ message: string; code?: string } | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [focus, setFocus] = useState<EntityLite | null>(null);
  const pathname = usePathname();

  const load = useCallback(async () => {
    try {
      setRepo(await api<Repo>(`/api/repositories/${id}`));
      setFailure(null);
    } catch (err) {
      const e = err as ApiError;
      setFailure({ message: e.status === 404 ? "Repository not found." : e.message, code: e.code });
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!repo || repo.status === "ready" || repo.status === "error") return;
    const t = setTimeout(load, 800);
    return () => clearTimeout(t);
  }, [repo, load]);

  if (failure) {
    const github = failure.code === "auth_required" || failure.code === "reauth_required" || failure.code === "access_revoked";
    return (
      <div className="m-auto max-w-md p-8 text-center">
        {github && <Lock className="mx-auto size-6 text-muted" />}
        <p className={`text-sm ${github ? "mt-3" : "text-muted"}`}>{failure.message}</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {github && <ContinueWithGithub returnTo={pathname} />}
          <Link href="/" className="rounded-lg border border-border px-3 py-1.5 text-sm text-accent">Back to repositories</Link>
        </div>
      </div>
    );
  }
  if (!repo) return <div className="m-auto p-8"><Loader2 className="size-5 animate-spin text-muted" /></div>;

  const base = `/repo/${id}`;
  const ready = repo.status === "ready";

  return (
    <RepoContext.Provider value={{ repo, messages, setMessages, focus, setFocus, reload: load }}>
      <div className="flex h-screen min-h-0 w-full flex-col md:flex-row">
        <aside className="flex shrink-0 flex-col border-b border-border bg-panel md:w-60 md:border-r md:border-b-0">
          <div className="flex items-center justify-between px-4 py-3 md:py-4">
            <Link href="/" className="flex items-center gap-2 text-xs font-semibold tracking-wider">
              <Boxes className="size-4 text-accent" /> CODEBASE AI
            </Link>
            <Link href="/" className="text-muted hover:text-fg md:hidden" aria-label="All repositories"><ArrowLeft className="size-4" /></Link>
          </div>
          <div className="px-4 pb-3">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted">Repository</div>
            <div className="mt-1 truncate text-sm font-medium" title={repo.url}>{repo.name}</div>
            <div className="truncate font-mono text-[11px] text-muted">
              {repo.branch ?? "…"}{repo.commit_sha ? ` @ ${repo.commit_sha.slice(0, 7)}` : ""}
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-2 pb-2 [scrollbar-width:none] md:flex-col md:overflow-visible">
            {NAV.map((item, i) => {
              const href = base + item.href;
              const active = item.href ? pathname.startsWith(href) : pathname === base;
              const Icon = item.icon;
              return (
                <div key={item.href} className="contents">
                  {(i === 0 || NAV[i - 1].section !== item.section) && (
                    <div className="hidden px-2 pt-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted md:block">{item.section}</div>
                  )}
                  <Link
                    href={ready ? href : "#"}
                    aria-disabled={!ready}
                    className={`flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                      active ? "bg-accent-soft text-accent" : "text-muted hover:bg-panel-2 hover:text-fg"
                    } ${ready ? "" : "pointer-events-none opacity-50"}`}
                  >
                    <Icon className="size-4" /> {item.label}
                  </Link>
                </div>
              );
            })}
          </nav>
          <div className="mt-auto hidden px-4 py-4 text-[11px] leading-relaxed text-muted md:block">
            Index stored locally in PostgreSQL + pgvector (PGlite). Delete the repository from the overview to remove all data.
          </div>
        </aside>
        <main className="min-h-0 min-w-0 flex-1 overflow-auto">
          {ready ? children : <IngestionProgress repo={repo} />}
        </main>
      </div>
    </RepoContext.Provider>
  );
}

function IngestionProgress({ repo }: { repo: Repo }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-xl font-semibold">{repo.status === "error" ? "Indexing failed" : "Analyzing repository…"}</h1>
      <p className="mt-1 truncate font-mono text-xs text-muted">{repo.url}</p>
      <ul className="mt-6 space-y-2.5 rounded-xl border border-border bg-panel p-5 font-mono text-sm">
        {repo.progress.length === 0 && (
          <li className="flex items-center gap-2 text-muted"><Loader2 className="size-4 animate-spin" /> Queued</li>
        )}
        {repo.progress.map((s, i) => (
          <li key={i} className="flex items-start gap-2">
            {s.status === "done" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" />
              : s.status === "error" ? <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />
              : <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-accent" />}
            <span className={s.status === "error" ? "break-all text-danger" : ""}>{s.label}</span>
          </li>
        ))}
      </ul>
      {repo.status === "error" && <Link href="/" className="mt-4 inline-block text-sm text-accent">Back to repositories</Link>}
    </div>
  );
}
