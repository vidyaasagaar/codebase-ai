import { query } from "@/lib/db";
import { streamChat, llmConfigured, type ChatMessage } from "@/lib/ai/llm";
import {
  classifyQuery, hybridSearch, neighbors, impactAnalysis, resolveTarget, getEntity,
  ENTITY_COLUMNS, type Entity, type QueryType,
} from "@/lib/retrieval";

export interface Source {
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

export type AnswerEvent =
  | { type: "meta"; queryType: QueryType; sources: Source[]; evidence: "strong" | "moderate" | "weak"; targetId: number | null }
  | { type: "delta"; text: string }
  | { type: "verification"; unverifiedPaths: string[]; invalidCitations: string[] }
  | { type: "error"; message: string };

const SYSTEM_PROMPT = `You are Codebase AI, a senior engineer explaining an unfamiliar repository to a developer.
You receive numbered evidence blocks [S1], [S2], ... retrieved from the indexed repository: functions, classes, routes, config and docs, each with its file path and line range, plus dependency information.

Rules:
1. Ground every claim about this repository in the evidence and cite it inline as [S#] right after the claim.
2. Never invent file paths, symbols, routes or behavior. Only mention files and symbols that appear in the evidence.
3. If the evidence is insufficient to answer part of the question, say so explicitly ("I could not find ... in the indexed code").
4. Separate what the code shows from what you infer: use "likely" / "appears to" for inferences.
5. Write for developers: a one-to-two sentence direct answer first, then short sections with bold headings as useful (e.g. **Key locations**, **Request flow**, **How it works**, **Impact**, **Notes**). Put flows in a code block using → arrows. Refer to symbols as \`name()\` and locations as \`path:start-end\`.
6. Be concise. No filler, no generic advice unrelated to the evidence.`;

function numbered(content: string, start: number, maxLines: number) {
  const lines = content.split("\n");
  const shown = lines.slice(0, maxLines).map((l, i) => (/^\d+: /.test(l) ? l : `${start + i}: ${l}`));
  if (lines.length > maxLines) shown.push(`... (${lines.length - maxLines} more lines)`);
  return shown.join("\n");
}

export async function* answerQuestion(
  repoId: string,
  question: string,
  opts: { focusEntityId?: number; history?: ChatMessage[] } = {},
): AsyncGenerator<AnswerEvent> {
  const [repo] = await query<{ name: string; stats: Record<string, unknown> }>("SELECT name, stats FROM repositories WHERE id = $1", [repoId]);
  const queryType = classifyQuery(question);
  const budget = Number(process.env.MAX_CONTEXT_CHARS) || 24000;

  const focus = opts.focusEntityId ? await getEntity(repoId, opts.focusEntityId) : null;
  const searchText = focus ? `${question} ${focus.symbol_name}` : question;
  const retrieved = await hybridSearch(repoId, searchText, queryType, queryType === "architecture" ? 14 : 10);

  const picked: { e: Entity; reason: string; maxLines: number }[] = [];
  const has = (id: number) => picked.some((p) => p.e.id === id);
  const push = (e: Entity, reason: string, maxLines: number) => { if (!has(e.id)) picked.push({ e, reason, maxLines }); };
  const extraSections: string[] = [];
  let targetId: number | null = null;

  if (queryType === "impact" || queryType === "dependency") {
    targetId = focus?.id ?? (await resolveTarget(repoId, question, retrieved));
    const impact = targetId ? await impactAnalysis(repoId, targetId) : null;
    if (impact) {
      push(impact.target, "target of the question", 80);
      const deps = await neighbors([impact.target.id]);
      for (const d of deps.filter((d) => d.direction === "out").slice(0, 5)) push(d, `${impact.target.symbol_name} depends on this`, 25);
      for (const i of impact.impacted.slice(0, 14)) push(i.entity, `impact ${i.severity}: ${i.reason}`, i.depth === 1 ? 40 : 20);
      const ref = (id: number) => `[S${picked.findIndex((p) => p.e.id === id) + 1}]`;
      extraSections.push(
        `Change impact analysis for ${impact.target.symbol_name} (${impact.target.file_path}), computed by traversing the call graph:\n` +
          (impact.impacted.length
            ? impact.impacted.slice(0, 30).map((i) =>
                `- ${i.severity}: ${i.entity.symbol_name} (${i.entity.file_path}:${i.entity.start_line}) ${i.reason}${has(i.entity.id) ? ` ${ref(i.entity.id)}` : ""}`).join("\n")
            : "- No callers found in the indexed call graph.") +
          (impact.importingFiles.length ? `\nFiles importing ${impact.target.file_path}: ${impact.importingFiles.slice(0, 15).join(", ")}` : "") +
          `\nDepends on: ${deps.filter((d) => d.direction === "out").map((d) => d.symbol_name).slice(0, 15).join(", ") || "nothing resolved"}`,
      );
    }
  }

  if (queryType === "routes") {
    const routes = await query<Entity>(
      `SELECT ${ENTITY_COLUMNS} FROM code_entities WHERE repository_id = $1 AND route IS NOT NULL ORDER BY file_path, start_line LIMIT 40`,
      [repoId],
    );
    for (const r of routes) push(r, "API route", 8);
  }

  if (queryType === "architecture") {
    const s = repo?.stats as Record<string, unknown> & { largestModules?: { module: string; files: number }[]; mostConnectedModules?: { module: string; connections: number }[] };
    extraSections.push(
      `Repository overview (computed during indexing):\n` +
        `Languages: ${JSON.stringify(s?.languages)}\nFrameworks: ${JSON.stringify(s?.frameworks)}\nEntry points: ${JSON.stringify(s?.entryPoints)}\n` +
        `Largest modules: ${s?.largestModules?.map((m) => `${m.module} (${m.files} files)`).join(", ")}\n` +
        `Most connected modules: ${s?.mostConnectedModules?.map((m) => `${m.module} (${m.connections} links)`).join(", ")}`,
    );
  }

  if (focus) push(focus, "entity selected by the user", 80);
  for (const r of retrieved) push(r, `matched by ${r.reasons.join(" + ")}`, 70);

  // Expand top hits with their direct dependencies (callers / callees).
  if (queryType !== "routes") {
    const anchorIds = retrieved.slice(0, 5).map((r) => r.id);
    const rel = await neighbors(anchorIds);
    const counts = new Map<number, { e: (typeof rel)[number]; n: number }>();
    for (const r of rel) {
      if (has(r.id) || ["doc", "config"].includes(r.symbol_type)) continue;
      const cur = counts.get(r.id) ?? { e: r, n: 0 };
      cur.n++;
      counts.set(r.id, cur);
    }
    const maxRelated = queryType === "flow" ? 8 : 5;
    const nameOf = (id: number) => picked.find((p) => p.e.id === id)?.e.symbol_name;
    [...counts.values()].sort((a, b) => b.n - a.n).slice(0, maxRelated).forEach(({ e }) =>
      push(e, e.direction === "out" ? `called by ${nameOf(e.anchor)}` : `calls ${nameOf(e.anchor)}`, 30),
    );
  }

  // Build context within budget.
  let used = extraSections.join("\n").length;
  const blocks: string[] = [];
  const sources: Source[] = [];
  for (const p of picked) {
    const e = p.e;
    const header = `[S${sources.length + 1}] ${e.symbol_type} ${e.parent ? `${e.parent}.` : ""}${e.symbol_name}${e.route ? ` (route ${e.route})` : ""} — ${e.file_path}:${e.start_line}-${e.end_line} (module: ${e.module}; ${p.reason})`;
    const body = numbered(e.content, e.start_line, p.maxLines);
    const block = `${header}\n\`\`\`\n${body}\n\`\`\``;
    if (used + block.length > budget && sources.length >= 3) break;
    used += block.length;
    blocks.push(block);
    sources.push({ n: sources.length + 1, id: e.id, file: e.file_path, symbol: e.symbol_name, type: e.symbol_type, startLine: e.start_line, endLine: e.end_line, route: e.route, reason: p.reason });
  }

  const top = retrieved[0];
  const evidence: "strong" | "moderate" | "weak" =
    targetId || (top && top.reasons.length >= 2 && (top.similarity ?? 0) >= 0.6) || retrieved.some((r) => r.reasons.includes("symbol")) ? "strong"
    : (top?.similarity ?? 0) >= 0.55 ? "moderate" : "weak";

  yield { type: "meta", queryType, sources, evidence, targetId };

  if (!llmConfigured()) {
    yield {
      type: "delta",
      text: `**LLM not configured** — set \`LLM_BASE_URL\`, \`LLM_API_KEY\` and \`LLM_MODEL\` in \`.env.local\` and restart.\n\nRetrieved evidence for this question:\n\n` +
        sources.map((s) => `- [S${s.n}] \`${s.symbol}\` — \`${s.file}:${s.startLine}-${s.endLine}\``).join("\n"),
    };
    return;
  }

  const stats = repo?.stats as { frameworks?: string[]; languages?: { name: string }[] } | undefined;
  const userPrompt =
    `Repository: ${repo?.name} (languages: ${stats?.languages?.map((l) => l.name).join(", ") ?? "unknown"}; frameworks: ${stats?.frameworks?.join(", ") || "none detected"})\n` +
    `Question type: ${queryType}\n` +
    (focus ? `The user is asking about: ${focus.symbol_name} in ${focus.file_path}:${focus.start_line}-${focus.end_line}\n` : "") +
    (extraSections.length ? `\n${extraSections.join("\n\n")}\n` : "") +
    `\nEvidence:\n\n${blocks.join("\n\n")}\n\nQuestion: ${question}`;

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...(opts.history ?? []).slice(-6).map((m) => ({ role: m.role, content: m.content.slice(0, 2000) })),
    { role: "user", content: userPrompt },
  ];

  let answer = "";
  try {
    for await (const delta of streamChat(messages)) {
      answer += delta;
      yield { type: "delta", text: delta };
    }
  } catch (err) {
    yield { type: "error", message: err instanceof Error ? err.message : String(err) };
    return;
  }

  yield { type: "verification", ...(await verifyAnswer(repoId, answer, sources.length)) };
}

// Hallucination guard: flag file paths that do not exist in the repository and citations to missing sources.
async function verifyAnswer(repoId: string, answer: string, sourceCount: number) {
  const paths = [...new Set(answer.match(/[\w@~-]+(?:\/[\w@.~-]+)*\.(?:tsx?|jsx?|mjs|cjs|py|java|go|json|md|ya?ml|toml|sql|prisma|rb|php|rs|cs|kt|vue|svelte|gradle|xml|html|css)\b/g) ?? [])];
  const unverifiedPaths: string[] = [];
  for (const p of paths.slice(0, 40)) {
    // Bare names like `res.json` or `config.py` are ambiguous with member access — only verify real paths.
    if (!p.includes("/")) continue;
    const [hit] = await query("SELECT 1 FROM files WHERE repository_id = $1 AND (path = $2 OR path LIKE '%/' || $2) LIMIT 1", [repoId, p]);
    if (!hit) unverifiedPaths.push(p);
  }
  const invalidCitations = [...new Set([...answer.matchAll(/\[S(\d+)\]/g)].map((m) => Number(m[1])).filter((n) => n < 1 || n > sourceCount))].map((n) => `S${n}`);
  return { unverifiedPaths, invalidCitations };
}
