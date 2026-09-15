// Server-side GitHub sign-in (web application flow).
// Intended for a GitHub App with read-only repository permissions (Contents: read, Metadata: read), so Codebase AI
// can read private repositories without being able to push, delete or change settings. Tokens never reach the browser.

const GITHUB = "https://github.com";
const API = "https://api.github.com";

export function githubAuthConfig() {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    callbackUrl: process.env.GITHUB_CALLBACK_URL || null,
    // Only for classic OAuth Apps. GitHub Apps ignore scopes and use their configured permissions.
    scopes: process.env.GITHUB_OAUTH_SCOPES || null,
  };
}

export function githubInstallUrl() {
  const slug = process.env.GITHUB_APP_SLUG;
  return slug ? `https://github.com/apps/${encodeURIComponent(slug)}/installations/new` : null;
}

export function callbackUrl(origin: string) {
  return githubAuthConfig()?.callbackUrl ?? `${origin}/api/auth/github/callback`;
}

export function authorizeUrl(origin: string, state: string) {
  const cfg = githubAuthConfig();
  if (!cfg) throw new Error("GitHub sign-in is not configured.");
  const params = new URLSearchParams({ client_id: cfg.clientId, redirect_uri: callbackUrl(origin), state, allow_signup: "true" });
  if (cfg.scopes) params.set("scope", cfg.scopes);
  return `${GITHUB}/login/oauth/authorize?${params}`;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenSet> {
  const cfg = githubAuthConfig();
  if (!cfg) throw new Error("GitHub sign-in is not configured.");
  const res = await fetch(`${GITHUB}/login/oauth/access_token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...body }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, string | number | undefined>;
  if (!res.ok || json.error || !json.access_token) {
    throw new Error(String(json.error_description ?? json.error ?? `GitHub token exchange failed (${res.status})`));
  }
  return {
    accessToken: String(json.access_token),
    refreshToken: json.refresh_token ? String(json.refresh_token) : null,
    expiresAt: json.expires_in ? new Date(Date.now() + Number(json.expires_in) * 1000) : null,
  };
}

export const exchangeCode = (code: string, redirectUri: string) => tokenRequest({ code, redirect_uri: redirectUri });

export const refreshAccessToken = (refreshToken: string) =>
  tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });

export interface GithubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
}

export async function fetchGithubUser(token: string): Promise<GithubUser> {
  const res = await fetch(`${API}/user`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "codebase-ai",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Could not load the GitHub profile (${res.status}).`);
  return res.json() as Promise<GithubUser>;
}

// Best-effort revocation when the user disconnects GitHub, so the stored token cannot be reused.
export async function revokeToken(token: string) {
  const cfg = githubAuthConfig();
  if (!cfg) return;
  await fetch(`${API}/applications/${encodeURIComponent(cfg.clientId)}/token`, {
    method: "DELETE",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/json",
      "User-Agent": "codebase-ai",
    },
    body: JSON.stringify({ access_token: token }),
  }).catch(() => undefined);
}
