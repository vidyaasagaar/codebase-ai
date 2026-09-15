import * as vscode from "vscode";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Runs inside a real VS Code extension host:
//   code --extensionDevelopmentPath=<extension> --extensionTestsPath=<extension>/out/test/smoke <workspace folder>
// Results are written to <tmp>/codebase-ai-smoke.json.
export async function run() {
  const results: { name: string; ok: boolean; detail?: string }[] = [];
  const check = (name: string, ok: boolean, detail?: string) => results.push({ name, ok, detail });

  try {
    const ext = vscode.extensions.getExtension("codebase-ai.codebase-ai");
    check("extension is installed", Boolean(ext));
    const api = (await ext!.activate()) as { linkedProjectId(): string | undefined; refresh(): Promise<void> };
    check("extension activates", Boolean(api));

    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      "codebaseAI.ask", "codebaseAI.signIn", "codebaseAI.signOut", "codebaseAI.connectGitHub",
      "codebaseAI.selectRepository", "codebaseAI.analyzeRepository", "codebaseAI.reindexRepository", "codebaseAI.openDashboard",
    ]) check(`command ${id} is registered`, commands.includes(id));

    await api.refresh();
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "(no folder)";
    const linked = api.linkedProjectId();
    check("workspace is linked to a Codebase AI project", Boolean(linked), `folder=${folder} linkedProject=${linked}`);
  } catch (err) {
    check("smoke test completed", false, err instanceof Error ? err.stack ?? err.message : String(err));
  }

  fs.writeFileSync(path.join(os.tmpdir(), "codebase-ai-smoke.json"), JSON.stringify(results, null, 2));
  if (results.some((r) => !r.ok)) throw new Error("Codebase AI smoke test failed");
}
