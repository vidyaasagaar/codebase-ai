"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, LogOut, Unplug } from "lucide-react";
import { api, githubLoginUrl, type SessionInfo } from "@/lib/client";

export function useSession() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const reload = useCallback(() => {
    api<SessionInfo>("/api/auth/session")
      .then(setSession)
      .catch(() => setSession({ user: null, githubConfigured: false, installUrl: null }));
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { session, reload };
}

export function GithubMark({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className} fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

export function ContinueWithGithub({ returnTo, className = "" }: { returnTo: string; className?: string }) {
  return (
    <a href={githubLoginUrl(returnTo)}
      className={`inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-panel px-3 py-1.5 text-sm font-medium hover:border-accent ${className}`}>
      <GithubMark /> Continue with GitHub
    </a>
  );
}

// Header control: "Continue with GitHub" when signed out, account menu when signed in. Hidden when GitHub
// sign-in is not configured — local and public repositories keep working without it.
export function GithubAccount({ session, onChange, returnTo = "/" }: { session: SessionInfo | null; onChange: () => void; returnTo?: string }) {
  const [busy, setBusy] = useState(false);
  if (!session?.githubConfigured) return null;
  if (!session.user) return <ContinueWithGithub returnTo={returnTo} />;

  const signOut = async (disconnect: boolean) => {
    if (disconnect && !confirm("Disconnect GitHub? Codebase AI will revoke its GitHub token and sign out everywhere, including VS Code.")) return;
    setBusy(true);
    await api("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ disconnect }) }).catch(() => {});
    setBusy(false);
    onChange();
  };

  return (
    <details className="relative">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg border border-border bg-panel px-2 py-1 text-sm [&::-webkit-details-marker]:hidden">
        {session.user.avatarUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={session.user.avatarUrl} alt="" className="size-5 rounded-full" />
          : <GithubMark />}
        <span className="font-mono text-xs">{session.user.login}</span>
      </summary>
      <div className="absolute right-0 z-30 mt-1 w-60 rounded-lg border border-border bg-panel p-1 text-sm shadow-lg">
        <div className="px-2 py-1.5 text-xs text-muted">Signed in with GitHub · read-only repository access</div>
        {session.installUrl && (
          <a href={session.installUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-panel-2">
            <ExternalLink className="size-3.5" /> Manage repository access
          </a>
        )}
        <button disabled={busy} onClick={() => signOut(false)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-panel-2">
          <LogOut className="size-3.5" /> Sign out
        </button>
        <button disabled={busy} onClick={() => signOut(true)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-danger hover:bg-panel-2">
          <Unplug className="size-3.5" /> Disconnect GitHub
        </button>
      </div>
    </details>
  );
}
