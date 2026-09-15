"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Editor, { type OnMount } from "@monaco-editor/react";
import { Copy, Check, ExternalLink, Loader2, X } from "lucide-react";
import { api, codeUrl, lineRange, type EntityLite } from "@/lib/client";

export interface FileData {
  path: string;
  language: string;
  content: string;
  entities: EntityLite[];
}

const MONACO_LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript",
  cjs: "javascript", py: "python", java: "java", go: "go", json: "json", md: "markdown", yml: "yaml", yaml: "yaml", sql: "sql",
  html: "html", css: "css", scss: "scss", sh: "shell", rb: "ruby", php: "php", rs: "rust", cs: "csharp", kt: "kotlin",
  xml: "xml", graphql: "graphql", gql: "graphql", swift: "swift", scala: "scala", c: "c", h: "c", cpp: "cpp", hpp: "cpp",
};

function monacoLanguage(path: string) {
  const name = path.split("/").pop() ?? "";
  if (name === "Dockerfile") return "dockerfile";
  return MONACO_LANG[name.split(".").pop()?.toLowerCase() ?? ""] ?? "plaintext";
}

type Editor = Parameters<OnMount>[0];
type Monaco = Parameters<OnMount>[1];

export function CodeViewer({
  repoId, path, start, end, onLoad, onClose, showOpenInFiles = false,
}: {
  repoId: string;
  path: string;
  start?: number;
  end?: number;
  onLoad?: (file: FileData) => void;
  onClose?: () => void;
  showOpenInFiles?: boolean;
}) {
  const [file, setFile] = useState<FileData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [dark, setDark] = useState(false);
  const editorRef = useRef<Editor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const decorations = useRef<ReturnType<Editor["createDecorationsCollection"]> | null>(null);
  const onLoadRef = useRef(onLoad);
  useEffect(() => { onLoadRef.current = onLoad; });

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setDark(mq.matches);
    const fn = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api<FileData>(`/api/repositories/${repoId}/files?path=${encodeURIComponent(path)}`)
      .then((f) => { if (!cancelled) { setFile(f); onLoadRef.current?.(f); } })
      .catch((e) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [repoId, path]);

  const highlight = () => {
    const editor = editorRef.current, monaco = monacoRef.current;
    if (!editor || !monaco) return;
    decorations.current?.clear();
    if (!start) return;
    const last = Math.max(start, end ?? start);
    decorations.current = editor.createDecorationsCollection([{
      range: new monaco.Range(start, 1, last, 1),
      options: { isWholeLine: true, className: "code-highlight", linesDecorationsClassName: "code-highlight-gutter" },
    }]);
    editor.revealLinesInCenterIfOutsideViewport(start, Math.min(last, start + 30));
    editor.setPosition({ lineNumber: start, column: 1 });
  };

  useEffect(highlight, [start, end, file]);

  const copy = async () => {
    if (!file) return;
    const text = start ? file.content.split("\n").slice(start - 1, end ?? start).join("\n") : file.content;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="min-w-0 truncate font-mono text-xs" title={path}>{path}</span>
        {start && <span className="shrink-0 rounded bg-accent-soft px-1.5 font-mono text-[11px] text-accent">L{lineRange(start, end)}</span>}
        <div className="ml-auto flex shrink-0 items-center gap-2 text-muted">
          <button onClick={copy} className="hover:text-fg" title={start ? "Copy highlighted lines" : "Copy file"}>
            {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
          </button>
          {showOpenInFiles && (
            <Link href={codeUrl(repoId, { path, start, end })} className="hover:text-fg" title="Open in file explorer">
              <ExternalLink className="size-3.5" />
            </Link>
          )}
          {onClose && (
            <button onClick={onClose} className="hover:text-fg" title="Close" aria-label="Close code viewer">
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        {error && <p className="p-4 text-sm text-danger">{error}</p>}
        {!file && !error && <Loader2 className="m-4 size-4 animate-spin text-muted" />}
        {file && file.path === path && (
          <Editor
            path={`${repoId}/${path}`}
            value={file.content}
            language={monacoLanguage(path)}
            theme={dark ? "vs-dark" : "vs"}
            onMount={(editor, monaco) => { editorRef.current = editor; monacoRef.current = monaco; highlight(); }}
            loading={<Loader2 className="size-4 animate-spin text-muted" />}
            options={{
              readOnly: true, minimap: { enabled: false }, fontSize: 12.5, scrollBeyondLastLine: false,
              renderLineHighlight: "none", automaticLayout: true, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
            }}
          />
        )}
      </div>
    </div>
  );
}
