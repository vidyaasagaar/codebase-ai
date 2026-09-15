import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth/session";
import { githubAuthConfig, githubInstallUrl } from "@/lib/auth/github-oauth";

export const dynamic = "force-dynamic";

// GET /api/auth/session — who is signed in (browser cookie or VS Code bearer token). Never returns tokens.
export async function GET(req: Request) {
  const auth = await getAuth(req);
  return NextResponse.json({
    user: auth ? { login: auth.login, name: auth.name, avatarUrl: auth.avatarUrl } : null,
    githubConfigured: Boolean(githubAuthConfig()),
    installUrl: githubInstallUrl(),
  });
}
