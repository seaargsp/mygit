import * as vscode from 'vscode';
import { createGitClientPanel, restoreGitClientPanel, reloadGitClientPanels, GIT_CLIENT_VIEW_TYPE } from './panel/GitClientPanel';
import { isSourceCheckout, watchBuildOutput } from './devReload';
import { setGitBinaryPath } from './git/gitService';
import { listBranches, listTags, createTag, deleteTag } from './git/refs';
import { getCommitLog, assignLanes } from './git/graph';
import { getCommitDetail, commit } from './git/commit';
import { getCommitFileDiff, getWorkingFileDiff } from './git/diff';
import { revertCommit, resetTo, mergeRef } from './git/history';
import { getWorkingTreeStatus, stageFile, unstageFile, discardFile } from './git/status';
import { checkoutBranch, createBranch, deleteBranch, fetch, pull, push } from './git/remote';
import type { GitApi } from './panel/state';

const gitApi: GitApi = {
  listBranches,
  listTags,
  getCommitLog: async (repoPath, opts) => assignLanes(await getCommitLog(repoPath, opts)),
  getCommitDetail,
  getCommitFileDiff,
  getWorkingFileDiff,
  getWorkingTreeStatus,
  stageFile,
  unstageFile,
  discardFile,
  commit,
  checkoutBranch,
  createBranch,
  deleteBranch,
  mergeRef,
  createTag,
  deleteTag,
  revertCommit,
  resetTo,
  fetch,
  pull,
  push,
};

export function activate(context: vscode.ExtensionContext): void {
  const gitExtension = vscode.extensions.getExtension('vscode.git');
  if (gitExtension?.exports) {
    setGitBinaryPath(gitExtension.exports.getAPI(1).git.path);
  }

  const disposable = vscode.commands.registerCommand('gitClient.open', () => {
    const repoPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!repoPath) {
      vscode.window.showInformationMessage('Git Client: open a folder with a Git repository first.');
      return;
    }
    createGitClientPanel(context, repoPath, gitApi);
  });
  context.subscriptions.push(disposable);

  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(GIT_CLIENT_VIEW_TYPE, {
      async deserializeWebviewPanel(panel) {
        const repoPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!repoPath) {
          panel.dispose();
          return;
        }
        restoreGitClientPanel(context, panel, repoPath, gitApi);
      },
    })
  );

  if (isSourceCheckout(context)) watchBuildOutput(context, reloadGitClientPanels);
}

export function deactivate(): void {}
