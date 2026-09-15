import { NextResponse } from "next/server";
import { moduleGraph, fileGraph } from "@/lib/retrieval";
import { authorizeRepo } from "@/lib/auth/access";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Module-level graph by default; ?module=name drills into that module's files.
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await authorizeRepo(req, id);
  if (!access.ok) return access.response;
  const moduleName = new URL(req.url).searchParams.get("module");
  return NextResponse.json(moduleName ? await fileGraph(id, moduleName) : await moduleGraph(id));
}
