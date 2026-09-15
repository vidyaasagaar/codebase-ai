import { NextResponse } from "next/server";
import { entityDependencies } from "@/lib/retrieval";
import { authorizeRepo } from "@/lib/auth/access";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; entityId: string }> };

// Entity details with its dependency explorer data (depends on / used by / file imports).
export async function GET(req: Request, { params }: Ctx) {
  const { id, entityId } = await params;
  const access = await authorizeRepo(req, id);
  if (!access.ok) return access.response;
  const result = await entityDependencies(id, Number(entityId));
  if (!result) return NextResponse.json({ error: "Entity not found" }, { status: 404 });
  return NextResponse.json(result);
}
