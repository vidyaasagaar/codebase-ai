import { execFile } from "node:child_process";

// GitHub remote → "owner/repo". Supports git@github.com:owner/repo.git, ssh://git@github.com/owner/repo.git,
// https://github.com/owner/repo(.git) and https URLs with embedded credentials (which are discarded).
export function normalizeGitHubRemote(remote: string): string | null {
  const m = remote
    .trim()
    .match(/^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https?:\/\/(?:[^@/]+@)?(?:www\.)?github\.com\/|git:\/\/github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}` : null;
}

// Read-only lookup of the workspace's origin remote. Never modifies the user's git configuration.
export function getOriginUrl(folder: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", ["config", "--get", "remote.origin.url"], { cwd: folder, timeout: 5000, windowsHide: true }, (err, stdout) =>
      resolve(err ? null : stdout.trim() || null),
    );
  });
}
