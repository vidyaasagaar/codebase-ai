import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGithubUrl } from "../lib/repository/github";
import { normalizeGitHubRemote } from "../extension/src/git";

test("parseGithubUrl accepts common GitHub URL forms", () => {
  assert.deepEqual(parseGithubUrl("https://github.com/acme/backend"), { owner: "acme", repo: "backend", branch: undefined });
  assert.deepEqual(parseGithubUrl("https://github.com/acme/backend.git"), { owner: "acme", repo: "backend", branch: undefined });
  assert.deepEqual(parseGithubUrl("https://github.com/acme/backend/tree/release/v2"), { owner: "acme", repo: "backend", branch: "release/v2" });
  assert.deepEqual(parseGithubUrl("git@github.com:acme/my.repo.git"), { owner: "acme", repo: "my.repo", branch: undefined });
});

test("parseGithubUrl rejects non-GitHub or malformed URLs", () => {
  assert.equal(parseGithubUrl("https://gitlab.com/acme/backend"), null);
  assert.equal(parseGithubUrl("https://github.com/acme"), null);
  assert.equal(parseGithubUrl("https://github.com.evil.com/acme/backend"), null);
});

test("normalizeGitHubRemote handles SSH, HTTPS and embedded credentials", () => {
  assert.equal(normalizeGitHubRemote("git@github.com:acme/backend.git"), "acme/backend");
  assert.equal(normalizeGitHubRemote("https://github.com/acme/backend.git"), "acme/backend");
  assert.equal(normalizeGitHubRemote("https://github.com/acme/backend"), "acme/backend");
  assert.equal(normalizeGitHubRemote("ssh://git@github.com/acme/backend.git"), "acme/backend");
  assert.equal(normalizeGitHubRemote("https://user:ghp_secret@github.com/acme/backend.git"), "acme/backend");
  assert.equal(normalizeGitHubRemote("git@gitlab.com:acme/backend.git"), null);
  assert.equal(normalizeGitHubRemote("/home/me/projects/backend"), null);
});
