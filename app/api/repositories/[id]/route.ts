import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { deleteRepository } from "@/lib/repository/ingest";
import { authorizeRepo } from "@/lib/auth/access";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await authorizeRepo(req, id);
  if (!access.ok) return access.response;
  const [repo] = await query<{ status: string; stats: { routes?: number } }>(
    `SELECT id, name, url, branch, commit_sha, status, progress, stats, metadata, error, created_at, provider, private, indexed_at
     FROM repositories WHERE id = $1`,
    [id],
  );
  if (!repo) return NextResponse.json({ error: "Repository not found" }, { status: 404 });
  if (repo.status !== "ready") return NextResponse.json(repo);
  return NextResponse.json({ ...repo, suggestions: await suggestions(id, repo.stats) });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await authorizeRepo(req, id);
  if (!access.ok) return access.response;
  const ok = await deleteRepository(id);
  return ok ? NextResponse.json({ deleted: true }) : NextResponse.json({ error: "Repository not found" }, { status: 404 });
}

// Starter questions tailored to what the index actually contains.
async function suggestions(repoId: string, stats: { routes?: number }) {
  const out = ["Explain the architecture of this codebase.", "What should I understand first as a new developer?"];
  const has = async (pattern: string) =>
    (await query("SELECT 1 FROM code_entities WHERE repository_id = $1 AND symbol_name ~* $2 LIMIT 1", [repoId, pattern])).length > 0;
  if (await has("auth|login|jwt|token|session")) out.push("Where is authentication handled?", "How does login work?");
  if (await has("regist|signup|sign_up|createUser")) out.push("How does a user registration request flow through the system?");
  if (await has("connect|database|db|prisma|sequelize|engine|datasource")) out.push("Where are database connections created?");
  if (stats.routes) out.push("Show me all API routes.");
  if (await has("pay|stripe|checkout|order")) out.push("What handles payment or order processing?");
  const [top] = await query<{ symbol_name: string }>(
    `SELECT e.symbol_name FROM code_entities e JOIN relationships r ON r.target_entity_id = e.id
     WHERE e.repository_id = $1 AND e.symbol_type IN ('function','method','class') AND length(e.symbol_name) > 3
     GROUP BY e.id, e.symbol_name ORDER BY count(*) DESC LIMIT 1`,
    [repoId],
  );
  if (top) out.push(`What would be affected if I changed ${top.symbol_name}?`);
  return out.slice(0, 8);
}
