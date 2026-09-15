import * as vscode from "vscode";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { ApiError, CodebaseApi, type Project } from "./api";
import { getOriginUrl, normalizeGitHubRemote } from "./git";
import { AskPanel } from "./panel";

const EXTENSION_ID = "codebase-ai.codebase-ai";
const PROJECT_KEY = "codebaseAI.projectId"; // workspaceState: Codebase AI project linked to this window
const PENDING_SIGN_IN_KEY = "codebaseAI.pendingSignIn"; // globalState: CSRF state of an in-progress sign-in

let api: CodebaseApi;
let status: vscode.StatusBarItem;
let refreshTimer: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext) {
  api = new CodebaseApi(context.secrets);
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  context.subscriptions.push(status);

  const register = (id: string, fn: () => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, async () => {
      try {
        await fn();
      } catch (err) {
        showError(context, err);
      }
    }));

  register("codebaseAI.ask", () => ask(context));
  register("codebaseAI.signIn", () => signIn(context));
  register("codebaseAI.signOut", async () => {
    await api.signOut();
    void vscode.window.showInformationMessage("Signed out of Codebase AI.");
    await refreshStatus(context);
  });
  register("codebaseAI.connectGitHub", () =>
    vscode.env.openExternal(vscode.Uri.parse(`${api.serverUrl}/api/auth/github/login?returnTo=%2F`)));
  register("codebaseAI.selectRepository", () => selectRepository(context));
  register("codebaseAI.analyzeRepository", () => analyzeRepository(context));
  register("codebaseAI.reindexRepository", () => reindexRepository(context));
  register("codebaseAI.openDashboard", () => {
    const id = context.workspaceState.get<string>(PROJECT_KEY);
    return vscode.env.openExternal(vscode.Uri.parse(`${api.serverUrl}${id ? `/repo/${encodeURIComponent(id)}` : "/"}`));
  });

  context.subscriptions.push(
    vscode.window.registerUriHandler({ handleUri: (uri) => handleUri(context, uri).catch((err) => showError(context, err)) }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("codebaseAI.serverUrl")) void refreshStatus(context);
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void refreshStatus(context)),
  );

  void refreshStatus(context);

  // Minimal API used by the extension-host smoke test.
  return {
    linkedProjectId: () => context.workspaceState.get<string>(PROJECT_KEY),
    refresh: () => refreshStatus(context),
  };
}

export function deactivate() {
  if (refreshTimer) clearTimeout(refreshTimer);
}

/* --------------------------------- Authentication --------------------------------- */

async function signIn(context: vscode.ExtensionContext) {
  const state = crypto.randomBytes(24).toString("base64url");
  await context.globalState.update(PENDING_SIGN_IN_KEY, { state, expires: Date.now() + 10 * 60_000 });
  const query = new URLSearchParams({ state, redirect_uri: `${vscode.env.uriScheme}://${EXTENSION_ID}/auth` });
  await vscode.env.openExternal(vscode.Uri.parse(`${api.serverUrl}/extension/auth?${query}`));
  vscode.window.setStatusBarMessage("Codebase AI: finish signing in in your browser…", 15_000);
}

async function handleUri(context: vscode.ExtensionContext, uri: vscode.Uri) {
  const params = new URLSearchParams(uri.query);

  if (uri.path === "/auth") {
    const pending = context.globalState.get<{ state: string; expires: number }>(PENDING_SIGN_IN_KEY);
    const code = params.get("code");
    const state = params.get("state");
    if (!code || !state || !pending || pending.expires < Date.now() || pending.state !== state) {
      void vscode.window.showErrorMessage("This Codebase AI sign-in link wasn't started from VS Code or has expired. Run “Codebase AI: Sign In” again.");
      return;
    }
    await context.globalState.update(PENDING_SIGN_IN_KEY, undefined);
    const user = await api.exchangeCode(code, state);
    void vscode.window.showInformationMessage(`Signed in to Codebase AI as ${user.login}.`);
    await refreshStatus(context);
    return;
  }

  if (uri.path === "/project") {
    const id = params.get("id");
    if (!id || !/^[a-f0-9]{6,64}$/i.test(id)) {
      void vscode.window.showErrorMessage("Invalid Codebase AI project link.");
      return;
    }
    await openProject(context, id);
  }
}

/* ------------------------------ Projects & workspaces ------------------------------ */

const isAbsolutePath = (p: string) => /^([a-zA-Z]:[\\/]|\/)/.test(p);

function samePath(a: string, b: string) {
  const norm = (p: string) => (process.platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p));
  return norm(a) === norm(b);
}

async function remoteFullName(folder: vscode.WorkspaceFolder) {
  const remote = await getOriginUrl(folder.uri.fsPath);
  return remote ? normalizeGitHubRemote(remote) : null;
}

async function findMatchingFolder(project: Project) {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (isAbsolutePath(project.url) && samePath(folder.uri.fsPath, project.url)) return folder;
    const fullName = project.metadata?.fullName;
    if (fullName && (await remoteFullName(folder))?.toLowerCase() === fullName.toLowerCase()) return folder;
  }
  return undefined;
}

// Recognize the workspace automatically: same local path, or a GitHub-linked project for the folder's origin remote.
async function detectProject(folder: vscode.WorkspaceFolder) {
  const projects = await api.projects();
  const local = projects.find((p) => isAbsolutePath(p.url) && samePath(p.url, folder.uri.fsPath));
  if (local) return local;
  const fullName = await remoteFullName(folder);
  if (!fullName) return undefined;
  return projects.find((p) => p.metadata?.fullName?.toLowerCase() === fullName.toLowerCase() && p.status !== "error");
}

async function refreshStatus(context: vscode.ExtensionContext) {
  if (refreshTimer) clearTimeout(refreshTimer);
  const folder = vscode.workspace.workspaceFolders?.[0];
  status.show();
  try {
    let project: Project | undefined;
    const linked = context.workspaceState.get<string>(PROJECT_KEY);
    if (linked) {
      project = await api.project(linked).catch((err) => {
        if (err instanceof ApiError && err.status === 404) return undefined;
        throw err;
      });
      if (!project) await context.workspaceState.update(PROJECT_KEY, undefined);
    }
    if (!project && folder) {
      project = await detectProject(folder);
      if (project) await context.workspaceState.update(PROJECT_KEY, project.id);
    }

    if (!project) {
      status.text = "$(sparkle) Codebase AI";
      status.tooltip = folder ? "No Codebase AI project for this workspace — click to analyze it" : "Codebase AI — select a project";
      status.command = folder ? "codebaseAI.analyzeRepository" : "codebaseAI.selectRepository";
      return;
    }
    status.text = `$(${project.private ? "lock" : "sparkle"}) ${project.name.split("/").pop()} · ${project.status}`;
    status.tooltip = `Codebase AI: ${project.name}${project.private ? " (private)" : ""} — click to ask a question`;
    status.command = "codebaseAI.ask";
    if (project.status === "queued" || project.status === "indexing") {
      refreshTimer = setTimeout(() => void refreshStatus(context), 3000);
    }
  } catch (err) {
    const needsAuth = err instanceof ApiError && (err.status === 401 || err.status === 403);
    status.text = needsAuth ? "$(lock) Codebase AI: sign in" : "$(sparkle) Codebase AI: offline";
    status.tooltip = err instanceof Error ? err.message : String(err);
    status.command = needsAuth ? "codebaseAI.signIn" : "codebaseAI.openDashboard";
  }
}

async function pickFolder() {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length <= 1) return folders[0];
  return vscode.window.showWorkspaceFolderPick({ placeHolder: "Which folder should Codebase AI analyze?" });
}

async function analyzeRepository(context: vscode.ExtensionContext) {
  const folder = await pickFolder();
  if (!folder) {
    void vscode.window.showWarningMessage("Open a folder to analyze it with Codebase AI, or use “Codebase AI: Select Repository”.");
    return;
  }

  // Local workspace analysis is always available (no GitHub account needed). A GitHub remote adds a second option.
  let source: "local" | "github" = "local";
  const fullName = await remoteFullName(folder);
  if (fullName) {
    const session = await api.session().catch(() => null);
    const pick = await vscode.window.showQuickPick(
      [
        { label: "$(folder) Analyze this local workspace", description: "Includes uncommitted changes · no sign-in needed", value: "local" as const },
        {
          label: `$(github) Analyze ${fullName} from GitHub`,
          description: session?.user ? `Signed in as ${session.user.login}` : "Sign in required for private repositories",
          value: "github" as const,
        },
      ],
      { placeHolder: "What should Codebase AI index?" },
    );
    if (!pick) return;
    source = pick.value;
  }

  const { id } = source === "github" && fullName ? await api.analyzeGitHub(fullName) : await api.analyzeLocal(folder.uri.fsPath);
  await context.workspaceState.update(PROJECT_KEY, id);
  await refreshStatus(context);
  const next = await vscode.window.showInformationMessage("Codebase AI is indexing this repository…", "Open Dashboard");
  if (next) await vscode.commands.executeCommand("codebaseAI.openDashboard");
}

async function reindexRepository(context: vscode.ExtensionContext) {
  const id = context.workspaceState.get<string>(PROJECT_KEY);
  if (!id) {
    const pick = await vscode.window.showInformationMessage("This window isn't linked to a Codebase AI project yet.", "Analyze Repository", "Select Repository");
    if (pick === "Analyze Repository") await analyzeRepository(context);
    if (pick === "Select Repository") await selectRepository(context);
    return;
  }
  await api.reindex(id);
  void vscode.window.showInformationMessage("Codebase AI: re-indexing started.");
  await refreshStatus(context);
}

function timeAgo(date?: string | null) {
  if (!date) return "";
  const s = Math.max(0, (Date.now() - new Date(date).getTime()) / 1000);
  return s < 3600 ? `${Math.max(1, Math.round(s / 60))} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
}

async function selectRepository(context: vscode.ExtensionContext) {
  const [projects, session] = await Promise.all([api.projects(), api.session().catch(() => null)]);
  if (!projects.length) {
    const pick = await vscode.window.showInformationMessage("No Codebase AI projects yet.", "Analyze Repository", "Open Dashboard");
    if (pick === "Analyze Repository") await analyzeRepository(context);
    if (pick === "Open Dashboard") await vscode.commands.executeCommand("codebaseAI.openDashboard");
    return;
  }
  const pick = await vscode.window.showQuickPick(
    projects.map((p) => ({
      label: `$(${p.private ? "lock" : p.provider === "local" ? "folder" : "repo"}) ${p.name}`,
      description: `${p.status}${p.indexed_at ? ` · indexed ${timeAgo(p.indexed_at)}` : ""}`,
      detail: isAbsolutePath(p.url) ? p.url : p.metadata?.fullName ?? p.url,
      project: p,
    })),
    {
      placeHolder: session?.user ? `Codebase AI projects for ${session.user.login}` : "Codebase AI projects (sign in to include your private GitHub repositories)",
      matchOnDetail: true,
    },
  );
  if (!pick) return;
  await context.workspaceState.update(PROJECT_KEY, pick.project.id);
  await refreshStatus(context);
  const next = await vscode.window.showInformationMessage(`Codebase AI: this window is linked to ${pick.project.name}.`, "Ask a Question");
  if (next) await ask(context);
}

// Web → VS Code handoff (vscode://codebase-ai.codebase-ai/project?id=…)
async function openProject(context: vscode.ExtensionContext, id: string) {
  const project = await api.project(id);
  const folder = await findMatchingFolder(project);
  await context.workspaceState.update(PROJECT_KEY, project.id);
  await refreshStatus(context);

  if (folder) {
    const pick = await vscode.window.showInformationMessage(`Codebase AI: ${folder.name} is linked to ${project.name}.`, "Ask a Question", "Open Dashboard");
    if (pick === "Ask a Question") AskPanel.show(api, project, folder.uri.fsPath);
    if (pick === "Open Dashboard") await vscode.commands.executeCommand("codebaseAI.openDashboard");
    return;
  }

  const fullName = project.metadata?.fullName;
  const actions = [...(fullName ? ["Clone Repository"] : []), "Open Folder…", "Ask Without Local Copy"];
  const pick = await vscode.window.showInformationMessage(`Codebase AI project ${project.name} isn't open in this window.`, ...actions);
  // Cloning uses VS Code's Git integration and the developer's own Git credentials — never Codebase AI's GitHub token.
  if (pick === "Clone Repository" && fullName) await vscode.commands.executeCommand("git.clone", `https://github.com/${fullName}.git`);
  if (pick === "Open Folder…") await vscode.commands.executeCommand("vscode.openFolder");
  if (pick === "Ask Without Local Copy") AskPanel.show(api, project, null);
}

async function ask(context: vscode.ExtensionContext) {
  const id = context.workspaceState.get<string>(PROJECT_KEY);
  if (!id) {
    const pick = await vscode.window.showInformationMessage("Link this window to a Codebase AI project first.", "Analyze Repository", "Select Repository");
    if (pick === "Analyze Repository") await analyzeRepository(context);
    if (pick === "Select Repository") await selectRepository(context);
    return;
  }
  const project = await api.project(id);
  const folder = await findMatchingFolder(project);
  AskPanel.show(api, project, folder?.uri.fsPath ?? null);
}

function showError(context: vscode.ExtensionContext, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof ApiError && ["auth_required", "reauth_required", "access_revoked"].includes(err.code ?? "")) {
    void vscode.window.showErrorMessage(message, "Sign In").then((pick) => pick && signIn(context));
    return;
  }
  void vscode.window.showErrorMessage(`Codebase AI: ${message}`);
}
