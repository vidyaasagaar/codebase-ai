"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, Boxes, FileCode2, Loader2, AlertTriangle, X, RotateCcw } from "lucide-react";
import { useRepo, type ChatMessage } from "@/components/repository/repo-shell";
import { CodeViewer } from "@/components/code/code-viewer";
import { lineRange, type CodeTarget, type Source } from "@/lib/client";

export default function ChatPage() {
  return <Suspense><Chat /></Suspense>;
}

function Chat() {
  const { repo, messages, setMessages, focus, setFocus } = useRepo();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<CodeTarget | null>(null);
  const params = useSearchParams();
  const router = useRouter();
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const autoSent = useRef(false);

  // Follow streaming output only while the user is at the bottom; scrolling up pauses it.
  useEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const update = (fn: (m: ChatMessage) => ChatMessage) =>
    setMessages((prev) => [...prev.slice(0, -1), fn(prev[prev.length - 1])]);

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    const history = messages.filter((m) => !m.pending && !m.error).map((m) => ({ role: m.role, content: m.content }));
    const entity = focus;
    setInput("");
    setBusy(true);
    stickToBottom.current = true;
    setMessages((prev) => [...prev, { role: "user", content: question, focus: entity }, { role: "assistant", content: "", pending: true }]);
    try {
      const res = await fetch(`/api/repositories/${repo.id}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, entityId: entity?.id, history }),
      });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? `Request failed (${res.status})`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.type === "meta") update((m) => ({ ...m, sources: ev.sources, queryType: ev.queryType, evidence: ev.evidence }));
          else if (ev.type === "delta") update((m) => ({ ...m, content: m.content + ev.text }));
          else if (ev.type === "verification") update((m) => ({ ...m, verification: ev }));
          else if (ev.type === "error") update((m) => ({ ...m, error: ev.message }));
        }
      }
    } catch (err) {
      update((m) => ({ ...m, error: (err as Error).message }));
    } finally {
      update((m) => ({ ...m, pending: false }));
      setBusy(false);
    }
  }

  useEffect(() => {
    const q = params.get("q");
    if (q && !autoSent.current) {
      autoSent.current = true;
      router.replace(`/repo/${repo.id}/chat`);
      ask(q);
    }
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          ref={scroller}
          onScroll={(e) => { const el = e.currentTarget; stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120; }}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div className="mx-auto max-w-3xl px-4 py-6">
            {messages.length === 0 && (
              <div className="py-10">
                <Boxes className="size-6 text-accent" />
                <h1 className="mt-3 text-xl font-semibold">Ask anything about {repo.name}</h1>
                <p className="mt-1 text-sm text-muted">
                  Answers are grounded in {repo.stats.entities.toLocaleString()} indexed code entities and cite exact files and lines.
                </p>
                <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {(repo.suggestions ?? []).map((q) => (
                    <button key={q} onClick={() => ask(q)} className="rounded-lg border border-border bg-panel px-3 py-2 text-left text-sm hover:border-accent">
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-6">
              {messages.map((m, i) => m.role === "user"
                ? <UserBubble key={i} m={m} />
                : <Answer key={i} m={m} onOpen={setCode} />)}
            </div>
          </div>
        </div>

        <div className="border-t border-border bg-panel px-4 py-3">
          <form className="mx-auto max-w-3xl" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
            {focus && (
              <div className="mb-2 inline-flex items-center gap-2 rounded-md bg-accent-soft px-2 py-1 font-mono text-xs text-accent">
                About: {focus.symbol_name} · {focus.file_path}:{lineRange(focus.start_line, focus.end_line)}
                <button type="button" onClick={() => setFocus(null)} aria-label="Clear focus"><X className="size-3" /></button>
              </div>
            )}
            <div className="flex items-end gap-2 rounded-xl border border-border bg-bg p-2 focus-within:border-accent">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input); } }}
                rows={1}
                placeholder="Ask anything about this codebase…"
                className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none [field-sizing:content]"
              />
              {messages.length > 0 && (
                <button type="button" onClick={() => setMessages([])} disabled={busy} className="p-2 text-muted hover:text-fg" title="Clear conversation">
                  <RotateCcw className="size-4" />
                </button>
              )}
              <button disabled={busy || !input.trim()} className="rounded-lg bg-accent p-2 text-white disabled:opacity-40" aria-label="Send">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
              </button>
            </div>
          </form>
        </div>
      </div>

      {code && (
        <div className="fixed inset-x-0 bottom-0 z-20 h-[60vh] border-t border-border shadow-2xl lg:static lg:h-auto lg:w-[46%] lg:border-t-0 lg:border-l lg:shadow-none">
          <CodeViewer repoId={repo.id} path={code.path} start={code.start} end={code.end} showOpenInFiles onClose={() => setCode(null)} />
        </div>
      )}
    </div>
  );
}

function UserBubble({ m }: { m: ChatMessage }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-xl bg-accent-soft px-3.5 py-2 text-sm">
        {m.focus && <div className="mb-1 font-mono text-[11px] text-accent">about {m.focus.symbol_name}</div>}
        {m.content}
      </div>
    </div>
  );
}

const CITATION = /\[S(\d+)\]/g;

// Turn [S1] into links outside fenced code blocks so they render as clickable chips.
function linkCitations(text: string) {
  return text.split(/(```[\s\S]*?(?:```|$))/g).map((part, i) => (i % 2 ? part : part.replace(CITATION, "[S$1](#source-$1)"))).join("");
}

function Answer({ m, onOpen }: { m: ChatMessage; onOpen: (t: CodeTarget) => void }) {
  const sources = m.sources ?? [];
  const open = (s: Source) => onOpen({ path: s.file, start: s.startLine, end: s.endLine });
  const evidenceStyle = m.evidence === "strong" ? "text-ok" : m.evidence === "moderate" ? "text-warn" : "text-danger";

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-xs text-muted">
        <span className="font-semibold text-fg">Codebase AI</span>
        {m.queryType && <span className="rounded border border-border px-1.5 font-mono">{m.queryType} query</span>}
        {m.evidence && <span className={`font-mono ${evidenceStyle}`}>● {m.evidence} evidence</span>}
        {m.pending && !m.content && <span className="inline-flex items-center gap-1"><Loader2 className="size-3 animate-spin" />{sources.length ? "Reasoning over code…" : "Retrieving code…"}</span>}
      </div>

      {m.content && (
        <div className="answer">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children }) => {
                const n = href?.startsWith("#source-") ? Number(href.slice(8)) : 0;
                const s = sources[n - 1];
                if (n) {
                  return s
                    ? <button onClick={() => open(s)} title={`${s.file}:${lineRange(s.startLine, s.endLine)}`}
                        aria-label={`Source S${n}: ${s.file}:${lineRange(s.startLine, s.endLine)}`}
                        className="mx-0.5 rounded bg-accent-soft px-1 align-baseline font-mono text-[11px] text-accent hover:underline">S{n}</button>
                    : <span className="mx-0.5 rounded bg-danger/10 px-1 font-mono text-[11px] text-danger" title="Not a retrieved source">S{n}?</span>;
                }
                return <a href={href} target="_blank" rel="noreferrer" className="text-accent underline">{children}</a>;
              },
              code: ({ className, children }) => {
                const text = String(children);
                const match = !className && text.match(/^([\w@~./-]+\.\w+)(?::(\d+)(?:\s*[-–]\s*(\d+))?)?$/);
                const src = match ? sources.find((s) => s.file === match[1] || s.file.endsWith("/" + match[1])) : undefined;
                if (match && src) {
                  const start = match[2] ? Number(match[2]) : src.startLine;
                  const end = match[3] ? Number(match[3]) : match[2] ? start : src.endLine;
                  return <code className="cursor-pointer text-accent hover:underline" onClick={() => onOpen({ path: src.file, start, end })}>{children}</code>;
                }
                return <code className={className}>{children}</code>;
              },
            }}
          >
            {linkCitations(m.content)}
          </ReactMarkdown>
          {m.pending && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-accent align-middle" />}
        </div>
      )}

      {m.error && (
        <p className="mt-2 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {m.error}
        </p>
      )}

      {m.verification && (m.verification.unverifiedPaths.length > 0 || m.verification.invalidCitations.length > 0) && (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-xs text-warn">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Grounding check:{" "}
            {m.verification.unverifiedPaths.length > 0 && <>paths not found in the repository: <code className="font-mono">{m.verification.unverifiedPaths.join(", ")}</code>. </>}
            {m.verification.invalidCitations.length > 0 && <>citations without a matching source: {m.verification.invalidCitations.join(", ")}.</>}
          </span>
        </p>
      )}

      {sources.length > 0 && (
        <details className="mt-3 rounded-lg border border-border bg-panel" open={!m.pending && sources.length <= 6}>
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted">
            Sources · {sources.length} code entities from {new Set(sources.map((s) => s.file)).size} files
          </summary>
          <ul className="divide-y divide-border border-t border-border">
            {sources.map((s) => (
              <li key={s.n}>
                <button onClick={() => open(s)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-panel-2">
                  <span className="w-7 shrink-0 font-mono text-[11px] text-accent">S{s.n}</span>
                  <FileCode2 className="size-3.5 shrink-0 text-muted" />
                  <span className="shrink-0 font-mono text-xs">{s.route ?? s.symbol}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">{s.file}:{lineRange(s.startLine, s.endLine)}</span>
                  <span className="hidden shrink-0 text-[11px] text-muted sm:inline">{s.reason}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
