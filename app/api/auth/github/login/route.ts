import { NextResponse } from "next/server";
import { authorizeUrl, githubAuthConfig } from "@/lib/auth/github-oauth";
import { STATE_COOKIE, sanitizeReturnTo } from "@/lib/auth/session";
import { randomToken } from "@/lib/auth/crypto";

export const dynamic = "force-dynamic";

// GET /api/auth/github/login?returnTo=/path — starts the GitHub web flow with a CSRF state bound to this browser.
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!githubAuthConfig()) return NextResponse.redirect(new URL("/?github_error=not_configured", url));

  const state = randomToken(24);
  const returnTo = sanitizeReturnTo(url.searchParams.get("returnTo"));
  const res = NextResponse.redirect(authorizeUrl(url.origin, state));
  res.cookies.set(STATE_COOKIE, JSON.stringify({ state, returnTo }), {
    httpOnly: true, sameSite: "lax", secure: url.protocol === "https:", path: "/api/auth/github", maxAge: 600,
  });
  return res;
}
