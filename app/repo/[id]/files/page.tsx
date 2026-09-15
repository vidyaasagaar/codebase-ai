"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, FileCode2, Folder, MessageSquare, Search, Zap } from "lucide-react";
import { useRepo } from "@/components/repository/repo-shell";
import { CodeViewer, type FileData } from "@/components/code/code-viewer";
import { api, codeUrl, lineRange, type EntityLite } from "@/lib/client";

interface FileRow { path: string; language: string; module: string; line_count: number }
interface TreeNode { name: string; path: string; children: Map<string, TreeNode>; file?: FileRow }

export default function FilesPage() {
  return <Suspense><Files /></Suspense>;
}

function Files() {
  const { repo } = useRepo();
  const params = useSearchParams();
  const router = useRouter();
  const path = params.get("path");
  const start = Number(params.get("start")) || undefined;
  const end = Number(params.get("end")) || undefined;
  const [files, setFiles] = useState<FileRow[]>([]);
  const [filter, setFilter] = useState("");
  const [file, setFile] = useState<FileData | null>(null);

  useEffect(() => { api<FileRow[]>(`/api/repositories/${repo.id}/files`).then(setFiles); }, [repo.id]);
  useEffect(() => {
    if (!path && files.length) router.replace(codeUrl(repo.id, { path: repo.stats.entryPoints[0] ?? files[0].path }));
  }, [path, files, repo, router]);

  const go = (p: string, s?: number, e?: number) => router.push(codeUrl(repo.id, { path: p, start: s, end: e }));
  const selected = file?.path === path ? file.entities.find((x) => x.start_line === start) ?? null : null;

  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,14rem)_minmax(0,1fr)_auto] lg:grid-cols-[16rem_minmax(0,1fr)_18rem] lg:grid-rows-1">
      <aside className="flex min-h-0 flex-col border-b border-border bg-panel lg:border-r lg:border-b-0">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="size-3.5 text-muted" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter files" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
        </div>
        <div className="min-h-0 flex-1 overflow-auto py-1 font-mono text-xs">
          {filter
            ? files.filter((f) => f.path.toLowerCase().includes(filter.toLowerCase())).slice(0, 300).map((f) => (
                <button key={f.path} onClick={() => go(f.path)} className={`block w-full truncate px-3 py-1 text-left hover:bg-panel-2 ${f.path === path ? "text-accent" : ""}`} title={f.path}>
                  {f.path}
                </button>
              ))
            : <FileTree files={files} selected={path} onSelect={go} />}
        </div>
      </aside>

      <section className="min-h-0 min-w-0">
        {path ? <CodeViewer repoId={repo.id} path={path} start={start} end={end} onLoad={setFile} /> : null}
      </section>

      <aside className="max-h-64 min-h-0 overflow-auto border-t border-border bg-panel lg:max-h-none lg:border-t-0 lg:border-l">
        <SymbolSearch repoId={repo.id} onPick={(e) => go(e.file_path, e.start_line, e.end_line)} />
        {selected && <DependencyPanel repoId={repo.id} entity={selected} onNavigate={(e) => go(e.file_path, e.start_line, e.end_line)} />}
        <div className="px-3 py-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Outline</h3>
          <ul className="mt-2 space-y-0.5">
            {file?.path === path && file.entities.map((e) => (
              <li key={e.id}>
                <button onClick={() => go(e.file_path ?? path!, e.start_line, e.end_line)}
                  className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-panel-2 ${selected?.id === e.id ? "bg-accent-soft text-accent" : ""}`}>
                  <TypeBadge type={e.symbol_type} />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{e.route ?? (e.parent ? `${e.parent}.${e.symbol_name}` : e.symbol_name)}</span>
                  <span className="font-mono text-[10px] text-muted">{e.start_line}</span>
                </button>
              </li>
            ))}
            {file?.path === path && !file.entities.length && <li className="text-xs text-muted">No symbols extracted</li>}
          </ul>
        </div>
      </aside>
    </div>
  );
}

export function TypeBadge({ type }: { type: string }) {
  const short: Record<string, string> = { function: "fn", method: "m", class: "C", interface: "I", type: "T", enum: "E", component: "<>", model: "M", route: "→", module: "§" };
  return <span className="w-5 shrink-0 text-center font-mono text-[10px] text-accent" title={type}>{short[type] ?? "·"}</span>;
}

function FileTree({ files, selected, onSelect }: { files: FileRow[]; selected: string | null; onSelect: (p: string) => void }) {
  const root = useMemo(() => {
    const r: TreeNode = { name: "", path: "", children: new Map() };
    for (const f of files) {
      let node = r;
      const parts = f.path.split("/");
      parts.forEach((part, i) => {
        const p = parts.slice(0, i + 1).join("/");
        if (!node.children.has(part)) node.children.set(part, { name: part, path: p, children: new Map() });
        node = node.children.get(part)!;
        if (i === parts.length - 1) node.file = f;
      });
    }
    return r;
  }, [files]);
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!selected) return;
    const parts = selected.split("/");
    setOpen((prev) => new Set([...prev, ...parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"))]));
  }, [selected]);

  const render = (node: TreeNode, depth: number): React.ReactNode =>
    [...node.children.values()]
      .sort((a, b) => Number(!!a.file) - Number(!!b.file) || a.name.localeCompare(b.name))
      .map((child) => (
        <div key={child.path}>
          <button
            onClick={() => child.file ? onSelect(child.path) : setOpen((s) => { const n = new Set(s); if (n.has(child.path)) n.delete(child.path); else n.add(child.path); return n; })}
            className={`flex w-full items-center gap-1 py-0.5 pr-2 text-left hover:bg-panel-2 ${child.path === selected ? "bg-accent-soft text-accent" : ""}`}
            style={{ paddingLeft: 8 + depth * 12 }}
          >
            {child.file ? <FileCode2 className="size-3.5 shrink-0 text-muted" />
              : <>{open.has(child.path) ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />}<Folder className="size-3.5 shrink-0 text-muted" /></>}
            <span className="truncate">{child.name}</span>
          </button>
          {!child.file && open.has(child.path) && render(child, depth + 1)}
        </div>
      ));

  return <>{render(root, 0)}</>;
}

function SymbolSearch({ repoId, onPick }: { repoId: string; onPick: (e: EntityLite) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<EntityLite[]>([]);
  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const t = setTimeout(() => api<EntityLite[]>(`/api/repositories/${repoId}/entities?q=${encodeURIComponent(q)}`).then(setResults), 200);
    return () => clearTimeout(t);
  }, [q, repoId]);
  return (
    <div className="border-b border-border px-3 py-2">
      <div className="flex items-center gap-2">
        <Search className="size-3.5 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Go to symbol" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
      </div>
      {results.length > 0 && (
        <ul className="mt-2 max-h-56 overflow-auto">
          {results.map((e) => (
            <li key={e.id}>
              <button onClick={() => { onPick(e); setQ(""); }} className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-left hover:bg-panel-2">
                <TypeBadge type={e.symbol_type} />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{e.symbol_name}</span>
                <span className="max-w-24 truncate font-mono text-[10px] text-muted">{e.file_path.split("/").pop()}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface Deps {
  dependsOn: EntityLite[];
  usedBy: EntityLite[];
  externalImports: string[];
  fileImports: string[];
  importedBy: string[];
}

function DependencyPanel({ repoId, entity, onNavigate }: { repoId: string; entity: EntityLite; onNavigate: (e: EntityLite) => void }) {
  const { setFocus } = useRepo();
  const router = useRouter();
  const [deps, setDeps] = useState<Deps | null>(null);
  useEffect(() => { setDeps(null); api<Deps>(`/api/repositories/${repoId}/entities/${entity.id}`).then(setDeps); }, [repoId, entity.id]);

  const list = (title: string, items: EntityLite[]) => (
    <div className="mt-3">
      <h4 className="text-[11px] font-medium text-muted">{title} ({items.length})</h4>
      <ul className="mt-1 border-l border-border pl-2">
        {items.slice(0, 25).map((d) => (
          <li key={`${d.id}-${d.relationship_type}`}>
            <button onClick={() => onNavigate(d)} className="flex w-full items-center gap-1 py-0.5 text-left font-mono text-xs hover:text-accent" title={`${d.file_path}:${lineRange(d.start_line, d.end_line)}`}>
              <span className="truncate">{d.symbol_name}</span>
              {d.relationship_type === "handles" && <span className="text-[10px] text-muted">route</span>}
            </button>
          </li>
        ))}
        {!items.length && <li className="text-xs text-muted">none resolved</li>}
      </ul>
    </div>
  );

  return (
    <div className="border-b border-border px-3 py-3">
      <div className="flex items-center gap-1.5">
        <TypeBadge type={entity.symbol_type} />
        <span className="min-w-0 truncate font-mono text-sm font-medium">{entity.symbol_name}</span>
      </div>
      <div className="mt-2 flex gap-2">
        <button onClick={() => { setFocus({ ...entity, file_path: entity.file_path }); router.push(`/repo/${repoId}/chat`); }}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:border-accent hover:text-accent">
          <MessageSquare className="size-3" /> Ask AI
        </button>
        <Link href={`/repo/${repoId}/impact?entity=${entity.id}`} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:border-accent hover:text-accent">
          <Zap className="size-3" /> Impact
        </Link>
      </div>
      {!deps ? <p className="mt-3 text-xs text-muted">Loading dependencies…</p> : (
        <>
          {list("Depends on", deps.dependsOn)}
          {list("Used by", deps.usedBy)}
          {deps.externalImports.length > 0 && (
            <div className="mt-3">
              <h4 className="text-[11px] font-medium text-muted">External packages</h4>
              <p className="mt-1 font-mono text-xs break-words">{deps.externalImports.join(", ")}</p>
            </div>
          )}
          {deps.importedBy.length > 0 && (
            <div className="mt-3">
              <h4 className="text-[11px] font-medium text-muted">File imported by ({deps.importedBy.length})</h4>
              <ul className="mt-1 border-l border-border pl-2">
                {deps.importedBy.slice(0, 15).map((f) => (
                  <li key={f}><Link href={codeUrl(repoId, { path: f })} className="block truncate font-mono text-xs hover:text-accent" title={f}>{f}</Link></li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
