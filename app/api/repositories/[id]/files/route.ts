import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { repoRoot } from "@/lib/repository/ingest";
import { authorizeRepo } from "@/lib/auth/access";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await authorizeRepo(req, id);
  if (!access.ok) return access.response;
  const filePath = new URL(req.url).searchParams.get("path");
  const [repo] = await query<{ id: string; url: string }>("SELECT id, url FROM repositories WHERE id = $1", [id]);
  if (!repo) return NextResponse.json({ error: "Repository not found" }, { status: 404 });

  if (!filePath) {
    const files = await query("SELECT path, language, module, line_count FROM files WHERE repository_id = $1 ORDER BY path", [id]);
    return NextResponse.json(files);
  }

  // Only files that were indexed can be read (prevents path traversal).
  const [file] = await query<{ path: string; language: string }>(
    "SELECT path, language FROM files WHERE repository_id = $1 AND path = $2",
    [id, filePath],
  );
  if (!file) return NextResponse.json({ error: "File not indexed" }, { status: 404 });
  const root = path.resolve(repoRoot(repo));
  const full = path.resolve(root, file.path);
  if (!full.startsWith(root)) return NextResponse.json({ error: "Invalid path" }, { status: 400 });

  const content = fs.readFileSync(full, "utf8");
  const entities = await query(
    `SELECT id, symbol_name, symbol_type, file_path, start_line, end_line, parent, route FROM code_entities
     WHERE repository_id = $1 AND file_path = $2 AND symbol_type NOT IN ('doc', 'config', 'chunk') ORDER BY start_line`,
    [id, file.path],
  );
  return NextResponse.json({ path: file.path, language: file.language, content, entities });
}
