import { NextResponse } from "next/server";
import { createExtensionAuthCode, getAuth, isAllowedEditorRedirect } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

// POST /api/extension/authorize {state, redirectUri}
// Called by the /extension/auth page for a signed-in browser. Issues a one-time, 5-minute code that is only ever
// delivered to the Codebase AI VS Code extension's URI handler. The GitHub token itself never leaves the server.
export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) {
    return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  }
  const auth = await getAuth(req);
  if (!auth || auth.kind !== "web") {
    return NextResponse.json({ error: "Continue with GitHub in the browser first.", code: "auth_required" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { state?: string; redirectUri?: string };
  if (!body.state || !/^[\w-]{16,128}$/.test(body.state) || !body.redirectUri || !isAllowedEditorRedirect(body.redirectUri)) {
    return NextResponse.json({ error: "Invalid VS Code sign-in request. Start sign-in again from VS Code." }, { status: 400 });
  }

  const code = await createExtensionAuthCode(auth.connectionId, body.state);
  const redirect = new URL(body.redirectUri);
  redirect.searchParams.set("code", code);
  redirect.searchParams.set("state", body.state);
  return NextResponse.json({ redirectUrl: redirect.toString(), login: auth.login });
}
