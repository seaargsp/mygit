import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import {
  DEFAULT_REPO_PREFS,
  type CentreView,
  type ClientState,
  type DiffContext,
  type HeadInfo,
  type OpenFile,
  type PendingOp,
  type Prefs,
  type RepoPrefs,
  type SelectionView,
} from './messages';
import { UndoJournal } from './undo';
import type { ActivityLog } from './activityLog';
import { runGit, setGitLogger, GitError, type GitLogEntry } from '../git/gitService';
import { listBranches, listRemotes, listStashes, listTags, defaultBranch, revParse } from '../git/refs';
import { assignLanes, firstParentChain, getCommitLog, insertStashes, reachableFrom, type CommitNode } from '../git/graph';
import { EMPTY_STATUS, getWorkingTreeStatus, listAllFiles } from '../git/status';
import { getCommitDetail, getCommitTemplate, getHeadMessage, applyTemplate } from '../git/commit';
import {
  getBlame, getCommitFileDiff, getFileContent, getFileHistory, getRangeFileDiff, getRangeFiles, getWorkingFileDiff,
  type FileDiff,
} from '../git/diff';
import { getRepoState, isHeadPushed } from '../git/repoState';
import { getStashFiles } from '../git/stash';

/** Tree of an empty repository: the left side of a root commit's diff. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

const PREFS_KEY = 'mygit.repoPrefs';

export function readPrefs(): Prefs {
  const config = vscode.workspace.getConfiguration('mygit');
  return {
    dateFormat: config.get('dateFormat', 'Y-m-d H:i') || 'Y-m-d H:i',
    relativeDateDays: Math.max(0, config.get('relativeDateDays', 3)),
    dateLocale: config.get('dateLocale', ''),
    authorDisplay: config.get('authorDisplay', 'initials'),
    graphMetadata: config.get('graphMetadata', ['branches', 'tags']),
    highlightOnBranchHover: config.get('highlightOnBranchHover', true),
    showToolbarLabels: config.get('showToolbarLabels', true),
    squashMerge: config.get('squashMerge', false),
    gpgSign: config.get('gpgSign', false),
    lazyLoad: config.get('lazyLoadCommits', true),
    showAllCommits: config.get('showAllCommits', false),
    applyCommitTemplate: config.get('applyCommitTemplate', true),
    removeTemplateComments: config.get('removeTemplateComments', true),
    conflictDetection: config.get('conflictDetection', true),
  };
}

function initialCommitLimit(): number {
  return Math.max(500, vscode.workspace.getConfiguration('mygit').get('initialCommits', 2000));
}

const EMPTY_HEAD: HeadInfo = {
  branch: null, sha: null, detached: false, upstream: null, ahead: 0, behind: 0, pushed: false, message: null,
};

export type RunOptions = {
  /** What to reload afterwards. */
  refresh?: 'all' | 'working' | 'none';
  /** Skip the Activity Log entry (view-only work). */
  quiet?: boolean;
};

export type StoreDeps = {
  repoPath: string;
  gitDir: string;
  memento: vscode.Memento;
  log: ActivityLog;
  /** Shows a failure with a link to the Activity Log. */
  reportError: (message: string) => void;
};

/**
 * Extension-side model of the client: repository data, selection and centre view. Patches
 * are pushed to the webview; the full state is sent when a webview (re)loads.
 */
export class Store {
  readonly repoPath: string;
  readonly gitDir: string;
  readonly journal = new UndoJournal();
  private readonly deps: StoreDeps;
  private state: ClientState;
  private rawLog: CommitNode[] = [];
  private limit: number | null;
  private readonly listeners = new Set<(patch: Partial<ClientState>) => void>();
  private refreshing: Promise<void> | null = null;
  private refreshQueued = false;
  private selectionToken = 0;
  private viewToken = 0;
  private pendingId = 0;

  constructor(deps: StoreDeps) {
    this.deps = deps;
    this.repoPath = deps.repoPath;
    this.gitDir = deps.gitDir;
    const prefs = readPrefs();
    this.limit = prefs.showAllCommits ? null : initialCommitLimit();
    this.state = {
      noRepo: false,
      repoName: deps.repoPath.split(/[\\/]/).filter(Boolean).pop() ?? deps.repoPath,
      head: EMPTY_HEAD,
      branches: { local: [], remote: [] },
      remotes: [],
      tags: [],
      stashes: [],
      commitLog: [],
      hasMore: false,
      selection: ['working-tree'],
      selectionView: { kind: 'wip' },
      view: { kind: 'graph' },
      workingTreeStatus: EMPTY_STATUS,
      repo: null,
      template: null,
      prefs,
      repoPrefs: { ...DEFAULT_REPO_PREFS, ...deps.memento.get<Partial<RepoPrefs>>(PREFS_KEY, {}) },
      targetBranch: null,
      undo: { undo: null, redo: null },
      log: { app: deps.log.app, repo: deps.log.repo },
      conflicts: { checking: false, checkedAt: null, results: [] },
      allFiles: null,
      busy: null,
      pending: [],
      avatars: {},
    };
    deps.log.onChange(() => this.setState({ log: { app: [...deps.log.app], repo: [...deps.log.repo] } }));
  }

  getState(): ClientState {
    return this.state;
  }

  subscribe(listener: (patch: Partial<ClientState>) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setState(patch: Partial<ClientState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(patch);
  }

  /** Lists an operation as pending while `fn` runs. */
  async track<T>(entry: Omit<PendingOp, 'id'>, fn: () => Promise<T>): Promise<T> {
    const id = ++this.pendingId;
    this.setState({ pending: [...this.state.pending, { ...entry, id }] });
    try {
      return await fn();
    } finally {
      this.setState({ pending: this.state.pending.filter(pending => pending.id !== id) });
    }
  }

  // ---------------------------------------------------------------- preferences

  setRepoPrefs(patch: Partial<RepoPrefs>): void {
    const repoPrefs = { ...this.state.repoPrefs, ...patch };
    this.setState({ repoPrefs });
    void this.deps.memento.update(PREFS_KEY, repoPrefs);
  }

  reloadPrefs(): void {
    const prefs = readPrefs();
    const limitChanged = prefs.showAllCommits !== this.state.prefs.showAllCommits;
    this.setState({ prefs });
    if (limitChanged) {
      this.limit = prefs.showAllCommits ? null : initialCommitLimit();
      void this.refreshGraph();
    }
    if (prefs.authorDisplay === 'avatars') this.computeAvatars();
  }

  // ---------------------------------------------------------------- refresh

  /** Refreshes unless a refresh is already running (which reflects the current state). */
  refreshIfIdle(): Promise<void> {
    return this.refreshing ?? this.refreshAll();
  }

  /** Coalesces concurrent refresh requests into one running refresh and at most one queued. */
  refreshAll(): Promise<void> {
    if (this.refreshing) {
      this.refreshQueued = true;
      return this.refreshing;
    }
    this.refreshing = this.doRefreshAll()
      .catch(error => this.deps.log.application(`Refresh failed: ${error instanceof Error ? error.message : String(error)}`, 'error'))
      .finally(() => {
        this.refreshing = null;
        if (this.refreshQueued) {
          this.refreshQueued = false;
          void this.refreshAll();
        }
      });
    return this.refreshing;
  }

  private async doRefreshAll(): Promise<void> {
    // With nothing hidden the graph's revisions are known up front, so the log (the slowest
    // query on large repositories) runs alongside the reference and status queries.
    const graphLog = this.unfilteredGraph()
      ? revParse(this.repoPath, 'HEAD').then(head => getCommitLog(this.repoPath, {
        revs: ['--branches', '--remotes', '--tags', ...(head ? ['HEAD'] : [])],
        limit: this.limit,
        offset: 0,
      }))
      : null;
    const [branches, tags, remotes, stashes, status, repoState, headMessage, pushed, template] = await Promise.all([
      listBranches(this.repoPath),
      listTags(this.repoPath),
      listRemotes(this.repoPath),
      listStashes(this.repoPath),
      getWorkingTreeStatus(this.repoPath),
      getRepoState(this.repoPath, this.gitDir),
      getHeadMessage(this.repoPath),
      isHeadPushed(this.repoPath),
      getCommitTemplate(this.repoPath),
    ]);
    const targetBranch = this.state.targetBranch ?? (await defaultBranch(this.repoPath, remotes.map(remote => remote.name)))
      ?? (branches.local.some(branch => branch.name === 'main') ? 'main' : branches.local.some(branch => branch.name === 'master') ? 'master' : null);
    const { gitDir: _gitDir, ...repo } = repoState;
    const prepared = template.path ? applyTemplate(template, this.state.prefs.removeTemplateComments) : null;

    this.setState({
      branches,
      tags,
      remotes,
      stashes,
      workingTreeStatus: status,
      head: this.headInfo(status.branch, headMessage, pushed),
      repo,
      template: prepared,
      targetBranch,
      undo: this.journal.labels(),
    });
    if (graphLog) {
      this.rawLog = await graphLog;
      this.publishLog();
    } else {
      await this.refreshGraph();
    }
    await this.refreshSelection();
    await this.refreshView();
  }

  private unfilteredGraph(): boolean {
    const { hidden, smartVisibility } = this.state.repoPrefs;
    return hidden.length === 0 && !smartVisibility;
  }

  private headInfo(branch: ClientState['workingTreeStatus']['branch'], message: string | null, pushed: boolean): HeadInfo {
    return {
      branch: branch.head,
      sha: branch.oid,
      detached: branch.oid !== null && branch.head === null,
      upstream: branch.upstream,
      ahead: branch.ahead,
      behind: branch.behind,
      pushed,
      message,
    };
  }

  /** Working-tree edits only: status, operation state and an open working-tree diff. */
  async refreshWorking(): Promise<void> {
    const [status, repoState] = await Promise.all([
      getWorkingTreeStatus(this.repoPath),
      getRepoState(this.repoPath, this.gitDir),
    ]);
    if (status.branch.oid !== this.state.head.sha || status.branch.head !== this.state.head.branch) {
      await this.refreshAll();
      return;
    }
    const { gitDir: _gitDir, ...repo } = repoState;
    this.setState({ workingTreeStatus: status, repo });
    await this.refreshView();
  }

  /** Revisions the graph walks. Solo does not narrow them: the other references are dimmed. */
  private visibleRevs(): string[] {
    const { hidden, smartVisibility } = this.state.repoPrefs;
    const { branches, tags, head, targetBranch } = this.state;
    type RefId = { id: string; group: string | null };
    const local: RefId[] = branches.local.map(branch => ({ id: `refs/heads/${branch.name}`, group: null }));
    const remote: RefId[] = branches.remote.flatMap(group => group.branches.map(branch => ({
      id: `refs/remotes/${group.remoteName}/${branch.name}`,
      group: `remote:${group.remoteName}`,
    })));
    const tagRefs: RefId[] = tags.map(tag => ({ id: `refs/tags/${tag.name}`, group: null }));
    const all = [...local, ...remote, ...tagRefs];
    const withHead = (revs: string[]) => (head.sha ? [...revs, 'HEAD'] : revs);

    if (smartVisibility) {
      const ids = new Set<string>();
      const add = (name: string | null | undefined, prefix: string) => {
        if (name && all.some(ref => ref.id === `${prefix}${name}`)) ids.add(`${prefix}${name}`);
      };
      add(head.branch, 'refs/heads/');
      add(head.upstream, 'refs/remotes/');
      if (targetBranch && targetBranch !== head.branch) {
        add(targetBranch, 'refs/heads/');
        const targetLocal = branches.local.find(branch => branch.name === targetBranch);
        if (targetLocal?.upstream) add(targetLocal.upstream, 'refs/remotes/');
        for (const group of branches.remote) add(`${group.remoteName}/${targetBranch}`, 'refs/remotes/');
      }
      return withHead([...ids]);
    }

    return withHead(all.filter(ref => !hidden.includes(ref.id) && !(ref.group !== null && hidden.includes(ref.group))).map(ref => ref.id));
  }

  async refreshGraph(): Promise<void> {
    const revs = this.visibleRevs();
    this.rawLog = await getCommitLog(this.repoPath, { revs, limit: this.limit, offset: 0 });
    this.publishLog();
  }

  /** Re-derives the graph rows (lanes, stashes, solo dimming) from the loaded log. */
  publishLog(): void {
    const { hidden, solo, pinned } = this.state.repoPrefs;
    const stashes = this.state.stashes.filter(stash => !hidden.includes(`stash:${stash.sha}`));
    const rows = insertStashes(this.rawLog, stashes);
    const pinnedBranch = pinned
      .map(name => this.state.branches.local.find(branch => branch.name === name))
      .find(branch => branch !== undefined);
    const chain = pinnedBranch ? firstParentChain(this.rawLog, pinnedBranch.sha) : new Set<string>();
    const lanes = assignLanes(rows, chain);
    const soloed = solo.length > 0 ? reachableFrom(rows, this.soloTips(solo)) : null;
    this.setState({
      commitLog: soloed ? lanes.map(commit => (soloed.has(commit.sha) ? commit : { ...commit, muted: true })) : lanes,
      hasMore: this.limit !== null && this.rawLog.length >= this.limit,
    });
    if (this.state.prefs.authorDisplay === 'avatars') this.computeAvatars();
  }

  /** Tip commits of the soloed reference ids (`refs/...`, `remote:<name>`, `stash:<sha>`). */
  private soloTips(solo: string[]): string[] {
    const { branches, tags } = this.state;
    const tips: string[] = [];
    for (const branch of branches.local) if (solo.includes(`refs/heads/${branch.name}`)) tips.push(branch.sha);
    for (const group of branches.remote) {
      const whole = solo.includes(`remote:${group.remoteName}`);
      for (const branch of group.branches) {
        if (whole || solo.includes(`refs/remotes/${group.remoteName}/${branch.name}`)) tips.push(branch.sha);
      }
    }
    for (const tag of tags) if (solo.includes(`refs/tags/${tag.name}`)) tips.push(tag.sha);
    for (const id of solo) if (id.startsWith('stash:')) tips.push(id.slice('stash:'.length));
    return tips;
  }

  private computeAvatars(): void {
    const avatars = { ...this.state.avatars };
    let changed = false;
    for (const commit of this.rawLog) {
      const email = commit.authorEmail.trim().toLowerCase();
      if (!email || avatars[email]) continue;
      const hash = crypto.createHash('md5').update(email).digest('hex');
      avatars[email] = `https://www.gravatar.com/avatar/${hash}?s=48&d=404`;
      changed = true;
    }
    if (changed) this.setState({ avatars });
  }

  async loadMore(): Promise<void> {
    if (this.limit === null) return;
    const more = await getCommitLog(this.repoPath, { revs: this.visibleRevs(), limit: initialCommitLimit(), offset: this.rawLog.length });
    this.limit += initialCommitLimit();
    this.rawLog = [...this.rawLog, ...more];
    this.publishLog();
  }

  async loadAll(): Promise<void> {
    this.limit = null;
    await this.refreshGraph();
  }

  // ---------------------------------------------------------------- selection

  async select(shas: string[]): Promise<void> {
    const selection = shas.length === 0 ? ['working-tree'] : shas;
    const token = ++this.selectionToken;
    const leavingDiff = this.state.view.kind === 'diff' && !this.sameSelection(selection);
    this.setState({ selection, selectionView: { kind: 'loading' }, ...(leavingDiff ? { view: { kind: 'graph' } } : {}) });
    const view = await this.computeSelection(selection);
    if (token === this.selectionToken) this.setState({ selectionView: view });
  }

  private sameSelection(next: string[]): boolean {
    const current = this.state.selection;
    return current.length === next.length && current.every((sha, index) => sha === next[index]);
  }

  private async refreshSelection(): Promise<void> {
    const token = ++this.selectionToken;
    const view = await this.computeSelection(this.state.selection).catch(() => ({ kind: 'wip' } as SelectionView));
    if (token === this.selectionToken) this.setState({ selectionView: view });
  }

  private async computeSelection(selection: string[]): Promise<SelectionView> {
    if (selection.length === 1 && selection[0] === 'working-tree') return { kind: 'wip' };

    if (selection.length === 1) {
      const sha = selection[0];
      const row = this.state.commitLog.find(commit => commit.sha === sha);
      const stash = row?.stash ? this.state.stashes.find(entry => entry.sha === sha) : undefined;
      if (stash) return { kind: 'stash', stash, files: await getStashFiles(this.repoPath, stash.sha) };
      const detail = await getCommitDetail(this.repoPath, sha);
      return { kind: 'commit', detail, isHead: detail.sha === this.state.head.sha };
    }

    const includesWip = selection.includes('working-tree');
    const commits = selection.filter(sha => sha !== 'working-tree');
    const order = new Map(this.state.commitLog.map((commit, index) => [commit.sha, index]));
    // Newest (top row) first.
    const sorted = [...commits].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    const newest = sorted[0];
    const oldest = sorted[sorted.length - 1];

    if (includesWip && commits.length === 1) {
      return {
        kind: 'range', mode: 'working', from: newest, to: 'working-tree', count: 2, oldest, newest,
        files: await getRangeFiles(this.repoPath, newest, 'working-tree'),
      };
    }

    const byShaParents = new Map(this.state.commitLog.map(commit => [commit.sha, commit.parents]));
    const consecutive = sorted.every((sha, index) => index === sorted.length - 1 || byShaParents.get(sha)?.[0] === sorted[index + 1]);
    if (consecutive && !this.state.commitLog.some(commit => commits.includes(commit.sha) && commit.stash)) {
      const oldestParent = byShaParents.get(oldest)?.[0] ?? EMPTY_TREE;
      const reachesWip = includesWip && newest === this.state.head.sha;
      if (includesWip && !reachesWip) {
        return { kind: 'unavailable', count: selection.length, reason: 'The working tree can join a combined diff only when the selection reaches HEAD.' };
      }
      const to = reachesWip ? 'working-tree' : newest;
      return {
        kind: 'range', mode: 'combined', from: oldestParent, to, count: selection.length, oldest, newest,
        files: await getRangeFiles(this.repoPath, oldestParent, to),
      };
    }

    if (!includesWip && commits.length === 2) {
      return {
        kind: 'range', mode: 'compare', from: oldest, to: newest, count: 2, oldest, newest,
        files: await getRangeFiles(this.repoPath, oldest, newest),
      };
    }

    return {
      kind: 'unavailable',
      count: selection.length,
      reason: 'The selected commits are not consecutive on one line of history, so they have no combined diff. Select a contiguous run of commits, or exactly two commits to compare them.',
    };
  }

  // ---------------------------------------------------------------- centre views

  private setView(view: CentreView): number {
    this.setState({ view });
    return ++this.viewToken;
  }

  private patchView(token: number, patch: Partial<CentreView>): void {
    if (token !== this.viewToken) return;
    this.setState({ view: { ...this.state.view, ...patch } as CentreView });
  }

  closeView(): void {
    this.setView({ kind: 'graph' });
  }

  async openFile(file: OpenFile, context?: DiffContext): Promise<void> {
    const current = this.state.view;
    const keepContext = current.kind === 'diff' ? current.context : 'hunk';
    const resolved = context ?? keepContext;
    const token = this.setView({ kind: 'diff', file, diff: null, context: resolved, fileView: null });
    const diff = await this.loadDiff(file, resolved);
    this.patchView(token, { diff });
  }

  async setDiffContext(context: DiffContext): Promise<void> {
    const view = this.state.view;
    if (view.kind !== 'diff') return;
    await this.openFile(view.file, context);
  }

  async setFileView(on: boolean): Promise<void> {
    const view = this.state.view;
    if (view.kind !== 'diff') return;
    if (!on) {
      this.setState({ view: { ...view, fileView: null } });
      return;
    }
    const rev = this.fileRev(view.file);
    const text = await getFileContent(this.repoPath, rev, view.file.path);
    if (this.state.view.kind === 'diff' && this.state.view.file === view.file) {
      this.setState({ view: { ...this.state.view, fileView: { rev, text } } });
    }
  }

  /** Revision whose content the file view shows. */
  fileRev(file: OpenFile): string {
    if (file.source === 'unstaged') return 'working-tree';
    if (file.source === 'staged') return 'index';
    if (file.source === 'stash') return file.untracked ? `${file.sha}^3` : file.sha;
    if (file.status === 'D') return file.source === 'range' ? file.base ?? `${file.sha}^` : `${file.sha}^`;
    return file.sha;
  }

  async loadDiff(file: OpenFile, context: DiffContext): Promise<FileDiff> {
    switch (file.source) {
      case 'unstaged':
      case 'staged':
        return getWorkingFileDiff(this.repoPath, file.path, file.source === 'staged', context, file.untracked && file.source === 'unstaged');
      case 'commit':
        return getCommitFileDiff(this.repoPath, file.sha, file.path, context);
      case 'stash':
        return file.untracked
          ? getRangeFileDiff(this.repoPath, EMPTY_TREE, `${file.sha}^3`, file.path, context)
          : getRangeFileDiff(this.repoPath, `${file.sha}^1`, file.sha, file.path, context);
      case 'range':
        return getRangeFileDiff(this.repoPath, file.base ?? EMPTY_TREE, file.sha, file.path, context);
    }
  }

  async openHistory(filePath: string): Promise<void> {
    const token = this.setView({ kind: 'history', path: filePath, entries: null, selected: null, diff: null });
    const entries = await getFileHistory(this.repoPath, filePath);
    this.patchView(token, { entries, selected: entries[0]?.sha ?? null });
    if (entries[0]) await this.selectHistory(entries[0].sha);
  }

  async selectHistory(sha: string): Promise<void> {
    const view = this.state.view;
    if (view.kind !== 'history') return;
    const entry = view.entries?.find(item => item.sha === sha);
    const token = this.viewToken;
    this.setState({ view: { ...view, selected: sha, diff: null } });
    const diff = await getCommitFileDiff(this.repoPath, sha, entry?.path ?? view.path);
    this.patchView(token, { diff });
  }

  async openBlame(filePath: string, rev: string): Promise<void> {
    const token = this.setView({ kind: 'blame', path: filePath, rev, lines: null });
    const lines = await getBlame(this.repoPath, filePath, rev);
    this.patchView(token, { lines });
  }

  async openMerge(filePath: string): Promise<void> {
    const operation = this.state.repo?.operation;
    const current = operation?.kind === 'rebase' ? operation.current : this.state.head.branch ?? 'HEAD';
    const incoming = operation?.kind === 'rebase' ? operation.incoming : operation?.incoming ?? 'incoming';
    const token = this.setView({ kind: 'merge', path: filePath, content: null, current, incoming });
    const content = await getFileContent(this.repoPath, 'working-tree', filePath);
    this.patchView(token, { content });
  }

  /** Re-reads a view whose content depends on the working tree. */
  private async refreshView(): Promise<void> {
    const view = this.state.view;
    if (view.kind !== 'diff') return;
    const { file } = view;
    if (file.source !== 'staged' && file.source !== 'unstaged') return;
    const status = this.state.workingTreeStatus;
    const inSource = (source: 'staged' | 'unstaged') => status[source].find(entry => entry.path === file.path);
    let next = file;
    if (!inSource(file.source)) {
      const other = file.source === 'staged' ? 'unstaged' : 'staged';
      const entry = inSource(other);
      if (!entry) {
        this.closeView();
        return;
      }
      next = { ...file, source: other, untracked: entry.untracked, status: entry.status };
    }
    const token = this.viewToken;
    const diff = await this.loadDiff(next, view.context);
    if (token !== this.viewToken) return;
    const fileView = view.fileView ? { rev: this.fileRev(next), text: await getFileContent(this.repoPath, this.fileRev(next), next.path) } : null;
    this.setState({ view: { ...view, file: next, diff, fileView } });
  }

  async listAllFiles(rev: string | null): Promise<void> {
    if (rev === null) {
      this.setState({ allFiles: null });
      return;
    }
    const files = await listAllFiles(this.repoPath, rev);
    this.setState({ allFiles: { rev, files } });
  }

  // ---------------------------------------------------------------- operations

  /**
   * Runs a repository operation: logs it with its duration (and every git command when
   * extended logging is on), reports failures with git's own message, then refreshes.
   */
  async run(label: string, fn: () => Promise<void>, opts: RunOptions = {}): Promise<boolean> {
    const started = Date.now();
    const commands: GitLogEntry[] = [];
    setGitLogger(entry => commands.push(entry));
    this.setState({ busy: label });
    let ok = true;
    try {
      await fn();
    } catch (error) {
      ok = false;
      const message = error instanceof GitError ? error.stderr || error.message : error instanceof Error ? error.message : String(error);
      if (!(error instanceof CancelledError)) {
        this.deps.log.repository(`${label} failed: ${message}`, { durationMs: Date.now() - started, level: 'error' });
        this.deps.reportError(`${label} failed: ${message}`);
      }
    } finally {
      setGitLogger(undefined);
      this.setState({ busy: null });
    }
    if (ok && !opts.quiet) {
      this.deps.log.repository(label, { durationMs: Date.now() - started });
      const extended = vscode.workspace.getConfiguration('mygit').get('extendedLogging', false);
      for (const command of commands) {
        // Hook output and git's progress notes arrive on stderr of successful commands.
        if (command.ok && command.stderr.trim() && isWriteCommand(command.args)) {
          this.deps.log.repository(`git ${command.args[0]}: ${command.stderr.trim()}`, { level: 'output' });
        }
        if (extended) this.deps.log.repository(`  git ${command.args.join(' ')}`, { durationMs: command.durationMs, level: command.ok ? 'info' : 'error' });
      }
    }
    const refresh = opts.refresh ?? 'all';
    if (refresh === 'all') await this.refreshAll();
    else if (refresh === 'working') await this.refreshWorking().catch(() => undefined);
    this.setState({ undo: this.journal.labels() });
    return ok;
  }
}

const READ_COMMANDS = new Set(['status', 'log', 'show', 'diff', 'for-each-ref', 'rev-parse', 'ls-files', 'ls-tree', 'blame', 'config', 'merge-base', 'name-rev', 'symbolic-ref', 'stash']);

function isWriteCommand(args: string[]): boolean {
  const command = args.find(arg => !arg.startsWith('-')) ?? '';
  return !READ_COMMANDS.has(command) || (command === 'stash' && args[1] !== 'list');
}

/** Thrown when the user dismisses a confirmation: the operation stops without an error report. */
export class CancelledError extends Error {
  constructor() {
    super('Cancelled');
  }
}

export async function gitOutput(repoPath: string, args: string[]): Promise<string> {
  return (await runGit(repoPath, args)).trim();
}
