import path from "node:path";
import { createRequire } from "node:module";
import type Parser from "web-tree-sitter";

// AST-based extraction of semantic code entities using Tree-sitter (WASM grammars).
// Each supported language maps its node types onto a small common model.

export type EntityType =
  | "function" | "method" | "class" | "interface" | "type" | "enum"
  | "component" | "model" | "route" | "module" | "config" | "doc" | "chunk";

export interface ParsedEntity {
  name: string;
  type: EntityType;
  startLine: number; // 1-based, inclusive
  endLine: number;
  content: string;
  parent?: string;
  exported: boolean;
  route?: string;    // e.g. "GET /users/:id"
  calls: string[];   // callee identifiers (resolved to entities later)
  handler?: string;  // for route registrations: the handler identifier
}

export interface ParsedFile {
  entities: ParsedEntity[];
  imports: string[];
}

export type Lang = "typescript" | "tsx" | "javascript" | "python" | "java" | "go";

const EXT_LANG: Record<string, Lang> = {
  ".ts": "typescript", ".mts": "typescript", ".cts": "typescript", ".tsx": "tsx",
  ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".py": "python", ".java": "java", ".go": "go",
};

export function astLanguage(filePath: string): Lang | null {
  return EXT_LANG[path.extname(filePath).toLowerCase()] ?? null;
}

type SN = Parser.SyntaxNode;

// The initialized Parser class is cached together with its grammars: Language objects
// only work with the exact Parser instance that loaded them (matters across dev hot reloads).
type TreeSitter = { P: typeof Parser; langs: Record<Lang, Parser.Language> };
type G = typeof globalThis & { __treeSitter?: Promise<TreeSitter> };

function loadTreeSitter() {
  const g = globalThis as G;
  if (!g.__treeSitter) {
    g.__treeSitter = (async () => {
      // Plain Node require: bundler ESM interop mangles this CommonJS package's default export.
      const P = createRequire(path.join(process.cwd(), "package.json"))("web-tree-sitter") as typeof Parser;
      const nm = path.join(process.cwd(), "node_modules");
      await P.init({ locateFile: () => path.join(nm, "web-tree-sitter", "tree-sitter.wasm") });
      const load = (n: string) => P.Language.load(path.join(nm, "tree-sitter-wasms", "out", `tree-sitter-${n}.wasm`));
      const [typescript, tsx, javascript, python, java, go] = await Promise.all(
        ["typescript", "tsx", "javascript", "python", "java", "go"].map(load),
      );
      return { P, langs: { typescript, tsx, javascript, python, java, go } };
    })().catch((err) => {
      g.__treeSitter = undefined; // don't cache a failed initialization
      throw err;
    });
  }
  return g.__treeSitter;
}

const MAX_ENTITY_LINES = 400;
const MAX_CLASS_LINES = 150;
const HTTP_VERBS = ["get", "post", "put", "patch", "delete", "all", "options", "head"];

const line = (n: SN) => n.startPosition.row + 1;
const endLine = (n: SN) => n.endPosition.row + 1;

function clip(src: string[], start: number, end: number, max: number) {
  return src.slice(start - 1, Math.min(end, start - 1 + max)).join("\n");
}

function unquote(s: string) {
  return s.replace(/^[`'"]+|[`'"]+$/g, "");
}

function collectCalls(node: SN, lang: Lang): string[] {
  const out = new Set<string>();
  const types =
    lang === "python" ? ["call"] :
    lang === "java" ? ["method_invocation", "object_creation_expression"] :
    lang === "go" ? ["call_expression"] :
    ["call_expression", "new_expression"];
  for (const c of node.descendantsOfType(types)) {
    let name: string | undefined;
    if (lang === "java") {
      name = c.type === "method_invocation"
        ? c.childForFieldName("name")?.text
        : c.childForFieldName("type")?.text;
    } else {
      const fn = c.childForFieldName(c.type === "new_expression" ? "constructor" : "function");
      if (!fn) continue;
      if (fn.type === "identifier") name = fn.text;
      else if (fn.type === "member_expression") name = fn.childForFieldName("property")?.text;
      else if (fn.type === "attribute") name = fn.childForFieldName("attribute")?.text;
      else if (fn.type === "selector_expression") name = fn.childForFieldName("field")?.text;
    }
    if (name && /^[A-Za-z_$][\w$]*$/.test(name)) out.add(name.replace(/<.*/, ""));
    if (out.size >= 60) break;
  }
  return [...out];
}

// Decorator / annotation based routes (FastAPI, Flask, Spring, NestJS).
function decoratorRoute(header: string, classPrefix = "", routerPrefixes?: Map<string, string>): string | undefined {
  let m = header.match(/@\s*(\w+)\.(get|post|put|patch|delete|route|api_route|websocket)\(\s*["']([^"']*)["']([^\n]*)/);
  if (m) {
    const verb = m[2] === "route" || m[2] === "api_route"
      ? (m[4].match(/methods\s*=\s*\[\s*["'](\w+)/)?.[1] ?? "GET")
      : m[2];
    return `${verb.toUpperCase()} ${joinRoute(routerPrefixes?.get(m[1]) ?? classPrefix, m[3])}`;
  }
  m = header.match(/@(Get|Post|Put|Patch|Delete|Request)Mapping\b(?:\s*\(\s*(?:(?:value|path)\s*=\s*)?\{?\s*"([^"]*)")?/);
  if (m) {
    const verb = m[1] === "Request" ? (header.match(/RequestMethod\.(\w+)/)?.[1] ?? "ANY") : m[1];
    return `${verb.toUpperCase()} ${joinRoute(classPrefix, m[2] ?? "")}`;
  }
  m = header.match(/@(Get|Post|Put|Patch|Delete|All)\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/);
  if (m) return `${m[1].toUpperCase()} ${joinRoute(classPrefix, m[2] ?? "")}`;
  return undefined;
}

function joinRoute(prefix: string, p: string) {
  const joined = `/${prefix}/${p}`.replace(/\/+/g, "/");
  return joined.length > 1 ? joined.replace(/\/$/, "") : joined;
}

// Lines of decorators/annotations directly above an entity plus its first lines.
function headerOf(src: string[], start: number, n = 6) {
  const above: string[] = [];
  for (let i = start - 2; i >= 0 && above.length < 6; i--) {
    const t = src[i].trim();
    if (t.startsWith("@") || (above.length && /^[)\]},]/.test(t))) above.unshift(src[i]);
    else break;
  }
  return [...above, ...src.slice(start - 1, start - 1 + n)].join("\n");
}

function nextjsRoute(filePath: string, name: string): string | undefined {
  const p = filePath.replace(/\\/g, "/");
  const app = p.match(/(?:^|\/)app\/(.*?)\/?route\.(?:t|j)sx?$/);
  if (app && HTTP_VERBS.includes(name.toLowerCase())) {
    const r = "/" + app[1].split("/").filter((s) => s && !/^\(.*\)$/.test(s)).join("/");
    return `${name.toUpperCase()} ${r}`;
  }
  const pages = p.match(/(?:^|\/)pages\/(api\/.*?)(?:\/index)?\.(?:t|j)sx?$/);
  if (pages && name === "default") return `ANY /${pages[1]}`;
  return undefined;
}

export async function parseFile(filePath: string, code: string): Promise<ParsedFile> {
  const lang = astLanguage(filePath);
  if (!lang) return { entities: [], imports: [] };
  const { P, langs } = await loadTreeSitter();
  const parser = new P();
  parser.setLanguage(langs[lang]);
  const tree = parser.parse(code);
  const src = code.split("\n");
  try {
    const result =
      lang === "python" ? parsePython(tree.rootNode, src) :
      lang === "java" ? parseJava(tree.rootNode, src) :
      lang === "go" ? parseGo(tree.rootNode, src) :
      parseJs(tree.rootNode, src, lang, filePath);
    addModuleEntity(result, tree.rootNode, src, lang, filePath);
    return result;
  } finally {
    tree.delete();
    parser.delete();
  }
}

// Top-level code outside functions/classes (app bootstrap, DB connections, wiring)
// becomes a "module" entity so it is still retrievable.
function addModuleEntity(res: ParsedFile, root: SN, src: string[], lang: Lang, filePath: string) {
  const covered = new Uint8Array(src.length + 2);
  for (const e of res.entities) {
    if (e.type === "route") continue;
    for (let i = e.startLine; i <= e.endLine; i++) covered[i] = 1;
  }
  const lines: string[] = [];
  let count = 0;
  for (let i = 1; i <= src.length; i++) {
    if (covered[i]) continue;
    const t = src[i - 1].trim();
    if (!t || /^(import |from \S+ import|package |#include|\/\/|\*|\/\*)/.test(t)) continue;
    count++;
    if (lines.length < 200) lines.push(`${i}: ${src[i - 1]}`);
  }
  if (count < 8 && res.entities.length > 0) return;
  if (count === 0) return;
  const calls = collectCalls(root, lang).slice(0, 40);
  res.entities.push({
    name: path.basename(filePath),
    type: "module",
    startLine: 1,
    endLine: src.length,
    content: lines.join("\n"),
    exported: false,
    calls,
  });
}

/* ----------------------------- JavaScript / TypeScript ----------------------------- */

function parseJs(root: SN, src: string[], lang: Lang, filePath: string): ParsedFile {
  const entities: ParsedEntity[] = [];
  const imports: string[] = [];
  const hasJsx = lang !== "typescript";

  const isComponent = (name: string, node: SN) =>
    hasJsx && /^[A-Z]/.test(name) &&
    node.descendantsOfType(["jsx_element", "jsx_self_closing_element", "jsx_fragment"]).length > 0;

  const add = (name: string, type: EntityType, node: SN, exported: boolean, parent?: string, maxLines = MAX_ENTITY_LINES, route?: string) => {
    const start = line(node), end = endLine(node);
    entities.push({
      name, type, startLine: start, endLine: end, parent, exported,
      content: clip(src, start, end, maxLines),
      calls: type === "class" ? [] : collectCalls(node, lang),
      route: route ?? (type === "function" ? nextjsRoute(filePath, name) : undefined),
    });
  };

  const visitClass = (node: SN, exported: boolean) => {
    const name = node.childForFieldName("name")?.text ?? "AnonymousClass";
    const header = headerOf(src, line(node), 2);
    const prefix = header.match(/@Controller\(\s*['"`]([^'"`]*)['"`]/)?.[1] ?? "";
    add(name, "class", node, exported, undefined, MAX_CLASS_LINES);
    const body = node.childForFieldName("body");
    for (const m of body?.namedChildren ?? []) {
      if (m.type === "method_definition") {
        const mName = m.childForFieldName("name")?.text ?? "method";
        add(mName, "method", m, exported, name, MAX_ENTITY_LINES, decoratorRoute(headerOf(src, line(m), 1), prefix));
      } else if ((m.type === "public_field_definition" || m.type === "field_definition") &&
        m.childForFieldName("value")?.type === "arrow_function") {
        add(m.childForFieldName("name")?.text ?? "field", "method", m, exported, name);
      }
    }
  };

  const visitDeclaration = (node: SN, exported: boolean) => {
    switch (node.type) {
      case "function_declaration":
      case "generator_function_declaration": {
        const name = node.childForFieldName("name")?.text ?? "default";
        add(name, isComponent(name, node) ? "component" : "function", node, exported);
        break;
      }
      case "class_declaration":
      case "abstract_class_declaration":
      case "class":
        visitClass(node, exported);
        break;
      case "interface_declaration":
        add(node.childForFieldName("name")?.text ?? "Interface", "interface", node, exported);
        break;
      case "type_alias_declaration":
        add(node.childForFieldName("name")?.text ?? "Type", "type", node, exported, undefined, 80);
        break;
      case "enum_declaration":
        add(node.childForFieldName("name")?.text ?? "Enum", "enum", node, exported, undefined, 80);
        break;
      case "lexical_declaration":
      case "variable_declaration":
        for (const d of node.namedChildren) {
          if (d.type !== "variable_declarator") continue;
          const name = d.childForFieldName("name")?.text;
          const value = d.childForFieldName("value");
          if (!name || !value) continue;
          const vt = value.type;
          const container = node.parent?.type === "export_statement" ? node.parent : node;
          if (vt === "arrow_function" || vt === "function_expression" || vt === "function") {
            add(name, isComponent(name, value) ? "component" : "function", container, exported);
          } else if (vt === "call_expression") {
            const fnText = value.childForFieldName("function")?.text ?? "";
            if (/\b(model|Schema|define|pgTable|mysqlTable|sqliteTable)$/.test(fnText)) add(name, "model", container, exported);
            else if (/^[A-Z]/.test(name) && /(memo|forwardRef|styled|observer)/.test(fnText)) add(name, "component", container, exported);
            else if (value.descendantsOfType(["arrow_function", "function_expression"]).length && endLine(value) - line(value) > 3)
              add(name, "function", container, exported);
          } else if (vt === "class") {
            visitClass(value, exported);
          }
        }
        break;
    }
  };

  for (const node of root.namedChildren) {
    if (node.type === "import_statement") {
      const s = node.childForFieldName("source");
      if (s) imports.push(unquote(s.text));
    } else if (node.type === "export_statement") {
      const s = node.childForFieldName("source");
      if (s) imports.push(unquote(s.text));
      const decl = node.childForFieldName("declaration") ?? node.namedChildren.find((c) => c.type !== "decorator");
      if (decl) {
        const before = entities.length;
        visitDeclaration(decl, true);
        // include `export` keyword / decorators in the line range
        for (let i = before; i < entities.length; i++) {
          if (entities[i].startLine > line(node) && !entities[i].parent) {
            entities[i].startLine = line(node);
            entities[i].content = clip(src, line(node), entities[i].endLine, MAX_ENTITY_LINES);
          }
        }
        if (entities.length === before && /export\s+default/.test(node.text) && ["arrow_function", "function_expression", "function"].includes(decl.type)) {
          add("default", "function", node, true);
        }
      }
    } else if (node.type === "expression_statement") {
      // module.exports.foo = function () {} / exports.handler = async () => {}
      const a = node.namedChildren[0];
      if (a?.type === "assignment_expression") {
        const left = a.childForFieldName("left");
        const right = a.childForFieldName("right");
        if (left?.type === "member_expression" && right && ["arrow_function", "function_expression", "function"].includes(right.type)) {
          add(left.childForFieldName("property")?.text ?? "exports", "function", node, true);
        }
      }
    } else {
      visitDeclaration(node, false);
    }
  }

  // require('x')
  for (const c of root.descendantsOfType("call_expression")) {
    const fn = c.childForFieldName("function");
    if (fn?.type === "identifier" && fn.text === "require") {
      const arg = c.childForFieldName("arguments")?.namedChildren[0];
      if (arg?.type === "string") imports.push(unquote(arg.text));
    }
  }

  // Express / Koa / Fastify / Hono style: app.get('/path', handler)
  for (const c of root.descendantsOfType("call_expression")) {
    const fn = c.childForFieldName("function");
    if (fn?.type !== "member_expression") continue;
    const verb = fn.childForFieldName("property")?.text ?? "";
    const obj = fn.childForFieldName("object")?.text ?? "";
    if (!HTTP_VERBS.includes(verb) || !/^(app|router|server|api|r|route|routes|fastify|\w*[Rr]outer|\w*[Aa]pp)$/.test(obj)) continue;
    const args = c.childForFieldName("arguments")?.namedChildren ?? [];
    const p = args[0];
    if (!p || !["string", "template_string"].includes(p.type) || !unquote(p.text).startsWith("/")) continue;
    const last = args[args.length - 1];
    const handler = last && last !== p
      ? last.type === "identifier" ? last.text
        : last.type === "member_expression" ? last.childForFieldName("property")?.text : undefined
      : undefined;
    const route = `${verb.toUpperCase()} ${unquote(p.text)}`;
    const node = c.parent?.type === "expression_statement" ? c.parent : c;
    entities.push({
      name: route, type: "route", startLine: line(node), endLine: endLine(node),
      content: clip(src, line(node), endLine(node), 120), exported: false, route, handler,
      calls: collectCalls(c, lang).filter((n) => n !== verb),
    });
  }

  return { entities, imports };
}

/* ----------------------------------- Python ----------------------------------- */

function parsePython(root: SN, src: string[]): ParsedFile {
  const entities: ParsedEntity[] = [];
  const imports: string[] = [];
  // router = APIRouter(prefix="/users") / bp = Blueprint("auth", __name__, url_prefix="/auth")
  const prefixes = new Map<string, string>();
  for (const m of src.join("\n").matchAll(/(\w+)\s*=\s*(?:APIRouter|Blueprint)\(([^)]*)\)/g)) {
    const p = m[2].match(/(?:url_)?prefix\s*=\s*["']([^"']*)["']/);
    if (p) prefixes.set(m[1], p[1]);
  }

  const visit = (node: SN, parent?: string) => {
    let def = node;
    if (node.type === "decorated_definition") def = node.childForFieldName("definition") ?? node;
    const start = line(node), end = endLine(node);
    if (def.type === "function_definition") {
      const name = def.childForFieldName("name")?.text ?? "fn";
      entities.push({
        name, type: parent ? "method" : "function", startLine: start, endLine: end, parent,
        exported: !name.startsWith("_"), content: clip(src, start, end, MAX_ENTITY_LINES),
        calls: collectCalls(def, "python"), route: decoratorRoute(headerOf(src, start, 3), "", prefixes),
      });
    } else if (def.type === "class_definition") {
      const name = def.childForFieldName("name")?.text ?? "Class";
      const supers = def.childForFieldName("superclasses")?.text ?? "";
      const isModel = /(models\.Model|\bBase\b|BaseModel|db\.Model|SQLModel|Document|DeclarativeBase)/.test(supers);
      entities.push({
        name, type: isModel ? "model" : "class", startLine: start, endLine: end,
        exported: !name.startsWith("_"), content: clip(src, start, end, MAX_CLASS_LINES), calls: [],
      });
      for (const child of def.childForFieldName("body")?.namedChildren ?? []) visit(child, name);
    }
  };

  for (const node of root.namedChildren) {
    if (node.type === "import_statement") {
      for (const n of node.namedChildren) imports.push((n.childForFieldName("name") ?? n).text);
    } else if (node.type === "import_from_statement") {
      const m = node.childForFieldName("module_name");
      if (m) {
        const mod = m.text;
        imports.push(mod);
        // `from . import views` / `from app import models` → also try submodules
        for (const n of node.namedChildren) {
          if (n === m || (n.type !== "dotted_name" && n.type !== "aliased_import")) continue;
          imports.push(`${mod}${mod.endsWith(".") ? "" : "."}${(n.childForFieldName("name") ?? n).text}`);
        }
      }
    } else {
      visit(node);
    }
  }
  return { entities, imports };
}

/* ------------------------------------ Java ------------------------------------ */

function parseJava(root: SN, src: string[]): ParsedFile {
  const entities: ParsedEntity[] = [];
  const imports: string[] = [];

  const visitType = (node: SN, parent?: string) => {
    const name = node.childForFieldName("name")?.text ?? "Type";
    const start = line(node), end = endLine(node);
    const header = headerOf(src, start, 3);
    const type: EntityType =
      node.type === "interface_declaration" ? "interface" :
      node.type === "enum_declaration" ? "enum" :
      /@(Entity|Table|Document)\b/.test(header) ? "model" : "class";
    const prefix = header.match(/@RequestMapping\s*\(\s*(?:(?:value|path)\s*=\s*)?"([^"]*)"/)?.[1] ?? "";
    entities.push({
      name, type, startLine: start, endLine: end, parent, exported: /\bpublic\b/.test(header),
      content: clip(src, start, end, MAX_CLASS_LINES), calls: [],
    });
    for (const m of node.childForFieldName("body")?.namedChildren ?? []) {
      if (m.type === "method_declaration" || m.type === "constructor_declaration") {
        const ms = line(m), me = endLine(m);
        const mh = headerOf(src, ms, 4);
        entities.push({
          name: m.childForFieldName("name")?.text ?? name, type: "method", startLine: ms, endLine: me,
          parent: name, exported: /\bpublic\b/.test(mh), content: clip(src, ms, me, MAX_ENTITY_LINES),
          calls: collectCalls(m, "java"),
          route: /Mapping\b/.test(mh) && !/@RequestMapping/.test(header.split("\n").pop() ?? "") ? decoratorRoute(mh, prefix) : undefined,
        });
      } else if (["class_declaration", "interface_declaration", "enum_declaration", "record_declaration"].includes(m.type)) {
        visitType(m, name);
      }
    }
  };

  for (const node of root.namedChildren) {
    if (node.type === "import_declaration") {
      imports.push(node.text.replace(/^import\s+(static\s+)?/, "").replace(/;$/, "").trim());
    } else if (["class_declaration", "interface_declaration", "enum_declaration", "record_declaration"].includes(node.type)) {
      visitType(node);
    }
  }
  return { entities, imports };
}

/* ------------------------------------- Go ------------------------------------- */

function parseGo(root: SN, src: string[]): ParsedFile {
  const entities: ParsedEntity[] = [];
  const imports: string[] = [];
  const exported = (n: string) => /^[A-Z]/.test(n);

  for (const node of root.namedChildren) {
    const start = line(node), end = endLine(node);
    if (node.type === "import_declaration") {
      for (const spec of node.descendantsOfType("import_spec")) {
        const p = spec.childForFieldName("path");
        if (p) imports.push(unquote(p.text));
      }
    } else if (node.type === "function_declaration") {
      const name = node.childForFieldName("name")?.text ?? "fn";
      entities.push({ name, type: "function", startLine: start, endLine: end, exported: exported(name),
        content: clip(src, start, end, MAX_ENTITY_LINES), calls: collectCalls(node, "go") });
    } else if (node.type === "method_declaration") {
      const name = node.childForFieldName("name")?.text ?? "method";
      const recv = node.childForFieldName("receiver")?.descendantsOfType("type_identifier")[0]?.text;
      entities.push({ name, type: "method", parent: recv, startLine: start, endLine: end, exported: exported(name),
        content: clip(src, start, end, MAX_ENTITY_LINES), calls: collectCalls(node, "go") });
    } else if (node.type === "type_declaration") {
      for (const spec of node.namedChildren.filter((c) => c.type === "type_spec")) {
        const name = spec.childForFieldName("name")?.text ?? "Type";
        const t = spec.childForFieldName("type")?.type;
        entities.push({
          name, type: t === "interface_type" ? "interface" : t === "struct_type" ? "class" : "type",
          startLine: line(spec), endLine: endLine(spec), exported: exported(name),
          content: clip(src, line(spec), endLine(spec), MAX_CLASS_LINES), calls: [],
        });
      }
    }
  }

  // net/http, gin, echo, chi, fiber: r.GET("/path", handler), http.HandleFunc("/path", h)
  for (const c of root.descendantsOfType("call_expression")) {
    const fn = c.childForFieldName("function");
    if (fn?.type !== "selector_expression") continue;
    const field = fn.childForFieldName("field")?.text ?? "";
    if (!/^(HandleFunc|Handle|GET|POST|PUT|PATCH|DELETE|Get|Post|Put|Patch|Delete|Any)$/.test(field)) continue;
    const args = c.childForFieldName("arguments")?.namedChildren ?? [];
    const p = args[0];
    if (!p || !/string_literal/.test(p.type) || !unquote(p.text).startsWith("/")) continue;
    const verb = /^Handle/.test(field) ? "ANY" : field.toUpperCase();
    const last = args[args.length - 1];
    const handler = last?.type === "identifier" ? last.text
      : last?.type === "selector_expression" ? last.childForFieldName("field")?.text : undefined;
    const route = `${verb} ${unquote(p.text)}`;
    entities.push({ name: route, type: "route", startLine: line(c), endLine: endLine(c), exported: false,
      content: clip(src, line(c), endLine(c), 120), route, handler, calls: collectCalls(c, "go").filter((n) => n !== field) });
  }
  return { entities, imports };
}
