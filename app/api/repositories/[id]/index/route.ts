import { NextResponse } from "next/server";
import { authorizeRepo } from "@/lib/auth/access";
import { reindexRepository } from "@/lib/repository/ingest";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/repositories/:id/index — manual re-index through the existing pipeline (fresh checkout, full rebuild).
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await authorizeRepo(req, id);
  if (!access.ok) return access.response;
  const started = await reindexRepository(id);
  return started
    ? NextResponse.json({ reindexing: true }, { status: 202 })
    : NextResponse.json({ error: "This repository is already being indexed." }, { status: 409 });
}
