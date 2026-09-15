import path from "node:path";

// Turns raw import specifiers and callee names into file→file and entity→entity edges.

const JS_EXTS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];
const AMBIGUOUS = "\0";

function suffixIndex(paths: string[], ext: RegExp) {
  const idx = new Map<string, string>();
  for (const p of paths) {
    if (!ext.test(p)) continue;
    const segs = p.replace(ext, "").replace(/\/__init__$/, "").split("/");
    for (let k = 1; k <= segs.length; k++) {
      if (k === 1 && segs.length > 1) continue; // single bare names are too ambiguous
      const key = segs.slice(-k).join("/");
      idx.set(key, idx.has(key) && idx.get(key) !== p ? AMBIGUOUS : p);
    }
  }
  return idx;
}

export function resolveImports(filePaths: string[], importsByFile: Map<string, string[]>): Map<string, Set<string>> {
  const files = new Set(filePaths);
  const pyIdx = suffixIndex(filePaths, /\.py$/);
  const javaIdx = suffixIndex(filePaths, /\.java$/);
  const goDirs = new Map<string, string[]>();
  for (const p of filePaths) {
    if (!p.endsWith(".go") || p.endsWith("_test.go")) continue;
    const d = path.posix.dirname(p);
    goDirs.set(d, [...(goDirs.get(d) ?? []), p]);
  }

  const tryJs = (base: string) => {
    const stripped = base.replace(/\.(js|jsx|mjs|cjs)$/, "");
    for (const b of [base, stripped]) for (const e of JS_EXTS) if (files.has(b + e)) return b + e;
    return null;
  };

  const result = new Map<string, Set<string>>();
  for (const [from, specs] of importsByFile) {
    const targets = new Set<string>();
    const dir = path.posix.dirname(from);
    for (const spec of specs) {
      if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(from)) {
        let hit: string | null = null;
        if (spec.startsWith(".")) hit = tryJs(path.posix.normalize(path.posix.join(dir, spec)));
        else if (/^[@~]\//.test(spec)) hit = tryJs(spec.slice(2)) ?? tryJs(`src/${spec.slice(2)}`);
        else if (!spec.startsWith("@")) hit = tryJs(spec) ?? tryJs(`src/${spec}`);
        if (hit) targets.add(hit);
      } else if (from.endsWith(".py")) {
        let key: string;
        if (spec.startsWith(".")) {
          const level = spec.match(/^\.+/)![0].length;
          let base = dir;
          for (let i = 1; i < level; i++) base = path.posix.dirname(base);
          key = path.posix.join(base, spec.slice(level).replace(/\./g, "/"));
        } else {
          key = spec.replace(/\./g, "/");
        }
        key = key.replace(/^\.\//, "");
        const direct = files.has(`${key}.py`) ? `${key}.py` : files.has(`${key}/__init__.py`) ? `${key}/__init__.py` : null;
        const hit = direct ?? pyIdx.get(key);
        if (hit && hit !== AMBIGUOUS) targets.add(hit);
      } else if (from.endsWith(".java")) {
        const hit = javaIdx.get(spec.replace(/\.\*$/, "").replace(/\./g, "/"));
        if (hit && hit !== AMBIGUOUS) targets.add(hit);
      } else if (from.endsWith(".go")) {
        for (const [d, list] of goDirs) {
          if (spec === d || spec.endsWith(`/${d}`)) {
            for (const f of list.slice(0, 15)) targets.add(f);
            break;
          }
        }
      }
    }
    targets.delete(from);
    if (targets.size) result.set(from, targets);
  }
  return result;
}

export interface GraphEntity {
  id: number;
  file: string;
  name: string;
  type: string;
  calls: string[];
  handler?: string;
}

const LINKABLE = new Set(["function", "method", "component", "class", "model"]);

export function resolveCalls(entities: GraphEntity[], fileImports: Map<string, Set<string>>) {
  const byName = new Map<string, GraphEntity[]>();
  for (const e of entities) {
    if (!LINKABLE.has(e.type)) continue;
    byName.set(e.name, [...(byName.get(e.name) ?? []), e]);
  }

  const edges: { source: number; target: number; type: string }[] = [];
  const seen = new Set<string>();
  const link = (e: GraphEntity, name: string, type: string) => {
    const cands = (byName.get(name) ?? []).filter((c) => c.id !== e.id);
    if (!cands.length) return;
    const same = cands.filter((c) => c.file === e.file);
    const imported = cands.filter((c) => fileImports.get(e.file)?.has(c.file));
    const pick = same.length ? same : imported.length ? imported : cands.length <= 2 ? cands : [];
    for (const t of pick.slice(0, 3)) {
      const k = `${e.id}:${t.id}:${type}`;
      if (seen.has(k)) continue;
      seen.add(k);
      edges.push({ source: e.id, target: t.id, type });
    }
  };

  for (const e of entities) {
    for (const name of e.calls) link(e, name, "calls");
    if (e.handler) link(e, e.handler, "handles");
  }
  return edges;
}
