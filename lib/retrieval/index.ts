import { query, toVector } from "@/lib/db";
import { embedQuery } from "@/lib/embeddings";

export interface Entity {
  id: number;
  file_path: string;
  symbol_name: string;
  symbol_type: string;
  language: string;
  start_line: number;
  end_line: number;
  content: string;
  module: string;
  parent: string | null;
  route: string | null;
  exported: boolean;
  imports?: string[];
}

export interface Retrieved extends Entity {
  score: number;
  reasons: string[];
  similarity?: number;
}

export const ENTITY_COLUMNS =
  "id, file_path, symbol_name, symbol_type, language, start_line, end_line, content, module, parent, route, exported";

/* ------------------------------ Query understanding ------------------------------ */

export type QueryType =
  | "location" | "flow" | "dependency" | "impact" | "implementation"
  | "debugging" | "architecture" | "routes" | "general";

export function classifyQuery(q: string): QueryType {
  const s = q.toLowerCase();
  if (/\b(affect(ed|s)?|impact(ed)?|break(s)?|rename|renaming|if i (change|modify|delete|remove|refactor))\b/.test(s)) return "impact";
  if (/\b(depends? on|dependenc(y|ies)|used by|who calls|callers?|what calls|usages?|uses of)\b/.test(s)) return "dependency";
  if (/\b(all|list|show|what)\b.*\b(routes?|endpoints?|apis?)\b/.test(s)) return "routes";
  if (/\b(architecture|structure|overview|organi[sz]ed|high[- ]level|important modules|main modules|understand first|new developer|onboard|tech stack)\b/.test(s)) return "architecture";
  if (/\b(error|bug|fail(s|ing|ure)?|exception|crash|40\d|50\d|why (does|is|could|would|am|do))\b/.test(s)) return "debugging";
  if (/\b(how (should|can|would|do) i|add(ing)? (a|an|new|support)|implement|extend|integrate)\b/.test(s)) return "implementation";
  if (/\b(flow|how does|how do|what happens|lifecycle|walk me through|works?)\b/.test(s)) return "flow";
  if (/\b(where|which files?|find|locate|defined|handled|created|initiali[sz]ed)\b/.test(s)) return "location";
  return "general";
}

const STOP = new Set(
  ("a an the is are was were be been being of to in on for and or with by from at as it this that these those what which who whom " +
    "where when why how do does did can could should would will i we you me my our your there their them they its into about show tell " +
    "explain give list all any some file files code codebase repo repository function functions method methods class classes handled " +
    "happens happen work works used using get gets make need want if change changed changing affected affect would")
    .split(" "),
);

function keywordTerms(question: string): string[] {
  const raw = question.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  const terms = new Set<string>();
  for (const tok of raw) {
    const parts = [tok, ...tok.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[\s_]+/)];
    for (const p of parts) {
      const w = p.toLowerCase();
      if (w.length >= 2 && !STOP.has(w)) terms.add(w);
    }
  }
  return [...terms].slice(0, 16);
}

// Tokens that look like code identifiers: camelCase, PascalCase, snake_case, `backticked`, or foo().
function codeIdentifiers(question: string): string[] {
  const ids = new Set<string>();
  for (const m of question.matchAll(/`([^`]+)`/g)) ids.add(m[1].replace(/\(\)$/, "").split(".").pop()!);
  for (const m of question.matchAll(/\b([A-Za-z_][\w]*)\(\)/g)) ids.add(m[1]);
  for (const m of question.matchAll(/\b([a-z]+[A-Z]\w*|[A-Z][a-z0-9]+[A-Z]\w*|[a-z]+_[a-z_0-9]+)\b/g)) ids.add(m[1]);
  return [...ids];
}

/* -------------------------------- Hybrid retrieval -------------------------------- */

export async function hybridSearch(repoId: string, question: string, type: QueryType, limit = 10): Promise<Retrieved[]> {
  const terms = keywordTerms(question);
  const identifiers = codeIdentifiers(question);
  const symbolCandidates = [...new Set([...identifiers, ...terms.filter((t) => t.length >= 4)].map((s) => s.toLowerCase()))];
  const vec = toVector(await embedQuery(question));
  const K = 40;

  const vectorHits = await query<{ id: number; sim: number }>(
    `SELECT id, 1 - (embedding <=> $2::vector) AS sim FROM code_entities WHERE repository_id = $1 ORDER BY embedding <=> $2::vector LIMIT ${K}`,
    [repoId, vec],
  );
  const textHits = terms.length
    ? await query<{ id: number }>(
        `SELECT id FROM code_entities, to_tsquery('english', $2) q WHERE repository_id = $1 AND search @@ q ORDER BY ts_rank_cd(search, q) DESC LIMIT ${K}`,
        [repoId, terms.map((t) => t.replace(/[^a-z0-9]/g, "")).filter(Boolean).join(" | ")],
      )
    : [];
  const symbolHits = symbolCandidates.length
    ? await query<{ id: number; n: string }>(
        `SELECT id, lower(symbol_name) AS n FROM code_entities WHERE repository_id = $1 AND lower(symbol_name) = ANY($2::text[]) LIMIT 30`,
        [repoId, symbolCandidates],
      )
    : [];

  // Reciprocal Rank Fusion
  const fused = new Map<number, { score: number; reasons: Set<string>; sim?: number }>();
  const add = (id: number, s: number, reason: string) => {
    const cur = fused.get(id) ?? { score: 0, reasons: new Set<string>() };
    cur.score += s;
    cur.reasons.add(reason);
    fused.set(id, cur);
  };
  vectorHits.forEach((h, i) => { add(h.id, 1 / (60 + i), "semantic"); fused.get(h.id)!.sim = h.sim; });
  textHits.forEach((h, i) => add(h.id, 0.8 / (60 + i), "keyword"));
  const identLower = new Set(identifiers.map((s) => s.toLowerCase()));
  symbolHits.forEach((h) => add(h.id, identLower.has(h.n) ? 3 / 60 : 1.2 / 60, "symbol"));

  const topIds = [...fused].sort((a, b) => b[1].score - a[1].score).slice(0, 30).map(([id]) => id);
  if (!topIds.length) return [];
  const rows = await query<Entity>(`SELECT ${ENTITY_COLUMNS} FROM code_entities WHERE id = ANY($1::int[])`, [topIds]);

  // Metadata filtering: prefer code for code questions, docs/config for architecture,
  // and application code over tests / generated clients unless the question is about them.
  const aboutTests = /\b(tests?|spec|testing|coverage)\b/i.test(question);
  const results: Retrieved[] = rows.map((r) => {
    const f = fused.get(r.id)!;
    let score = f.score;
    if (!aboutTests && /(^|\/)(tests?|__tests__|e2e|spec)\/|\.(test|spec)\.\w+$|(^|\/)test_[^/]*$|_test\.\w+$/.test(r.file_path)) score *= 0.5;
    if (/\.gen\.\w+$|(^|\/)generated\/|\.pb\.\w+$/.test(r.file_path)) score *= 0.5;
    if (type !== "architecture" && (r.symbol_type === "doc" || r.symbol_type === "config")) score *= 0.6;
    if (type === "architecture" && (r.symbol_type === "doc" || r.symbol_type === "module")) score *= 1.3;
    if (type === "routes" && r.route) score *= 1.5;
    if (r.symbol_type === "chunk") score *= 0.8;
    return { ...r, score, reasons: [...f.reasons], similarity: f.sim };
  });
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

/* --------------------------- Dependency relationships ---------------------------- */

export interface Neighbor extends Entity {
  relationship_type: string;
  direction: "out" | "in";
  anchor: number;
}

export async function neighbors(ids: number[]): Promise<Neighbor[]> {
  if (!ids.length) return [];
  return query<Neighbor>(
    `SELECT ${ENTITY_COLUMNS.split(", ").map((c) => `e.${c}`).join(", ")}, r.relationship_type,
       CASE WHEN r.source_entity_id = ANY($1::int[]) THEN 'out' ELSE 'in' END AS direction,
       CASE WHEN r.source_entity_id = ANY($1::int[]) THEN r.source_entity_id ELSE r.target_entity_id END AS anchor
     FROM relationships r
     JOIN code_entities e ON e.id = CASE WHEN r.source_entity_id = ANY($1::int[]) THEN r.target_entity_id ELSE r.source_entity_id END
     WHERE r.source_entity_id = ANY($1::int[]) OR r.target_entity_id = ANY($1::int[])
     LIMIT 400`,
    [ids],
  );
}

export async function getEntity(repoId: string, entityId: number) {
  const [e] = await query<Entity>(
    `SELECT ${ENTITY_COLUMNS}, imports FROM code_entities WHERE repository_id = $1 AND id = $2`,
    [repoId, entityId],
  );
  return e ?? null;
}

export async function entityDependencies(repoId: string, entityId: number) {
  const entity = await getEntity(repoId, entityId);
  if (!entity) return null;
  const n = await neighbors([entityId]);
  const slim = (x: Neighbor) => ({
    id: x.id, symbol_name: x.symbol_name, symbol_type: x.symbol_type, file_path: x.file_path,
    start_line: x.start_line, end_line: x.end_line, relationship_type: x.relationship_type,
  });
  const [fileImports, importedBy] = await Promise.all([
    query<{ file: string }>("SELECT target_file AS file FROM file_imports WHERE repository_id = $1 AND source_file = $2", [repoId, entity.file_path]),
    query<{ file: string }>("SELECT source_file AS file FROM file_imports WHERE repository_id = $1 AND target_file = $2", [repoId, entity.file_path]),
  ]);
  return {
    entity,
    dependsOn: n.filter((x) => x.direction === "out").map(slim),
    usedBy: n.filter((x) => x.direction === "in").map(slim),
    externalImports: (entity.imports ?? []).filter((i) => !i.startsWith(".")),
    fileImports: fileImports.map((f) => f.file),
    importedBy: importedBy.map((f) => f.file),
  };
}

/* ------------------------------ Change impact analysis ------------------------------ */

export type Severity = "HIGH" | "MEDIUM" | "LOW";

export async function impactAnalysis(repoId: string, entityId: number) {
  const target = await getEntity(repoId, entityId);
  if (!target) return null;

  // A class's impact includes everything that touches its methods.
  const seeds = [entityId];
  if (["class", "model", "interface"].includes(target.symbol_type)) {
    const methods = await query<{ id: number }>(
      "SELECT id FROM code_entities WHERE repository_id = $1 AND file_path = $2 AND parent = $3",
      [repoId, target.file_path, target.symbol_name],
    );
    seeds.push(...methods.map((m) => m.id));
  }

  const visited = new Map<number, { depth: number; via: number; relationship: string }>();
  seeds.forEach((id) => visited.set(id, { depth: 0, via: id, relationship: "self" }));
  let frontier = seeds;
  for (let depth = 1; depth <= 3 && frontier.length; depth++) {
    const incoming = await query<{ id: number; via: number; relationship_type: string }>(
      `SELECT source_entity_id AS id, target_entity_id AS via, relationship_type FROM relationships
       WHERE repository_id = $1 AND target_entity_id = ANY($2::int[])`,
      [repoId, frontier],
    );
    const next: number[] = [];
    for (const r of incoming) {
      if (visited.has(r.id)) continue;
      visited.set(r.id, { depth, via: r.via, relationship: r.relationship_type });
      next.push(r.id);
    }
    frontier = next.slice(0, 60);
  }

  const impactedIds = [...visited].filter(([, v]) => v.depth > 0).map(([id]) => id);
  const allIds = [...new Set([...impactedIds, ...[...visited.values()].map((v) => v.via)])];
  const rows = allIds.length
    ? await query<Entity>(`SELECT ${ENTITY_COLUMNS} FROM code_entities WHERE id = ANY($1::int[])`, [allIds])
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const severity = (d: number): Severity => (d === 1 ? "HIGH" : d === 2 ? "MEDIUM" : "LOW");

  const impacted = impactedIds
    .map((id) => {
      const v = visited.get(id)!;
      const e = byId.get(id);
      const via = byId.get(v.via) ?? (v.via === entityId ? target : undefined);
      if (!e) return null;
      return {
        entity: e,
        depth: v.depth,
        severity: severity(v.depth),
        relationship: v.relationship,
        via: via ? { id: via.id, symbol_name: via.symbol_name, file_path: via.file_path } : null,
        reason: v.depth === 1
          ? `${v.relationship === "handles" ? "is a route handled by" : "directly calls"} ${via?.symbol_name ?? target.symbol_name}()`
          : `calls ${via?.symbol_name}(), which depends on ${target.symbol_name}`,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.depth - b.depth);

  const importers = await query<{ file: string }>(
    "SELECT source_file AS file FROM file_imports WHERE repository_id = $1 AND target_file = $2",
    [repoId, target.file_path],
  );
  const impactedFiles = new Set(impacted.map((i) => i.entity.file_path));
  return {
    target,
    impacted,
    importingFiles: importers.map((i) => i.file).filter((f) => !impactedFiles.has(f)),
    summary: {
      high: impacted.filter((i) => i.severity === "HIGH").length,
      medium: impacted.filter((i) => i.severity === "MEDIUM").length,
      low: impacted.filter((i) => i.severity === "LOW").length,
      files: new Set([...impactedFiles, ...importers.map((i) => i.file)]).size,
    },
  };
}

// Pick the entity a dependency/impact question is about.
export async function resolveTarget(repoId: string, question: string, retrieved: Retrieved[]) {
  const ids = codeIdentifiers(question).map((s) => s.toLowerCase());
  const words = keywordTerms(question).filter((w) => w.length >= 4);
  for (const candidates of [ids, words]) {
    if (!candidates.length) continue;
    const [hit] = await query<{ id: number }>(
      `SELECT id FROM code_entities WHERE repository_id = $1 AND lower(symbol_name) = ANY($2::text[])
         AND symbol_type IN ('function', 'method', 'class', 'component', 'model', 'interface')
       ORDER BY array_position($2::text[], lower(symbol_name)), (SELECT count(*) FROM relationships r WHERE r.target_entity_id = code_entities.id) DESC
       LIMIT 1`,
      [repoId, candidates],
    );
    if (hit) return hit.id;
  }
  return retrieved.find((r) => ["function", "method", "class", "component", "model"].includes(r.symbol_type))?.id ?? null;
}

/* ------------------------------- Architecture graph ------------------------------- */

const NON_CODE = "('Markdown','JSON','YAML','TOML','XML','Text','Docker','Make','Gradle','HTML','CSS')";

export async function moduleGraph(repoId: string) {
  const modules = await query<{ module: string; files: number; lines: number; languages: string[] }>(
    `SELECT module, count(*)::int AS files, sum(line_count)::int AS lines, array_agg(DISTINCT language) AS languages
     FROM files WHERE repository_id = $1 AND language NOT IN ${NON_CODE} GROUP BY module ORDER BY lines DESC LIMIT 60`,
    [repoId],
  );
  const counts = await query<{ module: string; functions: number; classes: number; routes: number }>(
    `SELECT module,
       count(*) FILTER (WHERE symbol_type IN ('function','method','component'))::int AS functions,
       count(*) FILTER (WHERE symbol_type IN ('class','model','interface'))::int AS classes,
       count(*) FILTER (WHERE route IS NOT NULL)::int AS routes
     FROM code_entities WHERE repository_id = $1 GROUP BY module`,
    [repoId],
  );
  const edges = await query<{ source: string; target: string; weight: number }>(
    `SELECT source, target, sum(weight)::int AS weight FROM (
       SELECT fs.module AS source, ft.module AS target, count(*) AS weight
       FROM file_imports i
       JOIN files fs ON fs.repository_id = i.repository_id AND fs.path = i.source_file
       JOIN files ft ON ft.repository_id = i.repository_id AND ft.path = i.target_file
       WHERE i.repository_id = $1 AND fs.module <> ft.module GROUP BY 1, 2
       UNION ALL
       SELECT s.module, t.module, count(*)
       FROM relationships r
       JOIN code_entities s ON s.id = r.source_entity_id
       JOIN code_entities t ON t.id = r.target_entity_id
       WHERE r.repository_id = $1 AND s.module <> t.module GROUP BY 1, 2
     ) x GROUP BY source, target`,
    [repoId],
  );
  const c = new Map(counts.map((x) => [x.module, x]));
  const names = new Set(modules.map((m) => m.module));
  return {
    nodes: modules.map((m) => ({ id: m.module, ...m, functions: c.get(m.module)?.functions ?? 0, classes: c.get(m.module)?.classes ?? 0, routes: c.get(m.module)?.routes ?? 0 })),
    edges: edges.filter((e) => names.has(e.source) && names.has(e.target)),
  };
}

export async function fileGraph(repoId: string, module: string) {
  const files = await query<{ path: string; lines: number; language: string; module: string }>(
    `SELECT path, line_count AS lines, language, module FROM files WHERE repository_id = $1 AND module = $2 AND language NOT IN ${NON_CODE} LIMIT 150`,
    [repoId, module],
  );
  const paths = files.map((f) => f.path);
  const edges = await query<{ source: string; target: string; weight: number }>(
    `SELECT source, target, sum(weight)::int AS weight FROM (
       SELECT source_file AS source, target_file AS target, 1 AS weight FROM file_imports
       WHERE repository_id = $1 AND (source_file = ANY($2::text[]) OR target_file = ANY($2::text[]))
       UNION ALL
       SELECT s.file_path, t.file_path, 1 FROM relationships r
       JOIN code_entities s ON s.id = r.source_entity_id JOIN code_entities t ON t.id = r.target_entity_id
       WHERE r.repository_id = $1 AND s.file_path <> t.file_path AND (s.file_path = ANY($2::text[]) OR t.file_path = ANY($2::text[]))
     ) x GROUP BY source, target LIMIT 600`,
    [repoId, paths],
  );
  // Neighboring files from other modules appear as external nodes.
  const inModule = new Set(paths);
  const external = [...new Set(edges.flatMap((e) => [e.source, e.target]).filter((p) => !inModule.has(p)))].slice(0, 40);
  const ext = external.length
    ? await query<{ path: string; lines: number; language: string; module: string }>(
        `SELECT path, line_count AS lines, language, module FROM files WHERE repository_id = $1 AND path = ANY($2::text[])`,
        [repoId, external],
      )
    : [];
  const all = new Set([...paths, ...ext.map((e) => e.path)]);
  return {
    nodes: [...files.map((f) => ({ id: f.path, ...f, external: false })), ...ext.map((f) => ({ id: f.path, ...f, external: true }))],
    edges: edges.filter((e) => all.has(e.source) && all.has(e.target)),
  };
}
