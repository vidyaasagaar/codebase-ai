import { before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Hosted previews (serverless) must answer cleanly instead of failing: no indexing, readable errors, empty lists.

process.env.CODEBASE_AI_MODE = "hosted";
process.env.CODEBASE_AI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "codebase-ai-hosted-"));
process.env.CODEBASE_AI_SECRET = "hosted-test-secret";

let repos: typeof import("../app/api/repositories/route");
let repo: typeof import("../app/api/repositories/[id]/route");
let reindex: typeof import("../app/api/repositories/[id]/index/route");
let caps: typeof import("../app/api/capabilities/route");

before(async () => {
  repos = await import("../app/api/repositories/route");
  repo = await import("../app/api/repositories/[id]/route");
  reindex = await import("../app/api/repositories/[id]/index/route");
  caps = await import("../app/api/capabilities/route");
});

const request = (p: string, init: RequestInit = {}) => new Request(`http://localhost:3000${p}`, init);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

test("hosted previews report that indexing is unavailable", async () => {
  const body = (await (await caps.GET()).json()) as { indexing: boolean; reason: string };
  assert.equal(body.indexing, false);
  assert.match(body.reason, /indexing isn't available/i);
});

test("creating or re-indexing a repository returns a clear 503 instead of crashing", async () => {
  const created = await repos.POST(request("/api/repositories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://github.com/acme/app" }),
  }));
  assert.equal(created.status, 503);
  assert.equal(((await created.json()) as { code: string }).code, "indexing_unavailable");

  const reindexed = await reindex.POST(request("/api/repositories/abcdef123456/index", { method: "POST" }), ctx("abcdef123456"));
  assert.equal(reindexed.status, 503);
});

test("read endpoints keep responding normally", async () => {
  const list = await repos.GET(request("/api/repositories"));
  assert.equal(list.status, 200);
  assert.deepEqual(await list.json(), []);

  const missing = await repo.GET(request("/api/repositories/abcdef123456"), ctx("abcdef123456"));
  assert.equal(missing.status, 404);
  assert.equal(((await missing.json()) as { error: string }).error, "Repository not found");
});

test("account features stay off without touching storage", async () => {
  const token = await import("../app/api/extension/token/route");
  const exchanged = await token.POST(request("/api/extension/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "code", state: "state" }),
  }));
  assert.equal(exchanged.status, 503);

  const session = await import("../lib/auth/session");
  assert.equal(await session.getAuth(request("/", { headers: { authorization: "Bearer anything" } })), null);
});
