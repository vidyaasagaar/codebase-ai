import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { checkRepoAccess } from "@/lib/repository/github";
import { getAuth, getConnectionToken, type Auth } from "./session";
import { capabilities } from "@/lib/runtime";

// Access control for indexed repositories.
// Public, Git-URL and local-workspace repositories keep working without sign-in (unchanged behavior).
// Private GitHub repositories require a signed-in GitHub connection that GitHub itself currently authorizes for
// that repository — so collaborators with access can open it, and revoked access is detected.

export type AccessDenied = "auth_required" | "reauth_required" | "access_revoked" | "github_unavailable";

const DENIALS: Record<AccessDenied, [number, string]> = {
  auth_required: [401, "This is a private repository. Continue with GitHub to access it."],
  reauth_required: [401, "Your GitHub authorization expired. Reconnect GitHub to continue."],
  access_revoked: [403, "Codebase AI no longer has access to this repository. Reconnect GitHub or select another repository."],
  github_unavailable: [503, "Could not verify repository access with GitHub right now. Please try again later."],
};

export function deny(reason: AccessDenied) {
  const [status, error] = DENIALS[reason];
  return NextResponse.json({ error, code: reason }, { status });
}

export interface RepoAccessRow {
  id: string;
  private: boolean;
  owner_connection_id: string | null;
  provider: string | null;
  metadata: { fullName?: string };
}

type Result = { ok: true; repo: RepoAccessRow; auth: Auth | null } | { ok: false; response: NextResponse };

export async function authorizeRepo(req: Request, repoId: string): Promise<Result> {
  // Hosted previews never index repositories; answer without starting the database.
  if (!capabilities().indexing) {
    return { ok: false, response: NextResponse.json({ error: "Repository not found" }, { status: 404 }) };
  }
  const [repo] = await query<RepoAccessRow>(
    "SELECT id, private, owner_connection_id, provider, metadata FROM repositories WHERE id = $1",
    [repoId],
  );
  if (!repo) return { ok: false, response: NextResponse.json({ error: "Repository not found" }, { status: 404 }) };
  const auth = await getAuth(req);
  if (!repo.private) return { ok: true, repo, auth };
  if (!auth) return { ok: false, response: deny("auth_required") };
  const verdict = await verifyGithubAccess(auth.connectionId, repo);
  return verdict === true ? { ok: true, repo, auth } : { ok: false, response: deny(verdict) };
}

const ACCESS_TTL_MS = 5 * 60_000;
type Cached = { ok: boolean; at: number };
type G = typeof globalThis & { __repoAccess?: Map<string, Cached> };

async function verifyGithubAccess(connectionId: string, repo: RepoAccessRow): Promise<true | AccessDenied> {
  const cache = ((globalThis as G).__repoAccess ??= new Map());
  const key = `${connectionId}:${repo.id}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ACCESS_TTL_MS) return hit.ok ? true : "access_revoked";

  const fullName = repo.metadata?.fullName;
  if (!fullName) return "access_revoked";
  const token = await getConnectionToken(connectionId);
  if (!token) return "reauth_required";

  const result = await checkRepoAccess(fullName, token);
  if (result === "bad_token") return "reauth_required";
  if (result === "error") return hit?.ok ? true : "github_unavailable";
  cache.set(key, { ok: result === "ok", at: Date.now() });
  return result === "ok" ? true : "access_revoked";
}

export function forgetRepoAccess(connectionId: string) {
  const cache = (globalThis as G).__repoAccess;
  if (!cache) return;
  for (const key of cache.keys()) if (key.startsWith(`${connectionId}:`)) cache.delete(key);
}
