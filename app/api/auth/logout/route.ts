import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { clearSessionCookie, deleteSession, getAuth, getConnectionToken } from "@/lib/auth/session";
import { revokeToken } from "@/lib/auth/github-oauth";
import { forgetRepoAccess } from "@/lib/auth/access";

export const dynamic = "force-dynamic";

// POST /api/auth/logout            → ends this session (browser cookie or VS Code token)
// POST /api/auth/logout {disconnect} → also revokes the GitHub token and removes the GitHub connection
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { disconnect?: boolean };
  const auth = await getAuth(req);

  if (auth && body.disconnect) {
    const token = await getConnectionToken(auth.connectionId).catch(() => null);
    if (token) await revokeToken(token);
    await query("DELETE FROM github_connections WHERE id = $1", [auth.connectionId]); // cascades to sessions + codes
    forgetRepoAccess(auth.connectionId);
  } else if (auth) {
    await deleteSession(auth.tokenHash);
  }

  const res = NextResponse.json({ signedOut: true, disconnected: Boolean(auth && body.disconnect) });
  if (auth?.kind !== "extension") clearSessionCookie(res);
  return res;
}
