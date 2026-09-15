import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAuth, getConnectionToken } from "@/lib/auth/session";
import { deny } from "@/lib/auth/access";
import { githubInstallUrl } from "@/lib/auth/github-oauth";
import { GithubError, listAccessibleRepos } from "@/lib/repository/github";

export const dynamic = "force-dynamic";

// GET /api/github/repositories — repositories the signed-in GitHub user is authorized to access
// (personal, organization and collaborator; public and private), with their Codebase AI index status.
export async function GET(req: Request) {
  const auth = await getAuth(req);
  if (!auth) return NextResponse.json({ error: "Continue with GitHub to see your repositories.", code: "auth_required" }, { status: 401 });
  const token = await getConnectionToken(auth.connectionId);
  if (!token) return deny("reauth_required");

  try {
    const { repos, installations } = await listAccessibleRepos(token);
    const projects = repos.length
      ? await query<{ id: string; provider_repository_id: string; status: string; indexed_at: string | null }>(
          `SELECT DISTINCT ON (provider_repository_id) id, provider_repository_id, status, indexed_at FROM repositories
           WHERE provider = 'github' AND provider_repository_id = ANY($1::text[])
             AND (private = false OR owner_connection_id = $2)
           ORDER BY provider_repository_id, created_at DESC`,
          [repos.map((r) => String(r.id)), auth.connectionId],
        )
      : [];
    const byRepo = new Map(projects.map((p) => [p.provider_repository_id, p]));
    return NextResponse.json({
      repos: repos.map((r) => {
        const p = byRepo.get(String(r.id));
        return { ...r, project: p ? { id: p.id, status: p.status, indexedAt: p.indexed_at } : null };
      }),
      installations,
      installUrl: githubInstallUrl(),
    });
  } catch (err) {
    if (err instanceof GithubError) {
      if (err.status === 401) return deny("reauth_required");
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
