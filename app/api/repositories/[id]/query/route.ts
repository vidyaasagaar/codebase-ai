import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { answerQuestion } from "@/lib/ai/answer";
import type { ChatMessage } from "@/lib/ai/llm";
import { authorizeRepo } from "@/lib/auth/access";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Streams NDJSON events: meta (query type + sources) → delta* → verification.
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await authorizeRepo(req, id);
  if (!access.ok) return access.response;
  const body = (await req.json().catch(() => ({}))) as { question?: string; entityId?: number; history?: ChatMessage[] };
  const question = body.question?.trim();
  if (!question) return NextResponse.json({ error: "question is required" }, { status: 400 });

  const [repo] = await query<{ status: string }>("SELECT status FROM repositories WHERE id = $1", [id]);
  if (!repo) return NextResponse.json({ error: "Repository not found" }, { status: 404 });
  if (repo.status !== "ready") return NextResponse.json({ error: "Repository is still indexing" }, { status: 409 });

  const history = (body.history ?? []).filter((m) => m.role === "user" || m.role === "assistant");
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of answerQuestion(id, question, { focusEntityId: body.entityId, history })) {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        controller.enqueue(encoder.encode(JSON.stringify({ type: "error", message }) + "\n"));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" } });
}
