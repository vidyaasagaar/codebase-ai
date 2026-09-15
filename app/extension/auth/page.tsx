"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Boxes, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { ContinueWithGithub, useSession } from "@/components/auth/github-account";
import { api } from "@/lib/client";

export default function ExtensionAuthPage() {
  return <Suspense><ExtensionAuth /></Suspense>;
}

// Browser half of "Codebase AI: Sign In" from VS Code. After an explicit click, the server issues a one-time code
// that is delivered only to the Codebase AI extension's vscode:// URI handler.
function ExtensionAuth() {
  const params = useSearchParams();
  const state = params.get("state") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const { session } = useSession();
  const [status, setStatus] = useState<"idle" | "working" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const valid = /^[\w-]{16,128}$/.test(state) && /^(vscode|vscode-insiders):\/\/codebase-ai\.codebase-ai\/auth$/.test(redirectUri);
  const returnTo = `/extension/auth?${new URLSearchParams({ state, redirect_uri: redirectUri })}`;

  async function authorize() {
    setStatus("working");
    setError(null);
    try {
      const { redirectUrl } = await api<{ redirectUrl: string }>("/api/extension/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state, redirectUri }),
      });
      setLink(redirectUrl);
      setStatus("done");
      window.location.href = redirectUrl;
    } catch (err) {
      setError((err as Error).message);
      setStatus("idle");
    }
  }

  return (
    <main className="mx-auto w-full max-w-md px-4 py-16 sm:py-24">
      <div className="flex items-center gap-2 text-sm font-semibold tracking-wide">
        <Boxes className="size-5 text-accent" /> CODEBASE AI
      </div>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">Connect VS Code</h1>

      <div className="mt-6 rounded-xl border border-border bg-panel p-5">
        {!valid ? (
          <p className="text-sm text-danger">This sign-in link is invalid. Run <span className="font-mono">Codebase AI: Sign In</span> in VS Code to start again.</p>
        ) : !session ? (
          <Loader2 className="size-4 animate-spin text-muted" />
        ) : !session.githubConfigured ? (
          <p className="text-sm text-muted">GitHub sign-in isn&apos;t configured on this Codebase AI server. Local workspace analysis in VS Code works without signing in.</p>
        ) : !session.user ? (
          <>
            <p className="text-sm text-muted">Sign in to Codebase AI to use your GitHub-linked projects in VS Code.</p>
            <ContinueWithGithub returnTo={returnTo} className="mt-4 w-full py-2" />
          </>
        ) : status === "done" ? (
          <div className="text-sm">
            <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="size-4 text-ok" /> Opening VS Code…</p>
            <p className="mt-2 text-muted">You can close this tab. If VS Code didn&apos;t open, <a href={link ?? "#"} className="text-accent underline">click here</a>.</p>
          </div>
        ) : (
          <>
            <p className="text-sm">Signed in as <span className="font-mono">{session.user.login}</span>.</p>
            <ul className="mt-3 space-y-1.5 text-xs text-muted">
              <li className="flex gap-2"><ShieldCheck className="size-3.5 shrink-0 text-ok" /> VS Code receives a Codebase AI session token, stored in VS Code SecretStorage.</li>
              <li className="flex gap-2"><ShieldCheck className="size-3.5 shrink-0 text-ok" /> Your GitHub token stays on the Codebase AI server; repository access is read-only.</li>
            </ul>
            <button onClick={authorize} disabled={status === "working"}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {status === "working" && <Loader2 className="size-4 animate-spin" />} Authorize VS Code
            </button>
            {error && <p className="mt-2 text-sm text-danger">{error}</p>}
          </>
        )}
      </div>
    </main>
  );
}
