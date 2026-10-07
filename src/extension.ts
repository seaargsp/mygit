import * as vscode from 'vscode';
import { ClientPanel, GIT_CLIENT_VIEW_TYPE } from './panel/GitClientPanel';
import { LauncherView, LAUNCHER_VIEW_ID } from './panel/launcher';
import { ActivityLog } from './panel/activityLog';
import { RevisionContentProvider, REVISION_SCHEME } from './panel/revisionContent';
import { RepositoryController } from './controller';
import { registerCommands } from './commands';
import { isSourceCheckout, watchBuildOutput } from './devReload';
import { resolveRepoRoot, setGitBinaryPath, setGitTimeout } from './git/gitService';
import { getGitDir } from './git/repoState';

let controller: RepositoryController | undefined;

/** First workspace folder that is inside a Git repository: exactly one repository is active. */
async function findRepository(): Promise<string | undefined> {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const root = await resolveRepoRoot(folder.uri.fsPath);
    if (root) return root;
  }
  return undefined;
}

/**
 * Uses the git binary vscode.git resolved (git.path or its own search). Its `exports` getter
 * throws until vscode.git has activated, and `getAPI` throws when git.enabled is off or no git
 * was found; git from PATH stays in use until then, or for good.
 */
function useBuiltinGitPath(): void {
  const gitExtension = vscode.extensions.getExtension('vscode.git');
  if (!gitExtension) return;
  const apply = () => {
    try {
      const gitPath = gitExtension.exports?.getAPI?.(1)?.git?.path;
      if (gitPath) setGitBinaryPath(gitPath);
    } catch {
      // No git model: PATH lookup.
    }
  };
  if (gitExtension.isActive) apply();
  else void Promise.resolve(gitExtension.activate()).then(apply, () => undefined);
}

export function activate(context: vscode.ExtensionContext): void {
  useBuiltinGitPath();
  const applyTimeout = () => setGitTimeout(vscode.workspace.getConfiguration('mygit').get<number>('gitTimeout', 300) * 1000);
  applyTimeout();
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('mygit.gitTimeout')) applyTimeout();
  }));

  const log = new ActivityLog();
  context.subscriptions.push(log);

  const launcher = new LauncherView(() => controller?.openPanel());
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(LAUNCHER_VIEW_ID, launcher));
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(REVISION_SCHEME, new RevisionContentProvider()));

  registerCommands(context, () => controller);

  // Panels restored before the repository resolves draw their shell (and the last snapshot) at
  // once and attach when it resolves.
  const ready = (async () => {
    const repoPath = await findRepository();
    if (!repoPath) {
      log.application('No Git repository in the workspace');
      launcher.update({ repoName: null, branch: null, changes: 0 });
      return;
    }
    controller = new RepositoryController(context, repoPath, await getGitDir(repoPath), log, launcher);
    context.subscriptions.push(controller);
  })();

  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(GIT_CLIENT_VIEW_TYPE, {
      async deserializeWebviewPanel(panel) {
        ClientPanel.prepare(panel, context.extensionUri);
        void ready.then(() => {
          if (controller) controller.restorePanel(panel);
          else panel.dispose();
        });
      },
    })
  );

  if (isSourceCheckout(context)) watchBuildOutput(context, () => controller?.reloadPanel());
}

export function deactivate(): void {
  controller = undefined;
}
