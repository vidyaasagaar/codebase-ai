import fs from "node:fs";
import path from "node:path";

// File discovery, language/framework detection and module assignment.

const IGNORED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", "vendor", "target",
  "__pycache__", ".venv", "venv", "env", ".tox", "coverage", ".idea", ".vscode", "bin", "obj",
  ".gradle", ".cache", ".turbo", ".svelte-kit", "site-packages", ".pytest_cache", ".mypy_cache",
]);

const IGNORED_FILES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "go.sum", "poetry.lock", "Cargo.lock",
  "composer.lock", "Gemfile.lock", "uv.lock",
]);

export const LANGUAGE_BY_EXT: Record<string, string> = {
  ".ts": "TypeScript", ".tsx": "TypeScript", ".mts": "TypeScript", ".cts": "TypeScript",
  ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
  ".py": "Python", ".java": "Java", ".go": "Go", ".kt": "Kotlin", ".rb": "Ruby", ".php": "PHP",
  ".rs": "Rust", ".cs": "C#", ".c": "C", ".h": "C", ".cpp": "C++", ".hpp": "C++", ".swift": "Swift",
  ".scala": "Scala", ".vue": "Vue", ".svelte": "Svelte", ".sql": "SQL", ".prisma": "Prisma",
  ".graphql": "GraphQL", ".gql": "GraphQL", ".sh": "Shell", ".html": "HTML", ".css": "CSS", ".scss": "CSS",
  ".md": "Markdown", ".json": "JSON", ".yml": "YAML", ".yaml": "YAML", ".toml": "TOML", ".xml": "XML",
  ".gradle": "Gradle", ".proto": "Protobuf",
};

const SPECIAL_FILES: Record<string, string> = {
  Dockerfile: "Docker", Makefile: "Make", "requirements.txt": "Text", ".env.example": "Text", Procfile: "Text",
};

const NON_SOURCE = new Set(["Markdown", "JSON", "YAML", "TOML", "XML", "Text", "Docker", "Make", "Gradle", "HTML", "CSS"]);

export interface DiscoveredFile {
  path: string;      // posix, relative to repo root
  language: string;
  size: number;
  isSource: boolean;
}

const MAX_FILES = 6000;
const MAX_FILE_BYTES = 512 * 1024;

export function discoverFiles(root: string): { all: number; files: DiscoveredFile[] } {
  const files: DiscoveredFile[] = [];
  let all = 0;
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (files.length >= MAX_FILES) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!IGNORED_DIRS.has(e.name) && !e.name.startsWith(".")) walk(full);
        continue;
      }
      if (!e.isFile()) continue;
      all++;
      if (IGNORED_FILES.has(e.name) || /\.min\.(js|css)$|\.map$|\.d\.ts$/.test(e.name)) continue;
      const language = SPECIAL_FILES[e.name] ?? LANGUAGE_BY_EXT[path.extname(e.name).toLowerCase()];
      if (!language) continue;
      const size = fs.statSync(full).size;
      if (size > MAX_FILE_BYTES || size === 0) continue;
      files.push({
        path: path.relative(root, full).split(path.sep).join("/"),
        language,
        size,
        isSource: !NON_SOURCE.has(language),
      });
    }
  };
  walk(root);
  return { all, files };
}

const SOURCE_ROOTS = new Set(["src", "lib", "app", "source", "main", "java", "kotlin", "python", "pkg", "internal", "cmd", "server", "backend"]);
const MONO_ROOTS = new Set(["packages", "apps", "services", "modules", "libs"]);
// Directories that group features (routes/auth, modules/users) rather than being a feature themselves.
const CONTAINERS = new Set(["routes", "modules", "features", "domains", "domain", "api", "handlers", "controllers", "services", "components", "pages", "views"]);

// Logical module = first meaningful directory after common source roots.
export function moduleOf(filePath: string): string {
  const parts = filePath.split("/").slice(0, -1);
  if (parts.length && MONO_ROOTS.has(parts[0]) && parts[1]) return `${parts[0]}/${parts[1]}`;
  let i = 0;
  while (i < parts.length && SOURCE_ROOTS.has(parts[i])) i++;
  // Java-style package roots: com/example/project/...
  if (["com", "org", "net", "io", "dev"].includes(parts[i])) i += Math.min(2, parts.length - i - 1);
  if (CONTAINERS.has(parts[i]) && parts[i + 1]) i++;
  return parts[i] ?? (parts.length ? parts[parts.length - 1] : "root");
}

export function detectFrameworks(root: string, files: DiscoveredFile[]): string[] {
  const found = new Set<string>();
  const read = (p: string) => { try { return fs.readFileSync(path.join(root, p), "utf8"); } catch { return ""; } };
  const manifests = files.filter((f) => /(^|\/)(package\.json|requirements\.txt|pyproject\.toml|pom\.xml|build\.gradle(\.kts)?|go\.mod)$/.test(f.path));
  const checks: [RegExp, string][] = [
    [/"next"\s*:/, "Next.js"], [/"react"\s*:/, "React"], [/"vue"\s*:/, "Vue"], [/"@angular\/core"/, "Angular"],
    [/"svelte"\s*:/, "Svelte"], [/"express"\s*:/, "Express"], [/"@nestjs\/core"/, "NestJS"], [/"fastify"\s*:/, "Fastify"],
    [/"koa"\s*:/, "Koa"], [/"hono"\s*:/, "Hono"], [/"prisma"|"@prisma\/client"/, "Prisma"], [/"mongoose"\s*:/, "Mongoose"],
    [/"sequelize"\s*:/, "Sequelize"], [/"typeorm"\s*:/, "TypeORM"], [/"drizzle-orm"/, "Drizzle"], [/"jsonwebtoken"|"passport"/, "JWT/Passport auth"],
    [/\bdjango\b/i, "Django"], [/\bflask\b/i, "Flask"], [/\bfastapi\b/i, "FastAPI"], [/\bsqlalchemy\b/i, "SQLAlchemy"],
    [/spring-boot/, "Spring Boot"], [/gin-gonic\/gin/, "Gin"], [/labstack\/echo/, "Echo"], [/go-chi\/chi/, "Chi"],
    [/gofiber\/fiber/, "Fiber"], [/gorm\.io\/gorm/, "GORM"],
  ];
  for (const m of manifests.slice(0, 20)) {
    const text = read(m.path);
    for (const [re, name] of checks) if (re.test(text)) found.add(name);
  }
  return [...found];
}

const ENTRY_RE = /(^|\/)(main\.(go|py|ts|js|java)|index\.(ts|js)|server\.(ts|js|py)|app\.(ts|js|py)|manage\.py|wsgi\.py|asgi\.py|__main__\.py|Application\.java|[A-Z]\w*Application\.java)$/;

export function entryPoints(files: DiscoveredFile[]): string[] {
  return files
    .filter((f) => ENTRY_RE.test(f.path))
    .sort((a, b) => a.path.split("/").length - b.path.split("/").length)
    .slice(0, 8)
    .map((f) => f.path);
}

// Non-AST files (docs, config, unsupported languages) are split into small windows.
export function chunkText(filePath: string, language: string, text: string) {
  const lines = text.split("\n");
  const base = path.posix.basename(filePath);
  const type = language === "Markdown" ? "doc" : NON_SOURCE.has(language) ? "config" : "chunk";
  const out: { name: string; type: string; startLine: number; endLine: number; content: string }[] = [];
  const WINDOW = 60;

  if (language === "Markdown") {
    let start = 1;
    let title = base;
    for (let i = 1; i <= lines.length + 1; i++) {
      const isHeading = i <= lines.length && /^#{1,3}\s/.test(lines[i - 1]);
      if ((isHeading && i > start) || i === lines.length + 1 || i - start >= WINDOW) {
        const content = lines.slice(start - 1, i - 1).join("\n");
        if (content.trim()) out.push({ name: `${base} › ${title}`, type, startLine: start, endLine: i - 1, content });
        start = i;
      }
      if (isHeading) title = lines[i - 1].replace(/^#+\s*/, "").slice(0, 80);
    }
    return out.slice(0, 40);
  }

  for (let s = 1; s <= lines.length; s += WINDOW) {
    const e = Math.min(lines.length, s + WINDOW - 1);
    const content = lines.slice(s - 1, e).join("\n");
    if (content.trim()) out.push({ name: lines.length > WINDOW ? `${base} (lines ${s}-${e})` : base, type, startLine: s, endLine: e, content });
  }
  return out.slice(0, 20);
}
