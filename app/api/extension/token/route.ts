import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { createSession, redeemExtensionAuthCode } from "@/lib/auth/session";
import { capabilities } from "@/lib/runtime";

export const dynamic = "force-dynamic";

// POST /api/extension/token {code, state} — the VS Code extension exchanges its single-use code for a
// Codebase AI session token (stored by the extension in VS Code SecretStorage).
export async function POST(req: Request) {
  if (!capabilities().indexing) {
    return NextResponse.json({ error: "Sign-in isn't available on this hosted preview. Point the extension at a local or self-hosted Codebase AI server.", code: "unavailable" }, { status: 503 });
  }
  const body = (await req.json().catch(() => ({}))) as { code?: string; state?: string };
  if (!body.code || !body.state) return NextResponse.json({ error: "code and state are required" }, { status: 400 });

  const connectionId = await redeemExtensionAuthCode(body.code, body.state);
  if (!connectionId) {
    return NextResponse.json({ error: "This sign-in link is invalid or has expired. Start sign-in again from VS Code." }, { status: 400 });
  }
  const token = await createSession(connectionId, "extension");
  const [user] = await query<{ login: string; name: string | null; avatar_url: string | null }>(
    "SELECT login, name, avatar_url FROM github_connections WHERE id = $1",
    [connectionId],
  );
  return NextResponse.json({ token, user: { login: user.login, name: user.name, avatarUrl: user.avatar_url } });
}
