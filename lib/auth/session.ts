import type { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { encrypt, decrypt, randomToken, sha256 } from "./crypto";
import { refreshAccessToken, type GithubUser, type TokenSet } from "./github-oauth";

// Server-managed sessions. The browser holds an httpOnly cookie; the VS Code extension holds a bearer token in
// SecretStorage. Both are random tokens stored here only as SHA-256 hashes. GitHub tokens never leave the server.

export const SESSION_COOKIE = "cbai_session";
export const STATE_COOKIE = "cbai_oauth_state";
export const EXTENSION_ID = "codebase-ai.codebase-ai";

const DAY = 86_400;
const SESSION_TTL = { web: 7 * DAY, extension: 30 * DAY } as const;
const AUTH_CODE_TTL_SECONDS = 300;

export type SessionKind = keyof typeof SESSION_TTL;

export interface Auth {
  connectionId: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  kind: SessionKind;
  tokenHash: string;
}

export function readCookie(req: Request, name: string) {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export async function getAuth(req: Request): Promise<Auth | null> {
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const [row] = await query<{ token_hash: string; kind: SessionKind; connection_id: string; login: string; name: string | null; avatar_url: string | null }>(
    `SELECT s.token_hash, s.kind, c.id AS connection_id, c.login, c.name, c.avatar_url
     FROM sessions s JOIN github_connections c ON c.id = s.connection_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(token)],
  );
  if (!row) return null;
  return { connectionId: row.connection_id, login: row.login, name: row.name, avatarUrl: row.avatar_url, kind: row.kind, tokenHash: row.token_hash };
}

export async function upsertConnection(user: GithubUser, tokens: TokenSet): Promise<string> {
  const [row] = await query<{ id: string }>(
    `INSERT INTO github_connections (id, github_user_id, login, name, avatar_url, access_token_enc, refresh_token_enc, token_expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (github_user_id) DO UPDATE SET
       login = EXCLUDED.login, name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url,
       access_token_enc = EXCLUDED.access_token_enc, refresh_token_enc = EXCLUDED.refresh_token_enc,
       token_expires_at = EXCLUDED.token_expires_at, updated_at = now()
     RETURNING id`,
    [
      randomToken(9), user.id, user.login, user.name, user.avatar_url, encrypt(tokens.accessToken),
      tokens.refreshToken ? encrypt(tokens.refreshToken) : null, tokens.expiresAt?.toISOString() ?? null,
    ],
  );
  return row.id;
}

export async function createSession(connectionId: string, kind: SessionKind) {
  const token = randomToken(32);
  await query(
    `INSERT INTO sessions (token_hash, connection_id, kind, expires_at) VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
    [sha256(token), connectionId, kind, SESSION_TTL[kind]],
  );
  return token;
}

export async function deleteSession(tokenHash: string) {
  await query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
}

export function setSessionCookie(res: NextResponse, req: Request, token: string) {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: new URL(req.url).protocol === "https:", path: "/", maxAge: SESSION_TTL.web,
  });
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
}

type G = typeof globalThis & { __tokenRefresh?: Map<string, Promise<string | null>> };

// Returns a usable GitHub access token for the connection, refreshing expiring GitHub App user tokens.
export async function getConnectionToken(connectionId: string): Promise<string | null> {
  const [c] = await query<{ access_token_enc: string; refresh_token_enc: string | null; token_expires_at: Date | string | null }>(
    "SELECT access_token_enc, refresh_token_enc, token_expires_at FROM github_connections WHERE id = $1",
    [connectionId],
  );
  if (!c) return null;
  const expiresAt = c.token_expires_at ? new Date(c.token_expires_at).getTime() : null;
  if (!expiresAt || expiresAt - Date.now() > 60_000) return decrypt(c.access_token_enc);
  if (!c.refresh_token_enc) return null;

  // Refresh tokens are single-use: share one in-flight refresh per connection.
  const g = globalThis as G;
  const inflight = (g.__tokenRefresh ??= new Map());
  if (!inflight.has(connectionId)) {
    inflight.set(connectionId, (async () => {
      try {
        const tokens = await refreshAccessToken(decrypt(c.refresh_token_enc!));
        await query(
          "UPDATE github_connections SET access_token_enc = $2, refresh_token_enc = $3, token_expires_at = $4, updated_at = now() WHERE id = $1",
          [connectionId, encrypt(tokens.accessToken), tokens.refreshToken ? encrypt(tokens.refreshToken) : c.refresh_token_enc, tokens.expiresAt?.toISOString() ?? null],
        );
        return tokens.accessToken;
      } catch {
        return null;
      } finally {
        inflight.delete(connectionId);
      }
    })());
  }
  return inflight.get(connectionId)!;
}

/* ------------------------------- Redirect safety ------------------------------- */

// Only same-origin relative paths may be used after sign-in (prevents open redirects).
export function sanitizeReturnTo(value: string | null | undefined) {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : "/";
}

// One-time codes are only ever delivered to the Codebase AI extension's own URI handler.
export function isAllowedEditorRedirect(uri: string) {
  return new RegExp(`^(vscode|vscode-insiders)://${EXTENSION_ID.replace(".", "\\.")}/auth$`).test(uri);
}

/* ------------------------ VS Code one-time authorization codes ------------------------ */

export async function createExtensionAuthCode(connectionId: string, state: string) {
  const code = randomToken(32);
  await query(
    `INSERT INTO extension_auth_codes (code_hash, connection_id, state, expires_at) VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
    [sha256(code), connectionId, state, AUTH_CODE_TTL_SECONDS],
  );
  return code;
}

// Atomically consumes a code: valid once, before expiry, and only with the state the extension generated.
export async function redeemExtensionAuthCode(code: string, state: string) {
  const [row] = await query<{ connection_id: string }>(
    `UPDATE extension_auth_codes SET used_at = now()
     WHERE code_hash = $1 AND state = $2 AND used_at IS NULL AND expires_at > now()
     RETURNING connection_id`,
    [sha256(code), state],
  );
  return row?.connection_id ?? null;
}
