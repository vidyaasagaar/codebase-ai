import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { authorizeRepo } from "@/lib/auth/access";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const COLS = "e.id, e.symbol_name, e.symbol_type, e.file_path, e.start_line, e.end_line, e.parent, e.route, e.module";

// ?routes=1 → all API routes · ?q=name → symbol search · (none) → most referenced entities
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await authorizeRepo(req, id);
  if (!access.ok) return access.response;
  const sp = new URL(req.url).searchParams;

  if (sp.get("routes")) {
    return NextResponse.json(
      await query(`SELECT ${COLS} FROM code_entities e WHERE e.repository_id = $1 AND e.route IS NOT NULL ORDER BY e.route LIMIT 1000`, [id]),
    );
  }

  const q = sp.get("q")?.trim();
  if (q) {
    return NextResponse.json(
      await query(
        `SELECT ${COLS} FROM code_entities e
         WHERE e.repository_id = $1 AND e.symbol_type NOT IN ('doc','config','chunk') AND e.symbol_name ILIKE '%' || $2 || '%'
         ORDER BY (lower(e.symbol_name) = lower($2)) DESC, length(e.symbol_name) LIMIT 50`,
        [id, q],
      ),
    );
  }

  return NextResponse.json(
    await query(
      `SELECT ${COLS}, count(r.source_entity_id)::int AS refs FROM code_entities e
       JOIN relationships r ON r.target_entity_id = e.id
       WHERE e.repository_id = $1 AND e.symbol_type IN ('function','method','class','component','model')
       GROUP BY e.id ORDER BY refs DESC LIMIT 15`,
      [id],
    ),
  );
}
