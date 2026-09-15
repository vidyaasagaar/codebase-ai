import { NextResponse } from "next/server";
import { callbackUrl, exchangeCode, fetchGithubUser } from "@/lib/auth/github-oauth";
import {
  STATE_COOKIE, createSession, readCookie, sanitizeReturnTo, setSessionCookie, upsertConnection,
} from "@/lib/auth/session";
import { sha256 } from "@/lib/auth/crypto";

export const dynamic = "force-dynamic";

// GET /api/auth/github/callback — GitHub redirects here after the user approves (or denies) access.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const clearState = (res: NextResponse) => {
    res.cookies.set(STATE_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/api/auth/github", maxAge: 0 });
    return res;
  };
  const fail = (code: string) => clearState(NextResponse.redirect(new URL(`/?github_error=${code}`, url)));

  let saved: { state?: string; returnTo?: string } | null = null;
  try {
    saved = JSON.parse(readCookie(req, STATE_COOKIE) ?? "null");
  } catch {
    saved = null;
  }

  const error = url.searchParams.get("error");
  if (error) return fail(error === "access_denied" ? "denied" : "failed");

  // Redirect after installing the GitHub App (no sign-in state from this browser): ask the user to continue.
  if (url.searchParams.get("setup_action") && !saved?.state) {
    return clearState(NextResponse.redirect(new URL("/?github_installed=1", url)));
  }

  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!saved?.state || !state || sha256(saved.state) !== sha256(state)) return fail("state");
  if (!code) return fail("failed");

  try {
    const tokens = await exchangeCode(code, callbackUrl(url.origin));
    const user = await fetchGithubUser(tokens.accessToken);
    const connectionId = await upsertConnection(user, tokens);
    const sessionToken = await createSession(connectionId, "web");
    const res = NextResponse.redirect(new URL(sanitizeReturnTo(saved.returnTo), url));
    setSessionCookie(res, req, sessionToken);
    return clearState(res);
  } catch {
    return fail("failed");
  }
}
