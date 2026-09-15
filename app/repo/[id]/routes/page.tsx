"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MessageSquare, Search } from "lucide-react";
import { useRepo } from "@/components/repository/repo-shell";
import { CodeViewer } from "@/components/code/code-viewer";
import { api, type EntityLite } from "@/lib/client";

const METHOD_STYLE: Record<string, string> = {
  GET: "text-ok", POST: "text-accent", PUT: "text-warn", PATCH: "text-warn", DELETE: "text-danger",
};

export default function RoutesPage() {
  const { repo } = useRepo();
  const [routes, setRoutes] = useState<EntityLite[] | null>(null);
  const [filter, setFilter] = useState("");
  const [active, setActive] = useState<EntityLite | null>(null);

  useEffect(() => { api<EntityLite[]>(`/api/repositories/${repo.id}/entities?routes=1`).then(setRoutes); }, [repo.id]);

  const shown = (routes ?? []).filter((r) => `${r.route} ${r.file_path} ${r.symbol_name}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold">API Routes</h1>
            <span className="font-mono text-sm text-muted">{routes?.length ?? "…"}</span>
            <div className="ml-auto flex items-center gap-2 rounded-lg border border-border bg-panel px-2 py-1.5">
              <Search className="size-3.5 text-muted" />
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter routes" className="w-48 bg-transparent text-sm outline-none" />
            </div>
          </div>
          <p className="mt-1 text-sm text-muted">Detected from Express/Fastify/Koa calls, Next.js route handlers, FastAPI/Flask decorators, Spring and NestJS annotations, and Go routers.</p>

          {routes && routes.length === 0 && <p className="mt-8 text-sm text-muted">No HTTP routes were detected in this repository.</p>}

          <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-panel">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border">
                {shown.map((r) => {
                  const [method, ...rest] = (r.route ?? "").split(" ");
                  return (
                    <tr key={r.id} onClick={() => setActive(r)} className={`cursor-pointer hover:bg-panel-2 ${active?.id === r.id ? "bg-accent-soft" : ""}`}>
                      <td className={`w-20 px-3 py-2 font-mono text-xs font-semibold ${METHOD_STYLE[method] ?? "text-muted"}`}>{method}</td>
                      <td className="px-3 py-2 font-mono text-xs">{rest.join(" ")}</td>
                      <td className="hidden px-3 py-2 font-mono text-[11px] text-muted md:table-cell">
                        {r.symbol_type !== "route" && <span className="text-fg">{r.parent ? `${r.parent}.` : ""}{r.symbol_name}() · </span>}
                        {r.file_path}:{r.start_line}
                      </td>
                      <td className="w-10 px-2 py-2 text-right">
                        <Link href={`/repo/${repo.id}/chat?q=${encodeURIComponent(`How does the ${r.route} endpoint work?`)}`} onClick={(e) => e.stopPropagation()}
                          className="text-muted hover:text-accent" title="Ask AI how this endpoint works">
                          <MessageSquare className="size-4" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {active && (
        <div className="fixed inset-x-0 bottom-0 z-20 h-[55vh] border-t border-border shadow-2xl lg:static lg:h-auto lg:w-[45%] lg:border-t-0 lg:border-l lg:shadow-none">
          <CodeViewer repoId={repo.id} path={active.file_path} start={active.start_line} end={active.end_line} showOpenInFiles onClose={() => setActive(null)} />
        </div>
      )}
    </div>
  );
}
