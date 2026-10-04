import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import type { RepositoryController } from './controller';
import type { WebviewAction, WebviewToExtensionMessage } from './panel/messages';
import { listAllFiles } from './git/status';
import { runGit } from './git/gitService';
import { setHooksPath } from './git/repoState';

type CommandSpec = {
  id: string;
  title: string;
  run: (controller: RepositoryController) => unknown;
  /** Hidden from the in-client palette (keybinding forwarders). */
  palette?: boolean;
};

const op = (message: WebviewToExtensionMessage) => (controller: RepositoryController) => controller.dispatch(message);
const action = (name: WebviewAction) => (controller: RepositoryController) => controller.post(name);

async function pickFile(controller: RepositoryController, title: string): Promise<string | undefined> {
  const files = await listAllFiles(controller.repoPath, 'working-tree');
  return vscode.window.showQuickPick(files, { title, matchOnDescription: true });
}

export const COMMANDS: CommandSpec[] = [
  { id: 'mygit.show', title: 'Show', run: controller => controller.openPanel() },
  { id: 'mygit.fetchAll', title: 'Fetch All', run: op({ type: 'remote:fetch', payload: {} }) },
  { id: 'mygit.pull', title: 'Pull', run: op({ type: 'remote:pull', payload: {} }) },
  { id: 'mygit.push', title: 'Push', run: op({ type: 'remote:push', payload: { force: false } }) },
  { id: 'mygit.createBranch', title: 'Create Branch', run: action('createBranch') },
  { id: 'mygit.renameBranch', title: 'Rename Branch', run: action('renameBranch') },
  { id: 'mygit.stash', title: 'Stash Changes', run: op({ type: 'stash:save', payload: {} }) },
  { id: 'mygit.popStash', title: 'Pop Stash', run: op({ type: 'stash:pop', payload: {} }) },
  { id: 'mygit.stageAll', title: 'Stage All Changes', run: op({ type: 'stage:all', payload: {} }) },
  { id: 'mygit.unstageAll', title: 'Unstage All Changes', run: op({ type: 'stage:unstageAll', payload: {} }) },
  { id: 'mygit.undo', title: 'Undo', run: op({ type: 'undo', payload: {} }) },
  { id: 'mygit.redo', title: 'Redo', run: op({ type: 'redo', payload: {} }) },
  { id: 'mygit.createFile', title: 'Create File', run: action('createFile') },
  {
    id: 'mygit.editFile',
    title: 'Edit File',
    run: async controller => {
      const file = await pickFile(controller, 'Edit file');
      if (file) controller.dispatch({ type: 'file:open', payload: { path: file } });
    },
  },
  {
    id: 'mygit.fileHistory',
    title: 'File History and Blame',
    run: async controller => {
      const file = await pickFile(controller, 'File history');
      if (!file) return;
      controller.openPanel();
      controller.dispatch({ type: 'view:history', payload: { path: file } });
    },
  },
  {
    id: 'mygit.createPatch',
    title: 'Create Patch',
    run: controller => {
      const { selection, selectionView } = controller.store.getState();
      if (selectionView.kind === 'commit') controller.dispatch({ type: 'patch:commits', payload: { shas: [selectionView.detail.sha] } });
      else if (selectionView.kind === 'range' && selectionView.mode === 'combined') controller.dispatch({ type: 'patch:commits', payload: { shas: selection.filter(sha => sha !== 'working-tree') } });
      else controller.dispatch({ type: 'patch:files', payload: { from: 'HEAD', to: 'working-tree', paths: ['.'] } });
    },
  },
  {
    id: 'mygit.applyPatch',
    title: 'Apply Patch',
    run: async controller => {
      const [file] = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { Patch: ['patch', 'diff'] }, defaultUri: vscode.Uri.file(controller.repoPath) }) ?? [];
      if (!file) return;
      const text = await fs.readFile(file.fsPath, 'utf8');
      await controller.store.run(`Apply patch ${file.fsPath}`, async () => {
        await runGit(controller.repoPath, ['apply', '--whitespace=nowarn', '-'], { input: text });
      });
    },
  },
  { id: 'mygit.editCommitTemplate', title: 'Edit Commit Template', run: action('commitTemplate') },
  { id: 'mygit.sparseCheckout', title: 'Sparse Checkout Settings', run: action('sparseCheckout') },
  {
    id: 'mygit.setHooksPath',
    title: 'Set Git Hooks Path',
    run: async controller => {
      const current = controller.store.getState().repo?.hooksPath;
      const choice = await vscode.window.showQuickPick(
        [{ label: 'Browse…', id: 'browse' }, { label: 'Use the default (.git/hooks)', id: 'default', description: current ? `current: ${current}` : 'current' }],
        { title: 'Git hooks path for this repository' }
      );
      if (!choice) return;
      let hooksPath: string | null = null;
      if (choice.id === 'browse') {
        const [folder] = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, defaultUri: vscode.Uri.file(controller.repoPath) }) ?? [];
        if (!folder) return;
        hooksPath = folder.fsPath;
      }
      await controller.store.run('Set Git hooks path', () => setHooksPath(controller.repoPath, hooksPath));
    },
  },
  { id: 'mygit.openRepoFolder', title: 'Open Repository in File Manager', run: controller => vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(controller.repoPath)) },
  { id: 'mygit.showActivityLog', title: 'Show Activity Log', run: action('activityLog') },
  { id: 'mygit.checkConflicts', title: 'Check for Conflicts with Target Branches', run: controller => controller.checkConflicts(true) },
  { id: 'mygit.openSettings', title: 'Open Preferences', run: op({ type: 'settings:open', payload: {} }) },
  { id: 'mygit.commandPalette', title: 'Command Palette', palette: false, run: controller => showPalette(controller) },
  { id: 'mygit.key.find', title: 'Search Commits', palette: false, run: action('find') },
  { id: 'mygit.key.focusMessage', title: 'Focus Commit Message', palette: false, run: action('focusMessage') },
  { id: 'mygit.key.focusFilter', title: 'Focus Left Panel Filter', palette: false, run: action('focusFilter') },
  { id: 'mygit.key.toggleLeft', title: 'Toggle Left Panel', palette: false, run: action('toggleLeft') },
  { id: 'mygit.key.toggleDetail', title: 'Toggle Commit Panel', palette: false, run: action('toggleDetail') },
  { id: 'mygit.key.shortcuts', title: 'Keyboard Shortcuts', palette: false, run: action('shortcuts') },
  { id: 'mygit.key.externalDiff', title: 'Open Diff or Merge Tool', palette: false, run: action('externalDiff') },
];

async function showPalette(controller: RepositoryController): Promise<void> {
  const items = COMMANDS.filter(command => command.palette !== false && command.id !== 'mygit.show')
    .map(command => ({ label: command.title, id: command.id }));
  const pick = await vscode.window.showQuickPick(items, { title: 'mygit', placeHolder: 'Run a mygit command' });
  if (pick) await vscode.commands.executeCommand(pick.id);
}

export function registerCommands(context: vscode.ExtensionContext, getController: () => RepositoryController | undefined): void {
  for (const command of COMMANDS) {
    context.subscriptions.push(vscode.commands.registerCommand(command.id, async () => {
      const controller = getController();
      if (!controller) {
        void vscode.window.showInformationMessage('mygit: the open folder is not inside a Git repository.');
        return;
      }
      await command.run(controller);
    }));
  }
}
