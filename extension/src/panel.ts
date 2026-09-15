import * as vscode from "vscode";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { CodebaseApi, Project } from "./api";

interface Source {
  n: number;
  id: number;
  file: string;
  symbol: string;
  type: string;
  startLine: number;
  endLine: number;
  route: string | null;
  reason: string;
}

// "Ask About This Codebase" panel. Uses the existing Codebase AI query API (hybrid retrieval + grounded answer) and
// opens cited sources in the editor when the project matches a local workspace folder.
export class AskPanel {
  private static current: AskPanel | undefined;
  private readonly history: { role: "user" | "assistant"; content: string }[] = [];
  private busy = false;

  static show(api: CodebaseApi, project: Project, workspaceRoot: string | null) {
    if (AskPanel.current?.project.id === project.id) {
      AskPanel.current.workspaceRoot = workspaceRoot;
      AskPanel.current.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }
    AskPanel.current?.panel.dispose();
    const panel = vscode.window.createWebviewPanel(
      "codebaseAI.ask",
      `Codebase AI · ${project.name.split("/").pop()}`,
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );
    AskPanel.current = new AskPanel(panel, api, project, workspaceRoot);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly api: CodebaseApi,
    private readonly project: Project,
    private workspaceRoot: string | null,
  ) {
    panel.webview.html = this.html();
    panel.onDidDispose(() => {
      if (AskPanel.current === this) AskPanel.current = undefined;
    });
    panel.webview.onDidReceiveMessage((msg: { type: string; question?: string; source?: Source }) => {
      if (msg.type === "ask" && msg.question?.trim()) void this.ask(msg.question.trim());
      if (msg.type === "open" && msg.source) void this.openSource(msg.source);
    });
  }

  private post(message: unknown) {
    void this.panel.webview.postMessage(message);
  }

  private async ask(question: string) {
    if (this.busy) return;
    this.busy = true;
    this.post({ type: "start", question });
    let answer = "";
    try {
      const res = await this.api.request(`/api/repositories/${encodeURIComponent(this.project.id)}/query`, {
        method: "POST",
        body: JSON.stringify({ question, history: this.history.slice(-6) }),
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as { type: string; text?: string };
          if (event.type === "delta") answer += event.text ?? "";
          this.post(event);
        }
      }
      this.history.push({ role: "user", content: question }, { role: "assistant", content: answer });
    } catch (err) {
      this.post({ type: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      this.busy = false;
      this.post({ type: "end" });
    }
  }

  private async openSource(source: Source) {
    if (this.workspaceRoot) {
      const root = path.resolve(this.workspaceRoot);
      const target = path.resolve(root, source.file);
      if (target.startsWith(root + path.sep)) {
        try {
          const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
          const range = new vscode.Range(Math.max(0, source.startLine - 1), 0, Math.max(0, source.endLine - 1), Number.MAX_SAFE_INTEGER);
          await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, selection: range });
          return;
        } catch {
          // Not present locally (other branch / not cloned): fall back to the dashboard.
        }
      }
    }
    const q = new URLSearchParams({ path: source.file, start: String(source.startLine), end: String(source.endLine) });
    await vscode.env.openExternal(vscode.Uri.parse(`${this.api.serverUrl}/repo/${encodeURIComponent(this.project.id)}/files?${q}`));
  }

  private html() {
    const nonce = crypto.randomBytes(16).toString("base64");
    const title = escapeHtml(this.project.name);
    const subtitle = escapeHtml(`${this.project.private ? "Private · " : ""}${this.project.status}${this.workspaceRoot ? " · sources open in the editor" : " · sources open in the dashboard"}`);
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); margin: 0; display: flex; flex-direction: column; height: 100vh; }
  header { padding: 10px 14px; border-bottom: 1px solid var(--vscode-panel-border); }
  header .t { font-weight: 600; } header .s { opacity: .7; font-size: 12px; }
  #log { flex: 1; overflow-y: auto; padding: 12px 14px; line-height: 1.55; }
  .q { background: var(--vscode-textBlockQuote-background); border-radius: 6px; padding: 6px 10px; margin: 14px 0 8px; }
  .a p { margin: 6px 0; } .a h4 { margin: 12px 0 4px; } .a ul { margin: 4px 0; padding-left: 20px; }
  code { font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); padding: 0 3px; border-radius: 3px; }
  pre { background: var(--vscode-textCodeBlock-background); padding: 8px 10px; border-radius: 6px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  a.cite, .src a { color: var(--vscode-textLink-foreground); text-decoration: none; font-family: var(--vscode-editor-font-family); font-size: 11px; }
  a.cite { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 3px; padding: 0 4px; }
  .muted { opacity: .7; font-size: 12px; } .err { color: var(--vscode-errorForeground); } .warn { color: var(--vscode-editorWarning-foreground); font-size: 12px; }
  details.src { margin: 8px 0 4px; font-size: 12px; } details.src li { list-style: none; margin: 2px 0; }
  form { display: flex; gap: 6px; padding: 10px 14px; border-top: 1px solid var(--vscode-panel-border); }
  textarea { flex: 1; resize: none; font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px; padding: 6px 8px; }
  button { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; border-radius: 4px; padding: 0 14px; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
</style>
</head>
<body>
<header><div class="t">${title}</div><div class="s">${subtitle}</div></header>
<div id="log"><p class="muted">Ask about architecture, flows, dependencies or change impact. Answers cite exact files and lines.</p></div>
<form id="form"><textarea id="q" rows="2" placeholder="Where is authentication handled?"></textarea><button id="send" type="submit">Ask</button></form>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const log = document.getElementById('log'), form = document.getElementById('form'), input = document.getElementById('q'), send = document.getElementById('send');
  let current = null, sources = [];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inline = (s) => s.replace(/\`([^\`]+)\`/g, '<code>$1</code>').replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>').replace(/\\[S(\\d+)\\]/g, '<a href="#" class="cite" data-n="$1">S$1</a>');
  function render(md) {
    const out = []; let inCode = false, code = [], list = false;
    for (const line of md.split('\\n')) {
      if (line.startsWith('\`\`\`')) { if (inCode) { out.push('<pre><code>' + esc(code.join('\\n')) + '</code></pre>'); code = []; } inCode = !inCode; continue; }
      if (inCode) { code.push(line); continue; }
      const li = line.match(/^\\s*(?:[-*]|\\d+\\.)\\s+(.*)/);
      if (li) { if (!list) { out.push('<ul>'); list = true; } out.push('<li>' + inline(esc(li[1])) + '</li>'); continue; }
      if (list) { out.push('</ul>'); list = false; }
      const h = line.match(/^#{1,4}\\s+(.*)/);
      if (h) out.push('<h4>' + inline(esc(h[1])) + '</h4>'); else if (line.trim()) out.push('<p>' + inline(esc(line)) + '</p>');
    }
    if (inCode) out.push('<pre><code>' + esc(code.join('\\n')) + '</code></pre>');
    if (list) out.push('</ul>');
    return out.join('');
  }
  const add = (cls, html) => { const el = document.createElement('div'); el.className = cls; el.innerHTML = html; log.append(el); return el; };
  form.addEventListener('submit', (e) => { e.preventDefault(); const q = input.value.trim(); if (!q || send.disabled) return; vscode.postMessage({ type: 'ask', question: q }); input.value = ''; });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  log.addEventListener('click', (e) => {
    const link = e.target.closest('[data-n]'); if (!link) return; e.preventDefault();
    const list = JSON.parse(link.closest('.a')?.dataset.sources || '[]'); const s = list[Number(link.dataset.n) - 1];
    if (s) vscode.postMessage({ type: 'open', source: s });
  });
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type === 'start') { add('q', esc(m.question)); current = add('a', '<p class="muted">Retrieving code…</p>'); current.dataset.md = ''; sources = []; send.disabled = true; }
    else if (m.type === 'meta') { sources = m.sources; current.dataset.sources = JSON.stringify(m.sources); current.innerHTML = '<p class="muted">' + esc(m.queryType) + ' query · ' + esc(m.evidence) + ' evidence · reasoning over ' + m.sources.length + ' code entities…</p>'; }
    else if (m.type === 'delta') { current.dataset.md += m.text; current.innerHTML = render(current.dataset.md); }
    else if (m.type === 'verification' && (m.unverifiedPaths.length || m.invalidCitations.length)) { add('warn', 'Grounding check: ' + esc([...m.unverifiedPaths, ...m.invalidCitations].join(', ')) + ' could not be verified.'); }
    else if (m.type === 'error') { add('err', esc(m.message)); }
    else if (m.type === 'end') {
      if (current && sources.length) {
        const items = sources.map((s) => '<li><a href="#" data-n="' + s.n + '">S' + s.n + ' ' + esc(s.route || s.symbol) + ' — ' + esc(s.file) + ':' + s.startLine + '-' + s.endLine + '</a></li>').join('');
        current.insertAdjacentHTML('beforeend', '<details class="src"><summary>Sources · ' + sources.length + '</summary><ul>' + items + '</ul></details>');
      }
      send.disabled = false; input.focus();
    }
    log.scrollTop = log.scrollHeight;
  });
</script>
</body>
</html>`;
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
