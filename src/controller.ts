import * as path from 'node:path';
import * as vscode from 'vscode';
import { ClientPanel } from './panel/GitClientPanel';
import { Store } from './panel/state';
import { handleMessage, type Host } from './panel/operations';
import type { ActivityLog } from './panel/activityLog';
import type { LauncherView } from './panel/launcher';
import type { WebviewAction, WebviewToExtensionMessage } from './panel/messages';
import { fetch } from './git/remote';
import { hasCommitGraph, writeCommitGraph } from './git/repoState';
import { matchTargets, predictConflicts, type TargetConflicts } from './git/conflicts';
import { isAncestor } from './git/history';

const WORKING_DEBOUNCE_MS = 300;
const GIT_DEBOUNCE_MS = 150;
const CONFLICT_DEBOUNCE_MS = 2000;
const MIN_FETCH_SECONDS = 10;

/** Paths under .git whose change means refs, HEAD or an in-progress operation moved. */
const GIT_STATE = /^(HEAD|ORIG_HEAD|packed-refs|FETCH_HEAD|MERGE_HEAD|MERGE_MSG|REBASE_HEAD|CHERRY_PICK_HEAD|REVERT_HEAD|SQUASH_MSG|config|refs\/.*|logs\/refs\/stash|rebase-merge(\/.*)?|rebase-apply(\/.*)?|info\/sparse-checkout)$/;

/**
 * One repository per window: owns the store, the client panel, the file watchers, auto-fetch
 * and conflict prediction.
 */
export class RepositoryController implements vscode.Disposable, Host {
  readonly store: Store;
  private panel: ClientPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private workingTimer: ReturnType<typeof setTimeout> | undefined;
  private gitTimer: ReturnType<typeof setTimeout> | undefined;
  private conflictTimer: ReturnType<typeof setTimeout> | undefined;
  private fetchTimer: ReturnType<typeof setInterval> | undefined;
  private fetching = false;
  private lastConflictKey = '';

  constructor(
    private readonly context: vscode.ExtensionContext,
    readonly repoPath: string,
    gitDir: string,
    private readonly log: ActivityLog,
    private readonly launcher: LauncherView
  ) {
    this.store = new Store({
      repoPath,
      gitDir,
      memento: context.workspaceState,
      log,
      reportError: message => this.reportError(message),
    });

    this.store.subscribe(patch => {
      this.panel?.post({ type: 'state:update', payload: patch });
      if (patch.workingTreeStatus || patch.head) {
        const { workingTreeStatus: status, head } = this.store.getState();
        this.launcher.update({
          repoName: this.store.getState().repoName,
          branch: head.branch ?? (head.sha ? head.sha.slice(0, 7) : null),
          changes: new Set([...status.staged, ...status.unstaged, ...status.conflicted].map(file => file.path)).size,
        });
      }
      if (patch.head) this.scheduleConflictCheck();
    });

    this.watch(repoPath, gitDir);
    this.startAutoFetch();
    this.disposables.push(vscode.workspace.onDidChangeConfiguration(event => {
      if (!event.affectsConfiguration('mygit')) return;
      this.log.application('Configuration reloaded');
      this.store.reloadPrefs();
      if (event.affectsConfiguration('mygit.autoFetchInterval')) this.startAutoFetch();
      if (event.affectsConfiguration('mygit.conflictPrevention') || event.affectsConfiguration('mygit.conflictDetection')) {
        void this.checkConflicts(false);
      }
    }));

    this.log.application(`Repository opened: ${repoPath}`);
    void this.store.refreshAll().then(async () => {
      await this.ensureCommitGraph();
      await this.autoFetch();
    });
  }

  // ---------------------------------------------------------------- panel

  private panelHandlers() {
    return {
      onMessage: (message: WebviewToExtensionMessage) => this.dispatch(message),
      onReady: () => this.panel?.post({ type: 'state:update', payload: this.store.getState() }),
      onDispose: () => {
        this.panel = undefined;
      },
    };
  }

  openPanel(): ClientPanel {
    if (this.panel) {
      this.panel.reveal();
      return this.panel;
    }
    this.panel = ClientPanel.create(this.context.extensionUri, `mygit: ${this.store.getState().repoName}`, this.panelHandlers());
    void this.store.refreshIfIdle();
    void this.checkConflicts(false);
    return this.panel;
  }

  restorePanel(panel: vscode.WebviewPanel): void {
    this.panel?.panel.dispose();
    this.panel = ClientPanel.restore(panel, this.context.extensionUri, this.panelHandlers());
  }

  reloadPanel(): void {
    this.panel?.reload();
  }

  post(action: WebviewAction): void {
    this.openPanel().action(action);
  }

  dispatch(message: WebviewToExtensionMessage): void {
    // Git refuses plenty of these operations (conflicts, unmerged paths, protected refs);
    // the reason has to reach the user rather than an unhandled rejection.
    void handleMessage(this, message).catch(async error => {
      this.reportError(error instanceof Error ? error.message : String(error));
      await this.store.refreshAll().catch(() => undefined);
    });
  }

  clearLog(): void {
    this.log.clear();
  }

  private reportError(message: string): void {
    const hook = /hook/i.test(message);
    void vscode.window.showErrorMessage(hook ? `Git hook failed. ${message}` : message, 'Show Activity Log').then(choice => {
      if (choice) this.post('activityLog');
    });
  }

  // ---------------------------------------------------------------- watchers

  private watch(repoPath: string, gitDir: string): void {
    const onPath = (uri: vscode.Uri) => {
      const gitRelative = path.relative(gitDir, uri.fsPath).split(path.sep).join('/');
      if (!gitRelative.startsWith('..')) {
        if (GIT_STATE.test(gitRelative)) this.scheduleGitRefresh();
        else if (gitRelative === 'index') this.scheduleWorkingRefresh();
        return;
      }
      this.scheduleWorkingRefresh();
    };
    const watchers = [vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(repoPath, '**'))];
    if (path.relative(repoPath, gitDir).startsWith('..')) {
      watchers.push(vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(gitDir, '**')));
    }
    for (const watcher of watchers) {
      watcher.onDidChange(onPath);
      watcher.onDidCreate(onPath);
      watcher.onDidDelete(onPath);
      this.disposables.push(watcher);
    }
  }

  private scheduleWorkingRefresh(): void {
    if (this.workingTimer) clearTimeout(this.workingTimer);
    this.workingTimer = setTimeout(() => void this.store.refreshWorking().catch(() => undefined), WORKING_DEBOUNCE_MS);
  }

  private scheduleGitRefresh(): void {
    if (this.gitTimer) clearTimeout(this.gitTimer);
    this.gitTimer = setTimeout(() => void this.store.refreshAll(), GIT_DEBOUNCE_MS);
  }

  // ---------------------------------------------------------------- auto-fetch

  private startAutoFetch(): void {
    if (this.fetchTimer) clearInterval(this.fetchTimer);
    this.fetchTimer = undefined;
    const seconds = Math.max(0, vscode.workspace.getConfiguration('mygit').get<number>('autoFetchInterval', 120));
    if (seconds === 0) return;
    this.fetchTimer = setInterval(() => void this.autoFetch(), Math.max(MIN_FETCH_SECONDS, seconds) * 1000);
  }

  private async autoFetch(): Promise<void> {
    const config = vscode.workspace.getConfiguration('mygit');
    if (config.get<number>('autoFetchInterval', 120) === 0) return;
    if (this.fetching || this.store.getState().remotes.length === 0 || this.store.getState().busy) return;
    this.fetching = true;
    const started = Date.now();
    try {
      await fetch(this.repoPath, { prune: config.get('autoPrune', true), writeCommitGraph: config.get('writeCommitGraph', true) });
      if (config.get('extendedLogging', false)) this.log.repository('Auto-fetch', { durationMs: Date.now() - started });
      await this.store.refreshAll();
      await this.checkConflicts(false);
    } catch (error) {
      if (config.get('extendedLogging', false)) {
        this.log.repository(`Auto-fetch failed: ${error instanceof Error ? error.message : String(error)}`, { level: 'error' });
      }
    } finally {
      this.fetching = false;
    }
  }

  /**
   * Writes a commit-graph file when the repository has none. Its generation numbers let
   * `git log --date-order` stream the newest commits instead of walking the whole history
   * first, which dominates graph load time on large repositories. `git gc` writes the same
   * file by default (gc.writeCommitGraph).
   */
  private async ensureCommitGraph(): Promise<void> {
    if (!vscode.workspace.getConfiguration('mygit').get('writeCommitGraph', true)) return;
    if (!(await hasCommitGraph(this.repoPath))) {
      const started = Date.now();
      try {
        await writeCommitGraph(this.repoPath);
        this.log.repository('Commit-graph written', { durationMs: Date.now() - started });
        await this.store.refreshGraph();
      } catch (error) {
        this.log.repository(`Commit-graph write failed: ${error instanceof Error ? error.message : String(error)}`, { level: 'error' });
      }
    }
  }

  // ---------------------------------------------------------------- conflict prevention

  private scheduleConflictCheck(): void {
    if (this.conflictTimer) clearTimeout(this.conflictTimer);
    this.conflictTimer = setTimeout(() => void this.checkConflicts(false), CONFLICT_DEBOUNCE_MS);
  }

  /** Predicts conflicts between HEAD and every monitored target branch. */
  async checkConflicts(force: boolean): Promise<void> {
    const config = vscode.workspace.getConfiguration('mygit');
    const state = this.store.getState();
    if (!force && !config.get('conflictDetection', true)) {
      if (state.conflicts.results.length > 0) this.store.setState({ conflicts: { checking: false, checkedAt: null, results: [] } });
      return;
    }
    const head = state.head;
    if (!head.sha || state.repo?.operation) return;
    const patterns = config.get<string[]>('conflictPrevention.targetBranches', ['main', 'master', 'develop']);
    const names = [
      ...state.branches.local.map(branch => branch.name),
      ...state.branches.remote.flatMap(group => group.branches.map(branch => `${group.remoteName}/${branch.name}`)),
    ].filter(name => name !== head.branch && name !== head.upstream);
    const targets = matchTargets(names, patterns);
    const shaOf = (name: string) =>
      state.branches.local.find(branch => branch.name === name)?.sha
      ?? state.branches.remote.flatMap(group => group.branches.map(branch => ({ name: `${group.remoteName}/${branch.name}`, sha: branch.sha })))
        .find(branch => branch.name === name)?.sha;
    const key = `${head.sha}|${targets.map(target => `${target}@${shaOf(target)}`).join(',')}`;
    if (!force && key === this.lastConflictKey) return;
    this.lastConflictKey = key;

    this.store.setState({ conflicts: { ...state.conflicts, checking: true } });
    const results: TargetConflicts[] = [];
    try {
      for (const target of targets) {
        const sha = shaOf(target);
        if (!sha || (await isAncestor(this.repoPath, sha, 'HEAD'))) continue;
        results.push(await predictConflicts(this.repoPath, target));
      }
      if (config.get('extendedLogging', false)) {
        const count = results.filter(result => result.files.length > 0).length;
        this.log.repository(`Conflict detection: ${count === 0 ? 'no conflicts' : `${count} target ${count === 1 ? 'branch conflicts' : 'branches conflict'}`}`);
      }
    } catch (error) {
      this.log.repository(`Conflict detection failed: ${error instanceof Error ? error.message : String(error)}`, { level: 'error' });
    } finally {
      this.store.setState({ conflicts: { checking: false, checkedAt: Date.now(), results } });
    }
  }

  dispose(): void {
    if (this.workingTimer) clearTimeout(this.workingTimer);
    if (this.gitTimer) clearTimeout(this.gitTimer);
    if (this.conflictTimer) clearTimeout(this.conflictTimer);
    if (this.fetchTimer) clearInterval(this.fetchTimer);
    this.panel?.panel.dispose();
    for (const disposable of this.disposables) disposable.dispose();
  }
}
