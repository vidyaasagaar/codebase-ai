import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { getConnectionToken } from "@/lib/auth/session";

// Repository sources make "where the code lives" available as a local directory for the existing
// discovery → parser → graph → embeddings pipeline. The core never talks to GitHub directly, so other
// providers (GitLab, Bitbucket, …) can be added as new sources.

export interface RepositorySource {
  kind: "local" | "git" | "github";
  /** Materializes the repository and returns the directory to index. */
  checkout(targetDir: string): Promise<string>;
}

export interface SourceRow {
  url: string;
  branch: string | null;
  provider: string | null;
  owner_connection_id: string | null;
}

export function isLocalPath(url: string) {
  return /^([a-zA-Z]:[\\/]|\/)/.test(url) && fs.existsSync(url);
}

export function run(cmd: string, args: string[], cwd?: string, env?: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", ...env } });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `${cmd} exited with ${code}`))));
  });
}

async function shallowClone(url: string, targetDir: string, branch: string | null, env?: Record<string, string>) {
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  // core.longpaths: deep repositories otherwise fail to check out on Windows (260-character path limit).
  await run("git", ["-c", "core.longpaths=true", "clone", "--depth", "1", ...(branch ? ["--branch", branch] : []), url, targetDir], undefined, env);
}

// Read-only GitHub credentials for a single git process, passed through git's environment config (git >= 2.31):
// never part of the clone URL, never written to .git/config, never in process arguments, and credential helpers
// are disabled so the token is not stored anywhere.
export function githubGitEnv(token: string): Record<string, string> {
  return {
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
    GIT_CONFIG_KEY_1: "credential.helper",
    GIT_CONFIG_VALUE_1: "",
  };
}

export function sourceFor(repo: SourceRow): RepositorySource {
  if (isLocalPath(repo.url)) {
    return { kind: "local", checkout: async () => repo.url };
  }
  if (repo.provider === "github" && repo.owner_connection_id) {
    const connectionId = repo.owner_connection_id;
    return {
      kind: "github",
      async checkout(targetDir) {
        const token = await getConnectionToken(connectionId);
        if (!token) throw new Error("GitHub access for this repository is no longer available. Reconnect GitHub, then re-index.");
        try {
          await shallowClone(repo.url, targetDir, repo.branch, githubGitEnv(token));
        } catch {
          throw new Error("Could not fetch the repository from GitHub. Codebase AI may no longer have access to it — reconnect GitHub or check the app installation.");
        }
        return targetDir;
      },
    };
  }
  return {
    kind: "git",
    async checkout(targetDir) {
      await shallowClone(repo.url, targetDir, repo.branch);
      return targetDir;
    },
  };
}
