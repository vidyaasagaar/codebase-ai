import { NextResponse } from "next/server";
import { searchGithubRepos, GithubError } from "@/lib/repository/github";

export const dynamic = "force-dynamic";

const LANGUAGES = new Set(["TypeScript", "JavaScript", "Python", "Java", "Go"]);

// GET /api/github/search?q=auth api&language=Python — real repositories from the GitHub search API.
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const language = sp.get("language") ?? "";
  try {
    return NextResponse.json(await searchGithubRepos(sp.get("q") ?? "", LANGUAGES.has(language) ? language : undefined));
  } catch (err) {
    if (err instanceof GithubError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Could not reach the GitHub API." }, { status: 502 });
  }
}
