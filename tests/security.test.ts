import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { decrypt, encrypt } from "../lib/auth/crypto";
import { isAllowedEditorRedirect, sanitizeReturnTo } from "../lib/auth/session";
import { githubGitEnv } from "../lib/repository/sources";

const key = crypto.randomBytes(32);

test("token encryption round-trips and never contains the plaintext", () => {
  const token = "ghu_example_token_value";
  const a = encrypt(token, key);
  const b = encrypt(token, key);
  assert.equal(decrypt(a, key), token);
  assert.notEqual(a, b, "each encryption uses a fresh IV");
  assert.ok(!a.includes(token));
});

test("tampered ciphertext or a wrong key is rejected", () => {
  const payload = encrypt("secret", key);
  const parts = payload.split(".");
  parts[3] = Buffer.from("tampered").toString("base64url");
  assert.throws(() => decrypt(parts.join("."), key));
  assert.throws(() => decrypt(payload, crypto.randomBytes(32)));
});

test("sign-in return paths cannot redirect off-site", () => {
  assert.equal(sanitizeReturnTo("/repo/abc?x=1"), "/repo/abc?x=1");
  assert.equal(sanitizeReturnTo("//evil.example/path"), "/");
  assert.equal(sanitizeReturnTo("https://evil.example"), "/");
  assert.equal(sanitizeReturnTo("/\\evil.example"), "/");
  assert.equal(sanitizeReturnTo(null), "/");
});

test("VS Code auth codes are only delivered to the Codebase AI extension URI", () => {
  assert.ok(isAllowedEditorRedirect("vscode://codebase-ai.codebase-ai/auth"));
  assert.ok(isAllowedEditorRedirect("vscode-insiders://codebase-ai.codebase-ai/auth"));
  assert.ok(!isAllowedEditorRedirect("vscode://evil.extension/auth"));
  assert.ok(!isAllowedEditorRedirect("vscode://codebase-ai.codebase-ai/auth/../steal"));
  assert.ok(!isAllowedEditorRedirect("https://codebase-ai.codebase-ai/auth"));
  assert.ok(!isAllowedEditorRedirect("vscode://codebase-aiXcodebase-ai/auth"));
});

test("git clone credentials are passed via environment config, not URL or arguments", () => {
  const env = githubGitEnv("ghu_secret");
  assert.equal(env.GIT_CONFIG_KEY_0, "http.https://github.com/.extraheader");
  assert.match(env.GIT_CONFIG_VALUE_0, /^AUTHORIZATION: basic /);
  assert.ok(!env.GIT_CONFIG_VALUE_0.includes("ghu_secret"), "token is base64-encoded inside the header");
  assert.equal(Buffer.from(env.GIT_CONFIG_VALUE_0.split(" ").pop()!, "base64").toString(), "x-access-token:ghu_secret");
  assert.equal(env.GIT_CONFIG_KEY_1, "credential.helper");
  assert.equal(env.GIT_CONFIG_VALUE_1, "", "credential helpers are disabled so the token is never stored");
});
