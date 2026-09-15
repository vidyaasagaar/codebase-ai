import { NextResponse } from "next/server";
import { impactAnalysis } from "@/lib/retrieval";
import { authorizeRepo } from "@/lib/auth/access";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await authorizeRepo(req, id);
  if (!access.ok) return access.response;
  const body = (await req.json().catch(() => ({}))) as { entityId?: number };
  if (!body.entityId) return NextResponse.json({ error: "entityId is required" }, { status: 400 });
  const result = await impactAnalysis(id, Number(body.entityId));
  if (!result) return NextResponse.json({ error: "Entity not found" }, { status: 404 });
  return NextResponse.json(result);
}
