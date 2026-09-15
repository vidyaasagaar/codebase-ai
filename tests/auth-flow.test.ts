import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Integration tests for GitHub-authorized access and the VS Code handoff, against an isolated database.
// The GitHub API is mocked: each fake token can access exactly the repositories listed in `githubAccess`.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "codebase-ai-test-"));
process.env.CODEBASE_AI_DATA_DIR = dataDir;
process.env.CODEBASE_AI_SECRET = "integration-test-secret";
process.env.GITHUB_CLIENT_ID = "test-client-id";
process.env.GITHUB_CLIENT_SECRET = "test-client-secret";

const githubAccess: Record<string, Record<string, number>> = {};
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const auth = new Headers(init?.headers).get("authorization") ?? "";
  if (url.startsWith("https://api.github.com/applications/")) return new Response(null, { status: 204 });
  if (url.startsWith("https://api.github.com/repos/")) {
    const fullName = decodeURIComponent(url.slice("https://api.github.com/repos/".length));
    const token = auth.replace(/^Bearer /, "");
    const status = githubAccess[token]?.[fullName] ?? 404;
    return new Response(JSON.stringify(status === 200 ? { full_name: fullName } : { message: "Not Found" }), { status });
  }
  throw new Error(`Unexpected network call in test: ${url}`);
}) as typeof fetch;

type Mods = {
  db: typeof import("../lib/db");
  session: typeof import("../lib/auth/session");
  access: typeof import("../lib/auth/access");
  repos: typeof import("../app/api/repositories/route");
  authorize: typeof import("../app/api/extension/authorize/route");
  token: typeof import("../app/api/extension/token/route");
  sessionRoute: typeof import("../app/api/auth/session/route");
  logout: typeof import("../app/api/auth/logout/route");
};
let m: Mods;

const BASE = "http://localhost:3000";
const request = (p: string, init: RequestInit = {}) => new Request(BASE + p, init);
const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
});

async function signIn(githubId: number, login: string) {
  const accessToken = `gho_fake_${login}`;
  const connectionId = await m.session.upsertConnection(
    { id: githubId, login, name: login, avatar_url: "" },
    { accessToken, refreshToken: null, expiresAt: null },
  );
  const token = await m.session.createSession(connectionId, "web");
  return { connectionId, accessToken, token, cookie: `${m.session.SESSION_COOKIE}=${token}` };
}

async function insertRepo(id: string, fullName: string, isPrivate: boolean, ownerConnectionId: string | null) {
  await m.db.query(
    `INSERT INTO repositories (id, name, url, status, provider, private, owner_connection_id, metadata)
     VALUES ($1, $2, $3, 'ready', 'github', $4, $5, $6)`,
    [id, fullName, `https://github.com/${fullName}`, isPrivate, ownerConnectionId, JSON.stringify({ fullName, private: isPrivate })],
  );
}

before(async () => {
  m = {
    db: await import("../lib/db"),
    session: await import("../lib/auth/session"),
    access: await import("../lib/auth/access"),
    repos: await import("../app/api/repositories/route"),
    authorize: await import("../app/api/extension/authorize/route"),
    token: await import("../app/api/extension/token/route"),
    sessionRoute: await import("../app/api/auth/session/route"),
    logout: await import("../app/api/auth/logout/route"),
  };
});

after(() => {
  globalThis.fetch = realFetch;
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // PGlite may still hold files open on Windows; the OS temp dir is cleaned up later.
  }
});

test("sessions work with cookie and bearer; secrets are stored only hashed or encrypted", async () => {
  const alice = await signIn(1001, "alice");
  assert.equal((await m.session.getAuth(request("/", { headers: { cookie: alice.cookie } })))?.login, "alice");
  assert.equal((await m.session.getAuth(request("/", { headers: { authorization: `Bearer ${alice.token}` } })))?.login, "alice");
  assert.equal(await m.session.getAuth(request("/", { headers: { authorization: "Bearer not-a-session" } })), null);

  const [conn] = await m.db.query<{ access_token_enc: string }>("SELECT access_token_enc FROM github_connections WHERE login = 'alice'");
  assert.ok(!conn.access_token_enc.includes(alice.accessToken), "GitHub token is encrypted at rest");
  const sessions = await m.db.query<{ token_hash: string }>("SELECT token_hash FROM sessions");
  assert.ok(sessions.every((s) => s.token_hash !== alice.token), "session tokens are stored as hashes");
});

test("private repositories: GitHub decides who can read them", async () => {
  const owner = await signIn(2001, "owner");
  const outsider = await signIn(2002, "outsider");
  const collaborator = await signIn(2003, "collaborator");
  await insertRepo("pub000000001", "acme/open", false, null);
  await insertRepo("prv000000001", "acme/secret", true, owner.connectionId);
  githubAccess[owner.accessToken] = { "acme/secret": 200 };
  githubAccess[collaborator.accessToken] = { "acme/secret": 200 };

  const check = async (repoId: string, headers: Record<string, string> = {}) => {
    const result = await m.access.authorizeRepo(request("/", { headers }), repoId);
    return result.ok ? 200 : result.response.status;
  };

  assert.equal(await check("pub000000001"), 200, "public repositories need no sign-in");
  assert.equal(await check("prv000000001"), 401, "private repositories require sign-in");
  assert.equal(await check("prv000000001", { cookie: owner.cookie }), 200);
  assert.equal(await check("prv000000001", { cookie: collaborator.cookie }), 200, "collaborators authorized by GitHub can read it");
  assert.equal(await check("prv000000001", { cookie: outsider.cookie }), 403, "users without GitHub access are rejected");

  // Access revoked on GitHub → detected once the short verification cache expires.
  githubAccess[owner.accessToken] = { "acme/secret": 404 };
  m.access.forgetRepoAccess(owner.connectionId);
  const revoked = await m.access.authorizeRepo(request("/", { headers: { cookie: owner.cookie } }), "prv000000001");
  assert.equal(revoked.ok, false);
  if (!revoked.ok) assert.equal((await revoked.response.json()).code, "access_revoked");

  // Expired / invalid GitHub token → reconnect required.
  githubAccess[collaborator.accessToken] = { "acme/secret": 401 };
  m.access.forgetRepoAccess(collaborator.connectionId);
  assert.equal(await check("prv000000001", { cookie: collaborator.cookie }), 401);
});

test("repository list only includes private repositories for their owner", async () => {
  const owner = await signIn(3001, "listowner");
  const other = await signIn(3002, "listother");
  await insertRepo("prv000000002", "acme/listed", true, owner.connectionId);

  const ids = async (cookie?: string) =>
    ((await (await m.repos.GET(request("/api/repositories", { headers: cookie ? { cookie } : {} }))).json()) as { id: string }[]).map((r) => r.id);

  assert.ok((await ids(owner.cookie)).includes("prv000000002"));
  assert.ok(!(await ids(other.cookie)).includes("prv000000002"));
  assert.ok(!(await ids()).includes("prv000000002"));
});

test("VS Code handoff: one-time code bound to state and the extension URI; GitHub token never exposed", async () => {
  const dev = await signIn(4001, "dev");
  const state = "state_abcdefghijklmnop";
  const redirectUri = "vscode://codebase-ai.codebase-ai/auth";
  const authorize = (body: unknown, headers: Record<string, string>) =>
    m.authorize.POST(request("/api/extension/authorize", json(body, headers)));

  assert.equal((await authorize({ state, redirectUri }, {})).status, 401, "requires a signed-in browser");
  assert.equal((await authorize({ state, redirectUri: "https://evil.example/auth" }, { cookie: dev.cookie })).status, 400);
  assert.equal((await authorize({ state, redirectUri }, { cookie: dev.cookie, origin: "https://evil.example" })).status, 403);

  const ok = await authorize({ state, redirectUri }, { cookie: dev.cookie });
  assert.equal(ok.status, 200);
  const redirectUrl = new URL(((await ok.json()) as { redirectUrl: string }).redirectUrl);
  assert.equal(`${redirectUrl.protocol}//${redirectUrl.host}${redirectUrl.pathname}`, redirectUri);
  const code = redirectUrl.searchParams.get("code")!;
  assert.equal(redirectUrl.searchParams.get("state"), state);

  const exchange = (body: unknown) => m.token.POST(request("/api/extension/token", json(body)));
  assert.equal((await exchange({ code, state: "state_wrongwrongwrong" })).status, 400, "state must match");
  const exchanged = await exchange({ code, state });
  assert.equal(exchanged.status, 200);
  const exchangedText = await exchanged.text();
  assert.ok(!exchangedText.includes(dev.accessToken), "GitHub token is never sent to the extension");
  const { token } = JSON.parse(exchangedText) as { token: string };
  assert.equal((await exchange({ code, state })).status, 400, "codes are single-use");

  const bearer = { authorization: `Bearer ${token}` };
  const me = await (await m.sessionRoute.GET(request("/api/auth/session", { headers: bearer }))).json();
  assert.equal(me.user.login, "dev");

  const expired = await m.session.createExtensionAuthCode(dev.connectionId, state);
  await m.db.query("UPDATE extension_auth_codes SET expires_at = now() - interval '1 minute'");
  assert.equal((await exchange({ code: expired, state })).status, 400, "expired codes are rejected");

  await m.logout.POST(request("/api/auth/logout", json({}, bearer)));
  const afterLogout = await (await m.sessionRoute.GET(request("/api/auth/session", { headers: bearer }))).json();
  assert.equal(afterLogout.user, null, "sign-out invalidates the extension token");
});

test("disconnecting GitHub removes the connection and every session", async () => {
  const user = await signIn(5001, "leaver");
  const second = await m.session.createSession(user.connectionId, "extension");
  const res = await m.logout.POST(request("/api/auth/logout", json({ disconnect: true }, { cookie: user.cookie })));
  assert.equal(((await res.json()) as { disconnected: boolean }).disconnected, true);
  assert.equal(await m.session.getAuth(request("/", { headers: { cookie: user.cookie } })), null);
  assert.equal(await m.session.getAuth(request("/", { headers: { authorization: `Bearer ${second}` } })), null);
  assert.equal((await m.db.query("SELECT 1 FROM github_connections WHERE login = 'leaver'")).length, 0);
});
