import { NextResponse } from "next/server";
import { capabilities } from "@/lib/runtime";

export const dynamic = "force-dynamic";

// GET /api/capabilities — what this deployment can do (hosted previews can't index repositories).
export async function GET() {
  return NextResponse.json(capabilities());
}
