"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Code2, GitBranch, Globe, HardDrive, Lock, MessageSquare, RefreshCw, Trash2 } from "lucide-react";
import { useRepo } from "@/components/repository/repo-shell";
import { api, codeUrl, formatCount, timeAgo, vscodeProjectUrl, type ModuleStat } from "@/lib/client";

const LANG_COLORS = ["bg-accent", "bg-ok", "bg-warn", "bg-danger", "bg-muted", "bg-fg/40", "bg-accent/50", "bg-ok/50"];

export default function OverviewPage() {
  const { repo, reload } = useRepo();
  const router = useRouter();
  const [reindexing, setReindexing] = useState(false);
  const isLocal = repo.provider === "local" || (!repo.provider && !/^(https?:|git@)/.test(repo.url));

  const reindex = async () => {
    setReindexing(true);
    try {
      await api(`/api/repositories/${repo.id}/index`, { method: "POST" });
      reload();
    } catch (err) {
      alert((err as Error).message);
      setReindexing(false);
    }
  };
  const s = repo.stats;
  const base = `/repo/${repo.id}`;

  const remove = async () => {
    if (!confirm("Delete this repository? The clone, embeddings and dependency graph will be removed.")) return;
    await api(`/api/repositories/${repo.id}`, { method: "DELETE" });
    router.push("/");
  };

  const tiles = [
    ["Files", s.files], ["Source files", s.sourceFiles], ["Functions", s.functions + s.components], ["Classes", s.classes],
    ["Interfaces & types", s.interfaces], ["API routes", s.routes], ["Modules", s.modules], ["Dependencies", s.relationships],
  ] as const;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 basis-72">
          <h1 className="text-xl font-semibold [overflow-wrap:anywhere]">{repo.name}</h1>
          <a href={repo.url.startsWith("http") ? repo.url : undefined} target="_blank" rel="noreferrer" className="block truncate font-mono text-xs text-muted hover:text-fg">
            {repo.url} · {repo.branch}{repo.commit_sha ? ` @ ${repo.commit_sha.slice(0, 7)}` : ""}
          </a>
          {repo.metadata?.description && <p className="mt-1 text-sm text-muted">{repo.metadata.description}</p>}
          {repo.metadata?.stars !== undefined && (
            <p className="mt-1 font-mono text-xs text-muted">
              ★ {formatCount(repo.metadata.stars)} · {formatCount(repo.metadata.forks ?? 0)} forks
              {repo.metadata.topics?.length ? ` · ${repo.metadata.topics.join(", ")}` : ""}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted">
            {isLocal ? (
              <span className="inline-flex items-center gap-1"><HardDrive className="size-3" /> Local workspace</span>
            ) : (
              <span className="inline-flex items-center gap-1">
                {repo.private ? <><Lock className="size-3" /> Private</> : <><Globe className="size-3" /> Public</>}
                {repo.provider === "github" ? " · GitHub" : " · Git"}
              </span>
            )}
            {repo.metadata?.language && <span>{repo.metadata.language}</span>}
            {repo.metadata?.defaultBranch && (
              <span className="inline-flex items-center gap-1"><GitBranch className="size-3" /> default: {repo.metadata.defaultBranch}</span>
            )}
            <span className="text-ok">● Ready</span>
            <span>Last indexed {timeAgo(repo.indexed_at ?? repo.created_at)}</span>
          </div>
        </div>
        <Link href={`${base}/chat`} className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white">
          <MessageSquare className="size-4" /> Ask about this codebase
        </Link>
        <a href={vscodeProjectUrl(repo.id)} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:border-accent">
          <Code2 className="size-4" /> Open in VS Code
        </a>
        <button onClick={reindex} disabled={reindexing} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:border-accent disabled:opacity-50">
          <RefreshCw className={`size-4 ${reindexing ? "animate-spin" : ""}`} /> Re-index
        </button>
        <button onClick={remove} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted hover:text-danger">
          <Trash2 className="size-4" /> Delete
        </button>
      </header>

      <section className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
        {tiles.map(([label, value]) => (
          <div key={label} className="bg-panel px-4 py-3">
            <div className="text-xs text-muted">{label}</div>
            <div className="mt-1 font-mono text-xl font-semibold tabular-nums">{Number(value ?? 0).toLocaleString()}</div>
          </div>
        ))}
      </section>

      {repo.suggestions && repo.suggestions.length > 0 && (
        <Card title="Suggested questions" className="mt-4">
          <div className="flex flex-wrap gap-2">
            {repo.suggestions.map((q) => (
              <Link key={q} href={`${base}/chat?q=${encodeURIComponent(q)}`}
                className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-accent hover:text-accent">
                {q}
              </Link>
            ))}
          </div>
        </Card>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Languages">
          <div className="flex h-2 overflow-hidden rounded-full bg-panel-2">
            {s.languages.map((l, i) => <div key={l.name} className={LANG_COLORS[i % LANG_COLORS.length]} style={{ width: `${l.percent}%` }} />)}
          </div>
          <ul className="mt-3 space-y-1 text-sm">
            {s.languages.map((l, i) => (
              <li key={l.name} className="flex items-center gap-2">
                <span className={`size-2 rounded-full ${LANG_COLORS[i % LANG_COLORS.length]}`} />
                <span className="flex-1">{l.name}</span>
                <span className="font-mono text-xs text-muted tabular-nums">{l.percent}%</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Stack & entry points">
          <div className="flex flex-wrap gap-1.5">
            {s.frameworks.length ? s.frameworks.map((f) => (
              <span key={f} className="rounded-md bg-panel-2 px-2 py-0.5 text-xs">{f}</span>
            )) : <span className="text-sm text-muted">No frameworks detected</span>}
          </div>
          <ul className="mt-4 space-y-1">
            {s.entryPoints.map((p) => (
              <li key={p}><Link href={codeUrl(repo.id, { path: p })} className="font-mono text-xs text-accent hover:underline">{p}</Link></li>
            ))}
            {!s.entryPoints.length && <li className="text-sm text-muted">No conventional entry point found</li>}
          </ul>
        </Card>

        <Card title="Potentially complex files">
          <ul className="space-y-1.5">
            {s.complexFiles.map((f) => (
              <li key={f.path} className="flex items-center gap-2">
                <Link href={codeUrl(repo.id, { path: f.path })} className="min-w-0 flex-1 truncate font-mono text-xs text-accent hover:underline" title={f.path}>{f.path}</Link>
                <span className="shrink-0 font-mono text-[11px] text-muted">{f.lines} lines · {f.entities} symbols</span>
              </li>
            ))}
          </ul>
        </Card>

        <ModuleTable title="Largest modules" rows={s.largestModules} metric={(m) => `${m.lines.toLocaleString()} lines`} repoId={repo.id} />
        <ModuleTable title="Most connected modules" rows={s.mostConnectedModules} metric={(m) => `${m.connections} links`} repoId={repo.id} />
        <Card title="Index">
          <dl className="space-y-1 text-sm">
            <Row k="Code entities" v={s.entities} />
            <Row k="Indexed files" v={s.indexedFiles} />
            <Row k="Source lines" v={s.lines} />
            <Row k="Components" v={s.components} />
            <Row k="Data models" v={s.models} />
          </dl>
        </Card>
      </div>
    </div>
  );
}

function Card({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-border bg-panel p-4 ${className}`}>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">{title}</h2>
      {children}
    </section>
  );
}

function Row({ k, v }: { k: string; v: number }) {
  return (
    <div className="flex justify-between"><dt className="text-muted">{k}</dt><dd className="font-mono tabular-nums">{(v ?? 0).toLocaleString()}</dd></div>
  );
}

function ModuleTable({ title, rows, metric, repoId }: { title: string; rows: ModuleStat[]; metric: (m: ModuleStat) => string; repoId: string }) {
  return (
    <Card title={title}>
      <ul className="space-y-1.5 text-sm">
        {rows.map((m) => (
          <li key={m.module} className="flex items-center gap-2">
            <Link href={`/repo/${repoId}/architecture?module=${encodeURIComponent(m.module)}`} className="min-w-0 flex-1 truncate font-mono text-xs text-accent hover:underline">{m.module}</Link>
            <span className="shrink-0 font-mono text-[11px] text-muted">{m.files} files · {metric(m)}</span>
          </li>
        ))}
        {!rows.length && <li className="text-muted">No data</li>}
      </ul>
    </Card>
  );
}
