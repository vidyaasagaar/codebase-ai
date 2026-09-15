"use client";

import "@xyflow/react/dist/style.css";
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ReactFlow, Background, Controls, Handle, Position, MarkerType,
  type Edge, type Node, type NodeProps,
} from "@xyflow/react";
import { graphlib, layout } from "@dagrejs/dagre";
import { ChevronRight, Code2, Loader2, Search } from "lucide-react";
import { useRepo } from "@/components/repository/repo-shell";
import { api, codeUrl } from "@/lib/client";

interface GNode {
  id: string;
  files?: number;
  lines: number;
  functions?: number;
  classes?: number;
  routes?: number;
  language?: string;
  module?: string;
  external?: boolean;
}
interface Graph { nodes: GNode[]; edges: { source: string; target: string; weight: number }[] }

type NodeData = { node: GNode; label: string; state: "normal" | "selected" | "dependency" | "dependent" | "dim" | "match"; fileLevel: boolean };

const NODE_W = 210, NODE_H = 64;

function GraphNode({ data }: NodeProps<Node<NodeData>>) {
  const { node, label, state, fileLevel } = data;
  const ring = {
    normal: "border-border", selected: "border-accent ring-2 ring-accent/30", dependency: "border-accent",
    dependent: "border-warn", dim: "border-border opacity-35", match: "border-ok ring-2 ring-ok/30",
  }[state];
  return (
    <div className={`rounded-lg border bg-panel px-3 py-2 shadow-sm transition-opacity ${ring} ${node.external ? "border-dashed" : ""}`} style={{ width: NODE_W }}>
      <Handle type="target" position={Position.Left} className="!bg-border" />
      <div className="truncate font-mono text-xs font-semibold" title={node.id}>{label}</div>
      <div className="mt-1 truncate text-[10px] text-muted">
        {fileLevel
          ? `${node.lines} lines${node.external ? ` · ${node.module}` : ""}`
          : `${node.files} files · ${node.functions} fns · ${node.classes} classes${node.routes ? ` · ${node.routes} routes` : ""}`}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-border" />
    </div>
  );
}

const nodeTypes = { g: GraphNode };

export default function ArchitecturePage() {
  return <Suspense><Architecture /></Suspense>;
}

function Architecture() {
  const { repo } = useRepo();
  const params = useSearchParams();
  const router = useRouter();
  const moduleName = params.get("module");
  const [graph, setGraph] = useState<Graph | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    setGraph(null);
    setSelected(null);
    api<Graph>(`/api/repositories/${repo.id}/architecture${moduleName ? `?module=${encodeURIComponent(moduleName)}` : ""}`).then(setGraph);
  }, [repo.id, moduleName]);

  const fileLevel = Boolean(moduleName);

  const positions = useMemo(() => {
    if (!graph) return new Map<string, { x: number; y: number }>();
    const g = new graphlib.Graph();
    g.setGraph({ rankdir: "LR", nodesep: 24, ranksep: 90, marginx: 20, marginy: 20 });
    g.setDefaultEdgeLabel(() => ({}));
    graph.nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
    graph.edges.forEach((e) => g.setEdge(e.source, e.target));
    layout(g);
    return new Map(graph.nodes.map((n) => {
      const p = g.node(n.id);
      return [n.id, { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 }];
    }));
  }, [graph]);

  const { nodes, edges } = useMemo(() => {
    if (!graph) return { nodes: [], edges: [] };
    const deps = new Set(graph.edges.filter((e) => e.source === selected).map((e) => e.target));
    const dependents = new Set(graph.edges.filter((e) => e.target === selected).map((e) => e.source));
    const q = search.trim().toLowerCase();
    const maxW = Math.max(1, ...graph.edges.map((e) => e.weight));

    const nodes: Node<NodeData>[] = graph.nodes.map((n) => {
      let state: NodeData["state"] = "normal";
      if (selected) state = n.id === selected ? "selected" : deps.has(n.id) ? "dependency" : dependents.has(n.id) ? "dependent" : "dim";
      else if (q) state = n.id.toLowerCase().includes(q) ? "match" : "dim";
      return {
        id: n.id, type: "g", position: positions.get(n.id) ?? { x: 0, y: 0 },
        data: { node: n, label: fileLevel ? n.id.split("/").slice(-2).join("/") : n.id, state, fileLevel },
      };
    });
    const edges: Edge[] = graph.edges.map((e) => {
      const out = e.source === selected, inc = e.target === selected;
      const color = out ? "var(--accent)" : inc ? "var(--warn)" : "var(--border)";
      return {
        id: `${e.source}->${e.target}`, source: e.source, target: e.target,
        style: { stroke: color, strokeWidth: 1 + (e.weight / maxW) * 3, opacity: selected && !out && !inc ? 0.15 : 1 },
        markerEnd: { type: MarkerType.ArrowClosed, color },
        animated: out || inc,
      };
    });
    return { nodes, edges };
  }, [graph, positions, selected, search, fileLevel]);

  const sel = graph?.nodes.find((n) => n.id === selected);
  const selDeps = graph?.edges.filter((e) => e.source === selected) ?? [];
  const selDependents = graph?.edges.filter((e) => e.target === selected) ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-panel px-4 py-2">
        <Link href={`/repo/${repo.id}/architecture`} className={`text-sm ${moduleName ? "text-muted hover:text-fg" : "font-medium"}`}>Modules</Link>
        {moduleName && <><ChevronRight className="size-3.5 text-muted" /><span className="font-mono text-sm font-medium">{moduleName}</span></>}
        <div className="ml-auto flex items-center gap-3">
          <div className="hidden items-center gap-3 text-[11px] text-muted sm:flex">
            <span className="flex items-center gap-1"><span className="h-0.5 w-4 bg-accent" /> depends on</span>
            <span className="flex items-center gap-1"><span className="h-0.5 w-4 bg-warn" /> used by</span>
          </div>
          <div className="flex items-center gap-2 rounded-md border border-border px-2 py-1">
            <Search className="size-3.5 text-muted" />
            <input value={search} onChange={(e) => { setSearch(e.target.value); setSelected(null); }} placeholder={moduleName ? "Search files" : "Search modules"} className="w-36 bg-transparent text-sm outline-none" />
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative min-h-[50vh] flex-1">
          {!graph ? <Loader2 className="m-6 size-5 animate-spin text-muted" /> : graph.nodes.length === 0 ? (
            <p className="p-6 text-sm text-muted">No source modules found.</p>
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              fitView
              minZoom={0.1}
              nodesDraggable={false}
              onNodeClick={(_, n) => setSelected(n.id === selected ? null : n.id)}
              onNodeDoubleClick={(_, n) => !fileLevel && router.push(`/repo/${repo.id}/architecture?module=${encodeURIComponent(n.id)}`)}
              onPaneClick={() => setSelected(null)}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={20} color="var(--border)" />
              <Controls showInteractive={false} />
            </ReactFlow>
          )}
        </div>

        <aside className="max-h-[40vh] shrink-0 overflow-auto border-t border-border bg-panel p-4 lg:max-h-none lg:w-72 lg:border-t-0 lg:border-l">
          {!sel ? (
            <div className="text-sm text-muted">
              <p>{fileLevel ? "Files in this module and the files they connect to (dashed = other modules)." : "Modules and the import / call relationships between them."}</p>
              <p className="mt-2">Click a node to highlight its dependencies and dependents{fileLevel ? "." : "; double-click to open its files."}</p>
            </div>
          ) : (
            <div>
              <div className="font-mono text-sm font-semibold break-all">{sel.id}</div>
              <div className="mt-1 text-xs text-muted">
                {fileLevel ? `${sel.lines} lines · ${sel.language} · module ${sel.module}` : `${sel.files} files · ${sel.lines.toLocaleString()} lines · ${sel.functions} functions · ${sel.routes} routes`}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {fileLevel ? (
                  <Link href={codeUrl(repo.id, { path: sel.id })} className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-xs text-white"><Code2 className="size-3" /> Open source</Link>
                ) : (
                  <Link href={`/repo/${repo.id}/architecture?module=${encodeURIComponent(sel.id)}`} className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-xs text-white">Open module files</Link>
                )}
                {!fileLevel && (
                  <Link href={`/repo/${repo.id}/chat?q=${encodeURIComponent(`What does the ${sel.id} module do and how does it interact with the rest of the system?`)}`} className="rounded-md border border-border px-2 py-1 text-xs hover:border-accent">Ask AI</Link>
                )}
              </div>
              <EdgeList title="Depends on" color="text-accent" items={selDeps.map((e) => [e.target, e.weight])} onPick={setSelected} />
              <EdgeList title="Used by" color="text-warn" items={selDependents.map((e) => [e.source, e.weight])} onPick={setSelected} />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function EdgeList({ title, color, items, onPick }: { title: string; color: string; items: [string, number][]; onPick: (id: string) => void }) {
  return (
    <div className="mt-4">
      <h3 className={`text-[11px] font-semibold uppercase tracking-wider ${color}`}>{title} ({items.length})</h3>
      <ul className="mt-1 space-y-0.5">
        {items.sort((a, b) => b[1] - a[1]).map(([id, w]) => (
          <li key={id} className="flex items-center gap-2">
            <button onClick={() => onPick(id)} className="min-w-0 flex-1 truncate text-left font-mono text-xs hover:text-accent" title={id}>{id}</button>
            <span className="font-mono text-[10px] text-muted">×{w}</span>
          </li>
        ))}
        {!items.length && <li className="text-xs text-muted">none</li>}
      </ul>
    </div>
  );
}
