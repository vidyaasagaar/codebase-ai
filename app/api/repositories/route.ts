import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { createRepository, validateRepoUrl } from "@/lib/repository/ingest";
import { parseGithubUrl, getGithubRepo, GithubError, MAX_REPO_SIZE_KB } from "@/lib/repository/github";
import { getAuth, getConnectionToken } from "@/lib/auth/session";
import { deny } from "@/lib/auth/access";
import { githubAuthConfig } from "@/lib/auth/github-oauth";

export const dynamic = "force-dynamic";

// Private repositories are only listed for the GitHub connection that indexed them.
export async function GET(req: Request) {
  const auth = await getAuth(req);
  const repos = await query(
    `SELECT id, name, url, branch, commit_sha, status, stats, metadata, provider, private, indexed_at, created_at
     FROM repositories WHERE private = false OR owner_connection_id = $1 ORDER BY created_at DESC`,
    [auth?.connectionId ?? null],
  );
  return NextResponse.json(repos);
}

// Body: { url, branch? } (Git URL, GitHub URL or absolute local path) or { github: "owner/repo", branch? }.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { url?: string; branch?: string; github?: string };
  const url = body.url?.trim() || (body.github ? `https://github.com/${body.github.trim()}` : "");
  const branch = body.branch?.trim() || undefined;

  // GitHub repositories are validated against the GitHub API (exists, access, size, default branch). With a
  // signed-in GitHub connection this includes private and organization repositories the user is authorized for.
  const github = parseGithubUrl(url);
  if (github) {
    const auth = await getAuth(req);
    const token = auth ? await getConnectionToken(auth.connectionId) : null;
    if (auth && !token) return deny("reauth_required");
    try {
      const meta = await getGithubRepo(github.owner, github.repo, token ?? undefined);
      if (meta.sizeKb > MAX_REPO_SIZE_KB) {
        return NextResponse.json({ error: `${meta.fullName} is ${Math.round(meta.sizeKb / 1024)} MB — too large to index quickly (limit ${MAX_REPO_SIZE_KB / 1000} MB).` }, { status: 400 });
      }
      const id = await createRepository(meta.url, branch ?? github.branch ?? meta.defaultBranch, meta, auth?.connectionId);
      return NextResponse.json({ id }, { status: 201 });
    } catch (err) {
      if (err instanceof GithubError) {
        if (err.status === 401 && auth) return deny("reauth_required");
        const hint = err.status === 404 && !auth && githubAuthConfig() ? " Private repository? Continue with GitHub first." : "";
        return NextResponse.json({ error: err.message + hint }, { status: err.status });
      }
      throw err;
    }
  }

  const invalid = validateRepoUrl(url);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
  const id = await createRepository(url, branch);
  return NextResponse.json({ id }, { status: 201 });
}
