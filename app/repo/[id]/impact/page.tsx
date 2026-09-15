"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, MessageSquare, Search, Zap } from "lucide-react";
import { useRepo } from "@/components/repository/repo-shell";
import { api, codeUrl, lineRange, type EntityLite } from "@/lib/client";

interface Impact {
  target: EntityLite;
  impacted: {
    entity: EntityLite;
    depth: number;
    severity: "HIGH" | "MEDIUM" | "LOW";
    reason: string;
    via: { id: number; symbol_name: string; file_path: string } | null;
  }[];
  importingFiles: string[];
  summary: { high: number; medium: number; low: number; files: number };
}

interface Deps { dependsOn: EntityLite[]; usedBy: EntityLite[]; externalImports: string[] }

const SEVERITY: Record<string, { label: string; style: string; hint: string }> = {
  HIGH: { label: "HIGH", style: "text-danger border-danger/40", hint: "Direct callers and route handlers" },
  MEDIUM: { label: "MEDIUM", style: "text-warn border-warn/40", hint: "Two hops away in the call graph" },
  LOW: { label: "LOW", style: "text-muted border-border", hint: "Three hops away" },
};

export default function ImpactPage() {
  return <Suspense><ImpactView /></Suspense>;
}

function ImpactView() {
  const { repo, setFocus } = useRepo();
  const params = useSearchParams();
  const router = useRouter();
  const entityId = Number(params.get("entity")) || null;
  const [q, setQ] = useState("");
  const [results, setResults] = useState<EntityLite[]>([]);
  const [top, setTop] = useState<EntityLite[]>([]);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [deps, setDeps] = useState<Deps | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { api<EntityLite[]>(`/api/repositories/${repo.id}/entities`).then(setTop); }, [repo.id]);
  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const t = setTimeout(() => api<EntityLite[]>(`/api/repositories/${repo.id}/entities?q=${encodeURIComponent(q)}`).then(setResults), 200);
    return () => clearTimeout(t);
  }, [q, repo.id]);
  useEffect(() => {
    if (!entityId) { setImpact(null); setDeps(null); return; }
    setLoading(true);
    Promise.all([
      api<Impact>(`/api/repositories/${repo.id}/impact-analysis`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entityId }) }),
      api<Deps>(`/api/repositories/${repo.id}/entities/${entityId}`),
    ]).then(([i, d]) => { setImpact(i); setDeps(d); }).finally(() => setLoading(false));
  }, [entityId, repo.id]);

  const pick = (e: EntityLite) => { setQ(""); router.push(`/repo/${repo.id}/impact?entity=${e.id}`); };
  const explain = () => {
    if (!impact) return;
    setFocus(impact.target);
    router.push(`/repo/${repo.id}/chat?q=${encodeURIComponent(`What would be affected if I changed ${impact.target.symbol_name}, and why?`)}`);
  };

  const picker = (items: EntityLite[]) => (
    <ul className="divide-y divide-border rounded-xl border border-border bg-panel">
      {items.map((e) => (
        <li key={e.id}>
          <button onClick={() => pick(e)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-panel-2">
            <span className="w-16 shrink-0 font-mono text-[11px] text-muted">{e.symbol_type}</span>
            <span className="font-mono text-sm">{e.parent ? `${e.parent}.` : ""}{e.symbol_name}</span>
            <span className="min-w-0 flex-1 truncate text-right font-mono text-[11px] text-muted">{e.file_path}{e.refs ? ` · ${e.refs} references` : ""}</span>
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <h1 className="text-xl font-semibold">Dependencies & Change Impact</h1>
      <p className="mt-1 text-sm text-muted">Pick a function or class to see what it depends on, what uses it, and what could break if it changes.</p>

      <div className="relative mt-4">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-panel px-3 py-2 focus-within:border-accent">
          <Search className="size-4 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a symbol, e.g. createUser" className="flex-1 bg-transparent text-sm outline-none" />
        </div>
        {results.length > 0 && <div className="absolute inset-x-0 top-full z-10 mt-1 max-h-80 overflow-auto shadow-lg">{picker(results)}</div>}
      </div>

      {!entityId && top.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Most depended-on code</h2>
          {picker(top)}
        </section>
      )}

      {loading && <Loader2 className="mt-8 size-5 animate-spin text-muted" />}

      {impact && !loading && (
        <div className="mt-6 space-y-4">
          <section className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-panel p-4">
            <Zap className="size-5 text-accent" />
            <div className="min-w-0 flex-1 basis-48">
              <div className="font-mono text-base font-semibold [overflow-wrap:anywhere]">{impact.target.symbol_name}</div>
              <Link href={codeUrl(repo.id, { path: impact.target.file_path, start: impact.target.start_line, end: impact.target.end_line })} className="font-mono text-xs break-all text-accent hover:underline">
                {impact.target.file_path}:{lineRange(impact.target.start_line, impact.target.end_line)}
              </Link>
            </div>
            <button onClick={explain} className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white">
              <MessageSquare className="size-4" /> Explain impact with AI
            </button>
          </section>

          <section className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
            {[["High", impact.summary.high, "text-danger"], ["Medium", impact.summary.medium, "text-warn"], ["Low", impact.summary.low, "text-muted"], ["Files affected", impact.summary.files, "text-fg"]].map(([k, v, c]) => (
              <div key={k as string} className="bg-panel px-4 py-3">
                <div className="text-xs text-muted">{k}</div>
                <div className={`mt-1 font-mono text-xl font-semibold ${c}`}>{v}</div>
              </div>
            ))}
          </section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <section className="rounded-xl border border-border bg-panel p-4 lg:col-span-2">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Potential impact</h2>
              {impact.impacted.length === 0 && <p className="text-sm text-muted">No callers found in the indexed call graph. It may be unused, called dynamically, or used via an import that could not be resolved.</p>}
              {(["HIGH", "MEDIUM", "LOW"] as const).map((sev) => {
                const items = impact.impacted.filter((i) => i.severity === sev);
                if (!items.length) return null;
                return (
                  <div key={sev} className="mb-4">
                    <div className="flex items-center gap-2">
                      <span className={`rounded border px-1.5 font-mono text-[11px] font-semibold ${SEVERITY[sev].style}`}>{sev}</span>
                      <span className="text-xs text-muted">{SEVERITY[sev].hint}</span>
                    </div>
                    <ul className="mt-2 border-l border-border pl-3">
                      {items.map((i) => (
                        <li key={i.entity.id} className="py-1">
                          <Link href={codeUrl(repo.id, { path: i.entity.file_path, start: i.entity.start_line, end: i.entity.end_line })} className="font-mono text-sm hover:text-accent">
                            {i.entity.route ?? i.entity.symbol_name}
                          </Link>
                          <span className="ml-2 font-mono text-[11px] break-all text-muted">{i.entity.file_path}:{i.entity.start_line}</span>
                          <div className="text-xs text-muted">{i.reason}</div>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
              {impact.importingFiles.length > 0 && (
                <div>
                  <div className="text-xs text-muted">Other files importing {impact.target.file_path.split("/").pop()}</div>
                  <ul className="mt-1 border-l border-border pl-3">
                    {impact.importingFiles.map((f) => (
                      <li key={f}><Link href={codeUrl(repo.id, { path: f })} className="font-mono text-xs break-all hover:text-accent">{f}</Link></li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            <section className="rounded-xl border border-border bg-panel p-4">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Dependency explorer</h2>
              <Tree title={`${impact.target.symbol_name} depends on`} items={deps?.dependsOn ?? []} extra={deps?.externalImports ?? []} repoId={repo.id} onPick={pick} />
              <div className="h-4" />
              <Tree title={`${impact.target.symbol_name} is used by`} items={deps?.usedBy ?? []} extra={[]} repoId={repo.id} onPick={pick} />
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

function Tree({ title, items, extra, onPick }: { title: string; items: EntityLite[]; extra: string[]; repoId: string; onPick: (e: EntityLite) => void }) {
  const all = [...items.map((i) => ({ key: `e${i.id}${i.relationship_type}`, label: i.symbol_name, entity: i })), ...extra.map((x) => ({ key: `x${x}`, label: x, entity: null }))];
  return (
    <div className="overflow-x-auto font-mono text-xs">
      <div className="font-semibold">{title}</div>
      {all.length === 0 && <div className="pl-2 text-muted">└── (none resolved)</div>}
      {all.map((n, i) => (
        <div key={n.key} className="pl-2 whitespace-nowrap">
          <span className="text-muted">{i === all.length - 1 ? "└── " : "├── "}</span>
          {n.entity
            ? <button onClick={() => onPick(n.entity!)} className="hover:text-accent" title={`${n.entity.file_path}:${n.entity.start_line} — analyze impact`}>{n.label}</button>
            : <span className="text-muted">{n.label} (package)</span>}
        </div>
      ))}
    </div>
  );
}
