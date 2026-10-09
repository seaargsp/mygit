import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { CancelledError, EMPTY_TREE, type Store } from './state';
import type { OpenFile, PullMode, RebasePlan, WebviewAction, WebviewToExtensionMessage } from './messages';
import type { UndoEntry } from './undo';
import { GitError, runGit } from '../git/gitService';
import {
  applyPatch, deleteFiles, deleteOrigFiles, discardAll, discardFiles, ignoreFile, intentToAdd, restoreFromCommit,
  stageAll, stageFiles, takeSide, unstageAll, unstageFiles, createFile,
} from '../git/status';
import { buildPartialPatch, createPatch, getCommitFileDiff, getRangeFileDiff, getWorkingFileDiff } from '../git/diff';
import { commit, editHeadMessage, saveCommitTemplate } from '../git/commit';
import {
  addRemote, checkoutBranch, checkoutDetached, checkoutRemoteBranch, createBranch, deleteLocalBranch, deleteRemoteBranch,
  editRemote, fastForwardBranch, fetch, moveBranch, pull, pullBranch, push, PushRejectedError, removeRemote, renameBranch,
  restoreRemote, setUpstream, snapshotRemote, UnmergedBranchError, isValidBranchName,
} from '../git/remote';
import {
  abortOperation, cherryPick, continueOperation, interactiveRebase, isAncestor, isReferenced, listRange, mergeRef,
  rebase, resetTo, revertCommit, skipOperation, type TodoEntry,
} from '../git/history';
import { stashApply, stashCreate, stashDrop, stashPop, stashRename, stashSave } from '../git/stash';
import { annotateTag, createTag, deleteRemoteTag, deleteTag, fastForwardTag, listRemotes, pushTag, revParse } from '../git/refs';
import { redactUrl } from '../git/redact';
import { headSha, runLfs, setSparseCheckout } from '../git/repoState';

export type Host = {
  store: Store;
  post(action: WebviewAction): void;
  checkConflicts(force: boolean): Promise<void>;
  clearLog(): void;
};

const config = () => vscode.workspace.getConfiguration('mygit');

/** Modal confirmation; resolves to the chosen button or throws CancelledError. */
async function confirm(message: string, detail: string, ...buttons: string[]): Promise<string> {
  const choice = await vscode.window.showWarningMessage(message, { modal: true, detail }, ...buttons);
  if (!choice) throw new CancelledError();
  return choice;
}

type HeadSnapshot = { branch: string | null; sha: string | null };

async function snapshotHead(repoPath: string): Promise<HeadSnapshot> {
  const sha = await headSha(repoPath);
  let branch: string | null = null;
  try {
    branch = (await runGit(repoPath, ['symbolic-ref', '--short', '-q', 'HEAD'])).trim() || null;
  } catch {
    branch = null;
  }
  return { branch, sha };
}

function sameHead(a: HeadSnapshot, b: HeadSnapshot): boolean {
  return a.branch === b.branch && a.sha === b.sha;
}

async function checkoutSnapshot(repoPath: string, snapshot: HeadSnapshot): Promise<void> {
  if (snapshot.branch) await checkoutBranch(repoPath, snapshot.branch);
  else if (snapshot.sha) await checkoutDetached(repoPath, snapshot.sha);
}

/** Undo entry for an action that only moved HEAD (and possibly the checked-out branch). */
function refMoveEntry(
  repoPath: string,
  label: string,
  before: HeadSnapshot,
  after: HeadSnapshot,
  move: (target: HeadSnapshot) => Promise<void>
): UndoEntry {
  return {
    label,
    undo: () => move(before),
    redo: () => move(after),
    isAfter: async () => sameHead(await snapshotHead(repoPath), after),
    isBefore: async () => sameHead(await snapshotHead(repoPath), before),
  };
}

/** Checks out a target, offering Stash and Checkout when local changes block it. */
async function checkoutWithStash(store: Store, run: () => Promise<void>): Promise<void> {
  const repoPath = store.repoPath;
  const head = store.getState().head;
  if (head.detached && head.sha && !(await isReferenced(repoPath, head.sha))) {
    await confirm(
      'HEAD is on a commit no branch or tag contains.',
      `Leaving ${head.sha.slice(0, 7)} makes it reachable only through the reflog (or Undo). Create a branch on it first to keep it.`,
      'Checkout Anyway'
    );
  }
  try {
    await run();
  } catch (error) {
    if (error instanceof GitError && /would be overwritten by checkout|Please commit your changes or stash them/.test(error.stderr)) {
      await confirm('Local changes conflict with the checkout.', error.stderr, 'Stash and Checkout');
      await stashSave(repoPath, { message: 'mygit: stash before checkout' });
      await run();
      await stashPop(repoPath);
      return;
    }
    throw error;
  }
}

async function recordCheckout(store: Store, label: string, run: () => Promise<void>): Promise<void> {
  const before = await snapshotHead(store.repoPath);
  await checkoutWithStash(store, run);
  const after = await snapshotHead(store.repoPath);
  store.journal.record(refMoveEntry(store.repoPath, label, before, after, target => checkoutSnapshot(store.repoPath, target)));
}

/** Records a history rewrite of the checked-out branch, undone with `reset --keep`. */
async function recordRewrite(store: Store, label: string, run: () => Promise<void>): Promise<void> {
  const repoPath = store.repoPath;
  const before = await snapshotHead(repoPath);
  await run();
  const state = await runGit(repoPath, ['rev-parse', '--git-path', 'rebase-merge']).then(p => fs.stat(path.resolve(repoPath, p.trim())).then(() => true, () => false));
  if (state) return;
  const after = await snapshotHead(repoPath);
  if (sameHead(before, after)) return;
  store.journal.record(refMoveEntry(repoPath, label, before, after, async target => {
    if (target.sha) await resetTo(repoPath, target.sha, 'keep');
  }));
}

async function pushCurrent(store: Store, force: boolean): Promise<void> {
  const repoPath = store.repoPath;
  const { head, remotes } = store.getState();
  if (!head.branch) throw new Error('Push needs a checked-out branch; HEAD is detached.');
  if (force) {
    await confirm('Force push is a destructive action and cannot be undone.', `${head.branch} on the remote is overwritten with the local history (--force-with-lease).`, 'Force Push');
  }
  try {
    if (head.upstream) await push(repoPath, { force });
    else {
      const remote = remotes[0]?.name;
      if (!remote) throw new Error('This repository has no remote to push to.');
      await push(repoPath, { remote, branch: head.branch, setUpstream: true, force });
    }
  } catch (error) {
    if (!(error instanceof PushRejectedError)) throw error;
    const choice = await confirm(
      'Push rejected: the remote has commits that are not in your branch.',
      error.detail,
      'Pull',
      'Force Push'
    );
    if (choice === 'Pull') await pull(repoPath, store.getState().repoPrefs.defaultPull === 'fetch' ? 'ff' : store.getState().repoPrefs.defaultPull, config().get('autoPrune', true));
    else await pushCurrent(store, true);
  }
}

async function chooseMainline(repoPath: string, sha: string, verb: string): Promise<number | undefined> {
  const parents = (await runGit(repoPath, ['rev-list', '--parents', '-n', '1', sha])).trim().split(' ').slice(1);
  if (parents.length < 2) return undefined;
  const items = await Promise.all(parents.map(async (parent, index) => ({
    label: `Parent ${index + 1}: ${parent.slice(0, 7)}`,
    description: (await runGit(repoPath, ['log', '-1', '--format=%s', parent])).trim(),
    mainline: index + 1,
  })));
  const pick = await vscode.window.showQuickPick(items, { title: `${verb} merge commit: choose the mainline parent` });
  if (!pick) throw new CancelledError();
  return pick.mainline;
}

async function savePatch(repoPath: string, name: string, text: string): Promise<void> {
  if (!text.trim()) throw new Error('There are no changes to put in a patch.');
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(repoPath, `${name}.patch`)),
    filters: { Patch: ['patch', 'diff'] },
  });
  if (!target) throw new CancelledError();
  await vscode.workspace.fs.writeFile(target, Buffer.from(text, 'utf8'));
}

async function dirtyDocument(repoPath: string, filePath: string): Promise<vscode.TextDocument | undefined> {
  const absolute = path.join(repoPath, filePath);
  return vscode.workspace.textDocuments.find(doc => doc.isDirty && doc.uri.fsPath === absolute);
}

/** Staging a file with unsaved editor changes asks whether to save first. */
async function saveBeforeStage(repoPath: string, paths: string[]): Promise<void> {
  for (const filePath of paths) {
    const doc = await dirtyDocument(repoPath, filePath);
    if (!doc) continue;
    const choice = await confirm(`${filePath} has unsaved changes.`, 'Staging uses the content on disk.', 'Save and Stage', 'Stage Saved Changes Only');
    if (choice === 'Save and Stage') await doc.save();
  }
}

export function revisionUri(repoPath: string, rev: string, filePath: string): vscode.Uri {
  if (rev === 'working-tree') return vscode.Uri.file(path.join(repoPath, filePath));
  return vscode.Uri.from({ scheme: 'mygit-rev', path: `/${filePath}`, query: new URLSearchParams({ rev, repo: repoPath }).toString() });
}

async function openExternalDiff(store: Store, file: OpenFile): Promise<void> {
  const repoPath = store.repoPath;
  if (config().get<string>('diffTool', 'vscode') === 'gitConfig') {
    const args = ['difftool', '-y'];
    if (file.source === 'staged') args.push('--cached');
    else if (file.source === 'commit') args.push(`${file.sha}^`, file.sha);
    else if (file.source === 'range') args.push(file.base ?? EMPTY_TREE, file.sha);
    args.push('--', file.path);
    void runGit(repoPath, args, { timeoutMs: 0 }).catch(error => vscode.window.showErrorMessage(String(error.message ?? error)));
    return;
  }
  let left: string;
  let right: string;
  switch (file.source) {
    case 'unstaged': left = 'index'; right = 'working-tree'; break;
    case 'staged': left = 'HEAD'; right = 'index'; break;
    case 'commit': left = `${file.sha}^`; right = file.sha; break;
    case 'stash': left = file.untracked ? EMPTY_TREE : `${file.sha}^1`; right = file.untracked ? `${file.sha}^3` : file.sha; break;
    case 'range': left = file.base ?? EMPTY_TREE; right = file.sha; break;
  }
  const title = `${path.posix.basename(file.path)} (${left.slice(0, 12)} ↔ ${right === 'working-tree' ? 'working tree' : right.slice(0, 12)})`;
  await vscode.commands.executeCommand('vscode.diff', revisionUri(repoPath, left, file.path), revisionUri(repoPath, right, file.path), title);
}

/** Interactive rebase precondition checks shared by every entry point. */
async function rebasePlan(store: Store, upstream: string, branch: string | undefined, label: string, kind: RebasePlan['kind']): Promise<RebasePlan> {
  const repoPath = store.repoPath;
  const tip = branch ?? 'HEAD';
  if (await isAncestor(repoPath, tip, upstream)) throw new Error('A branch cannot be rebased onto its own descendant.');
  const commits = await listRange(repoPath, upstream, tip);
  if (commits.length === 0) throw new Error(`${branch ?? 'HEAD'} has no commits that are not already on ${label}.`);
  if (commits.some(entry => entry.merge)) throw new Error('Interactive rebase cannot include merge commits.');
  return {
    kind,
    title: `Interactive Rebase: ${branch ?? store.getState().head.branch ?? 'HEAD'} onto ${label}`,
    upstream,
    upstreamLabel: label,
    branch,
    commits: commits.map(({ sha, message, body, author }) => ({ sha, message, body, author })),
  };
}

/** Rows oldest first for a rebase of `upstream..HEAD` with some commits changed. */
async function rewritePlan(repoPath: string, upstream: string, change: (sha: string) => TodoEntry['action']): Promise<TodoEntry[]> {
  const commits = await listRange(repoPath, upstream, 'HEAD');
  if (commits.some(entry => entry.merge)) throw new Error('This history contains merge commits, which cannot be rewritten here.');
  return commits.reverse().map(entry => ({ sha: entry.sha, action: change(entry.sha) }));
}

export async function handleMessage(host: Host, message: WebviewToExtensionMessage): Promise<void> {
  const { store } = host;
  const repoPath = store.repoPath;
  const state = () => store.getState();
  const prune = () => config().get('autoPrune', true);

  switch (message.type) {
    // ------------------------------------------------------------ views
    case 'ready':
      return;
    case 'graph:select':
      return store.select(message.payload.shas);
    case 'graph:loadMore':
      return store.loadMore();
    case 'graph:loadAll':
      return store.loadAll();
    case 'graph:search':
      return store.search(message.payload.query);
    case 'graph:reveal':
      return store.revealCommit(message.payload.sha);
    case 'view:openFile':
      return store.openFile(message.payload.file);
    case 'view:close':
      return store.closeView();
    case 'view:diffContext':
      return store.setDiffContext(message.payload.context);
    case 'view:fileView':
      return store.setFileView(message.payload.on);
    case 'view:history':
      return store.openHistory(message.payload.path);
    case 'view:historySelect':
      return store.selectHistory(message.payload.sha);
    case 'view:blame':
      return store.openBlame(message.payload.path, message.payload.rev);
    case 'view:merge':
      return store.openMerge(message.payload.path);
    case 'files:listAll':
      return store.listAllFiles(message.payload.rev);
    case 'view:interactiveRebase': {
      const { upstream, branch, label } = message.payload;
      await store.run('Prepare interactive rebase', async () => {
        const plan = await rebasePlan(store, upstream, branch, label, 'rebase');
        store.setState({ view: { kind: 'rebase', plan } });
      }, { refresh: 'none', quiet: true });
      return;
    }
    case 'view:cherryPickMany': {
      const order = new Map(state().commitLog.map((entry, index) => [entry.sha, index]));
      const rows = message.payload.shas
        .map(sha => state().commitLog.find(entry => entry.sha === sha))
        .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
        .sort((a, b) => (order.get(a.sha) ?? 0) - (order.get(b.sha) ?? 0));
      if (rows.some(row => row.parents.length > 1)) {
        void vscode.window.showErrorMessage('Multi-commit cherry-pick cannot include merge commits.');
        return;
      }
      store.setState({
        view: {
          kind: 'rebase',
          plan: {
            kind: 'cherry-pick',
            title: `Cherry-pick ${rows.length} commits onto ${state().head.branch ?? 'HEAD'}`,
            upstream: 'HEAD',
            upstreamLabel: state().head.branch ?? 'HEAD',
            commits: rows.map(row => ({ sha: row.sha, message: row.message, body: row.body, author: row.author })),
          },
        },
      });
      return;
    }

    // ------------------------------------------------------------ staging
    case 'stage:paths': {
      const { paths } = message.payload;
      await store.run(paths.length === 1 ? `Stage ${paths[0]}` : `Stage ${paths.length} files`, async () => {
        await saveBeforeStage(repoPath, paths);
        await stageFiles(repoPath, paths);
      }, { refresh: 'working', quiet: true });
      return;
    }
    case 'stage:unstagePaths': {
      const { paths } = message.payload;
      await store.run(paths.length === 1 ? `Unstage ${paths[0]}` : `Unstage ${paths.length} files`, () => unstageFiles(repoPath, paths), { refresh: 'working', quiet: true });
      return;
    }
    case 'stage:all':
      await store.run('Stage all changes', async () => {
        await saveBeforeStage(repoPath, state().workingTreeStatus.unstaged.map(file => file.path));
        await stageAll(repoPath);
      }, { refresh: 'working', quiet: true });
      return;
    case 'stage:unstageAll':
      await store.run('Unstage all changes', () => unstageAll(repoPath), { refresh: 'working', quiet: true });
      return;
    case 'stage:discard': {
      const { files } = message.payload;
      await store.run(files.length === 1 ? `Discard ${files[0].path}` : `Discard ${files.length} files`, async () => {
        const snapshot = await Promise.all(files.map(async file => ({
          ...file,
          content: await fs.readFile(path.join(repoPath, file.path)).catch(() => null),
        })));
        await discardFiles(repoPath, files);
        store.journal.record({
          label: files.length === 1 ? `Discard ${files[0].path}` : `Discard ${files.length} files`,
          undo: async () => {
            for (const file of snapshot) {
              const absolute = path.join(repoPath, file.path);
              if (file.content === null) await fs.rm(absolute, { force: true });
              else {
                await fs.mkdir(path.dirname(absolute), { recursive: true });
                await fs.writeFile(absolute, file.content);
              }
            }
          },
          redo: () => discardFiles(repoPath, files),
          isAfter: async () => true,
          isBefore: async () => true,
        });
      }, { refresh: 'working' });
      return;
    }
    case 'stage:discardAll':
      await store.run('Discard all changes', async () => {
        const untracked = state().workingTreeStatus.unstaged.filter(file => file.untracked);
        const contents = await Promise.all(untracked.map(async file => ({
          path: file.path,
          content: await fs.readFile(path.join(repoPath, file.path)).catch(() => null),
        })));
        const snapshot = await stashCreate(repoPath);
        await discardAll(repoPath);
        store.journal.record({
          label: 'Discard all changes',
          undo: async () => {
            if (snapshot) await runGit(repoPath, ['stash', 'apply', '--index', snapshot]);
            for (const file of contents) {
              if (file.content === null) continue;
              const absolute = path.join(repoPath, file.path);
              await fs.mkdir(path.dirname(absolute), { recursive: true });
              await fs.writeFile(absolute, file.content);
            }
          },
          redo: () => discardAll(repoPath),
          isAfter: async () => true,
          isBefore: async () => true,
        });
      }, { refresh: 'working' });
      return;
    case 'stage:lines': {
      const { path: filePath, source, action, hunk, lines, untracked } = message.payload;
      const verb = action === 'stage' ? 'Stage' : action === 'unstage' ? 'Unstage' : 'Discard';
      await store.run(`${verb} ${lines ? 'lines' : 'hunk'} in ${filePath}`, async () => {
        if (untracked) await intentToAdd(repoPath, filePath);
        const diff = await getWorkingFileDiff(repoPath, filePath, source === 'staged', 'hunk');
        const context = state().view.kind === 'diff' && (state().view as { context: string }).context === 'full'
          ? await getWorkingFileDiff(repoPath, filePath, source === 'staged', 'full')
          : diff;
        const patch = buildPartialPatch(context, { hunk, lines }, action !== 'stage');
        await applyPatch(repoPath, patch, { cached: action !== 'discard', reverse: action !== 'stage' });
      }, { refresh: 'working', quiet: action !== 'discard' });
      return;
    }
    case 'hunk:revert': {
      const { file, hunk, lines } = message.payload;
      await store.run(`Revert ${lines ? 'lines' : 'hunk'} of ${file.path}`, async () => {
        const context = state().view.kind === 'diff' ? (state().view as { context: 'hunk' | 'full' }).context : 'hunk';
        const diff = file.source === 'commit'
          ? await getCommitFileDiff(repoPath, file.sha, file.path, context)
          : await getRangeFileDiff(repoPath, file.base ?? EMPTY_TREE, file.sha, file.path, context);
        await applyPatch(repoPath, buildPartialPatch(diff, { hunk, lines }, true), { cached: false, reverse: true });
      }, { refresh: 'working' });
      return;
    }

    // ------------------------------------------------------------ files
    case 'file:open': {
      const { path: filePath, rev } = message.payload;
      const uri = revisionUri(repoPath, rev ?? 'working-tree', filePath);
      await vscode.commands.executeCommand('vscode.open', uri);
      return;
    }
    case 'file:externalDiff':
      return openExternalDiff(store, message.payload.file);
    case 'file:reveal':
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(path.join(repoPath, message.payload.path)));
      return;
    case 'file:create': {
      const filePath = message.payload.path.replace(/\\/g, '/').replace(/^\/+/, '');
      await store.run(`Create ${filePath}`, async () => {
        const absolute = await createFile(repoPath, filePath);
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(absolute));
      }, { refresh: 'working' });
      return;
    }
    case 'file:delete': {
      const { paths } = message.payload;
      await store.run(paths.length === 1 ? `Delete ${paths[0]}` : `Delete ${paths.length} files`, () => deleteFiles(repoPath, paths), { refresh: 'working' });
      return;
    }
    case 'file:ignore': {
      const { path: filePath, mode, stopTracking } = message.payload;
      await store.run(`Ignore ${filePath}`, () => ignoreFile(repoPath, filePath, mode, stopTracking), { refresh: 'working' });
      return;
    }
    case 'file:restore': {
      const { sha, paths } = message.payload;
      const view = state().selectionView;
      const deleted = new Set(view.kind === 'commit' ? view.detail.files.filter(file => file.status === 'D').map(file => file.path) : []);
      await store.run(paths.length === 1 ? `Restore ${paths[0]} from ${sha.slice(0, 7)}` : `Restore ${paths.length} files from ${sha.slice(0, 7)}`, async () => {
        const present = paths.filter(filePath => !deleted.has(filePath));
        const removed = paths.filter(filePath => deleted.has(filePath));
        if (present.length > 0) await restoreFromCommit(repoPath, sha, present);
        // A file the commit deleted is restored from the commit's parent.
        if (removed.length > 0) await restoreFromCommit(repoPath, `${sha}^`, removed);
      }, { refresh: 'working' });
      return;
    }
    case 'file:takeSide': {
      const { paths, side } = message.payload;
      await store.run(`Take ${side === 'ours' ? 'current' : 'incoming'} for ${paths.length === 1 ? paths[0] : `${paths.length} files`}`, async () => {
        await takeSide(repoPath, paths, side);
        if (config().get('deleteOrigFiles', true)) await deleteOrigFiles(repoPath);
      }, { refresh: 'working' });
      return;
    }
    case 'patch:commits': {
      const order = new Map(state().commitLog.map((entry, index) => [entry.sha, index]));
      const shas = [...message.payload.shas].sort((a, b) => (order.get(b) ?? 0) - (order.get(a) ?? 0));
      const oldest = shas[0];
      const newest = shas[shas.length - 1];
      await store.run('Create patch', async () => {
        const parent = state().commitLog.find(entry => entry.sha === oldest)?.parents[0];
        const text = parent
          ? await createPatch(repoPath, { kind: 'commits', from: parent, to: newest })
          : await runGit(repoPath, ['format-patch', '--stdout', '--root', newest]);
        await savePatch(repoPath, shas.length === 1 ? oldest.slice(0, 7) : `${oldest.slice(0, 7)}-${newest.slice(0, 7)}`, text);
      }, { refresh: 'none' });
      return;
    }
    case 'patch:files': {
      const { from, to, paths } = message.payload;
      await store.run('Create patch', async () => {
        const text = await createPatch(repoPath, { kind: 'paths', from, to: to as 'working-tree', paths });
        await savePatch(repoPath, paths.length === 1 ? path.posix.basename(paths[0]) : 'changes', text);
      }, { refresh: 'none' });
      return;
    }
    case 'merge:save': {
      const { path: filePath, content } = message.payload;
      await store.run(`Resolve ${filePath}`, async () => {
        await fs.writeFile(path.join(repoPath, filePath), content);
        await stageFiles(repoPath, [filePath]);
        if (config().get('deleteOrigFiles', true)) await deleteOrigFiles(repoPath);
        store.closeView();
      }, { refresh: 'working' });
      return;
    }
    case 'merge:external': {
      const uri = vscode.Uri.file(path.join(repoPath, message.payload.path));
      if (config().get<string>('mergeTool', 'vscode') === 'gitConfig') {
        void runGit(repoPath, ['mergetool', '-y', '--', message.payload.path], { timeoutMs: 0 }).then(() => store.refreshWorking(), error => vscode.window.showErrorMessage(String(error.message ?? error)));
        return;
      }
      await vscode.commands.executeCommand('git.openMergeEditor', uri).then(undefined, () => vscode.commands.executeCommand('vscode.open', uri));
      return;
    }

    // ------------------------------------------------------------ commits
    case 'commit:create': {
      const { summary, description, amend, push: pushAfter, skipHooks, stageAll: stageFirst } = message.payload;
      const text = description.trim() ? `${summary.trim()}\n\n${description.trim()}` : summary.trim();
      const label = amend ? 'Amend commit' : 'Commit';
      await store.run(label, async () => {
        const before = await snapshotHead(repoPath);
        if (stageFirst) await stageAll(repoPath);
        await commit(repoPath, text, { amend, skipHooks, sign: config().get('gpgSign', false) });
        if (config().get('deleteOrigFiles', true)) await deleteOrigFiles(repoPath);
        const after = await snapshotHead(repoPath);
        if (before.sha) {
          store.journal.record(refMoveEntry(repoPath, amend ? 'Commit amend' : `Commit "${summary.trim()}"`, before, after, async target => {
            if (target.sha) await resetTo(repoPath, target.sha, 'soft');
          }));
        } else store.journal.clear();
        if (pushAfter) {
          await store.refreshAll();
          await pushCurrent(store, false);
        }
      });
      return;
    }
    case 'commit:editMessage':
      await store.run('Edit commit message', async () => {
        await recordRewrite(store, 'Commit reword', () => editHeadMessage(repoPath, message.payload.message));
      });
      return;
    case 'commit:revert': {
      const { sha } = message.payload;
      await store.run(`Revert ${sha.slice(0, 7)}`, async () => {
        const mainline = await chooseMainline(repoPath, sha, 'Revert');
        await revertCommit(repoPath, sha, mainline);
      });
      return;
    }
    case 'commit:reset': {
      const { sha, mode, branch } = message.payload;
      const headBranch = state().head.branch;
      await store.run(`Reset ${branch ?? headBranch ?? 'HEAD'} to ${sha.slice(0, 7)} (${mode})`, async () => {
        if (branch && branch !== headBranch) {
          const before = (await revParse(repoPath, `refs/heads/${branch}`))!;
          await moveBranch(repoPath, branch, sha);
          store.journal.record({
            label: `Reset ${branch}`,
            undo: () => moveBranch(repoPath, branch, before),
            redo: () => moveBranch(repoPath, branch, sha),
            isAfter: async () => (await revParse(repoPath, `refs/heads/${branch}`)) === sha,
            isBefore: async () => (await revParse(repoPath, `refs/heads/${branch}`)) === before,
          });
          return;
        }
        const before = await snapshotHead(repoPath);
        const snapshot = mode === 'hard' ? await stashCreate(repoPath) : null;
        await resetTo(repoPath, sha, mode);
        const after = await snapshotHead(repoPath);
        store.journal.record({
          ...refMoveEntry(repoPath, `Reset ${headBranch ?? 'HEAD'} (${mode})`, before, after, async () => undefined),
          undo: async () => {
            await resetTo(repoPath, before.sha!, mode);
            if (snapshot) await runGit(repoPath, ['stash', 'apply', '--index', snapshot]);
          },
          redo: () => resetTo(repoPath, sha, mode),
        });
      });
      return;
    }
    case 'commit:cherryPick': {
      const { sha } = message.payload;
      await store.run(`Cherry-pick ${sha.slice(0, 7)}`, async () => {
        const mainline = await chooseMainline(repoPath, sha, 'Cherry-pick');
        await cherryPick(repoPath, sha, mainline);
      });
      return;
    }
    case 'commit:squash': {
      const { shas } = message.payload;
      await store.run(`Squash ${shas.length} commits`, async () => {
        const order = new Map(state().commitLog.map((entry, index) => [entry.sha, index]));
        const sorted = [...shas].sort((a, b) => (order.get(b) ?? 0) - (order.get(a) ?? 0));
        const oldest = sorted[0];
        const parent = state().commitLog.find(entry => entry.sha === oldest)?.parents[0];
        if (!parent) throw new Error('The oldest commit of a squash needs a parent.');
        for (const sha of shas) {
          if (!(await isAncestor(repoPath, sha, 'HEAD'))) throw new Error('Squash works on commits of the checked-out branch.');
        }
        const squashed = new Set(sorted.slice(1));
        const entries = await rewritePlan(repoPath, parent, sha => (squashed.has(sha) ? 'squash' : 'pick'));
        await recordRewrite(store, `Squash ${shas.length} commits`, () => interactiveRebase(repoPath, { upstream: parent, entries }));
      });
      return;
    }
    case 'commit:drop': {
      const { sha } = message.payload;
      await store.run(`Drop ${sha.slice(0, 7)}`, async () => {
        const parent = state().commitLog.find(entry => entry.sha === sha)?.parents[0];
        if (!parent) throw new Error('The root commit cannot be dropped.');
        const entries = await rewritePlan(repoPath, parent, entrySha => (entrySha === sha ? 'drop' : 'pick'));
        await recordRewrite(store, 'Commit drop', () => interactiveRebase(repoPath, { upstream: parent, entries }));
      });
      return;
    }
    case 'commit:checkout': {
      const { sha } = message.payload;
      await store.run(`Checkout ${sha.slice(0, 7)}`, () => recordCheckout(store, `Checkout ${sha.slice(0, 7)}`, () => checkoutDetached(repoPath, sha)));
      return;
    }

    // ------------------------------------------------------------ branches
    case 'branch:checkout': {
      const { name } = message.payload;
      await store.run(`Checkout ${name}`, () => recordCheckout(store, `Checkout ${name}`, () => checkoutBranch(repoPath, name)));
      return;
    }
    case 'branch:checkoutRemote': {
      const { remote, branch } = message.payload;
      const localExists = state().branches.local.some(entry => entry.name === branch);
      await store.run(`Checkout ${remote}/${branch}`, () => recordCheckout(store, `Checkout ${branch}`, () => checkoutRemoteBranch(repoPath, remote, branch, localExists)));
      return;
    }
    case 'branch:create': {
      const { name, from, checkout } = message.payload;
      await store.run(`Create branch ${name}`, async () => {
        if (!(await isValidBranchName(repoPath, name))) throw new Error(`"${name}" is not a valid branch name.`);
        if (checkout) await recordCheckout(store, `Create and checkout ${name}`, () => createBranch(repoPath, name, from, true));
        else await createBranch(repoPath, name, from, false);
      });
      return;
    }
    case 'branch:rename': {
      const { from, to } = message.payload;
      await store.run(`Rename ${from} to ${to}`, async () => {
        if (!(await isValidBranchName(repoPath, to))) throw new Error(`"${to}" is not a valid branch name.`);
        await renameBranch(repoPath, from, to);
        const pinned = state().repoPrefs.pinned.map(name => (name === from ? to : name));
        store.setRepoPrefs({ pinned });
      });
      return;
    }
    case 'branch:delete': {
      const { names, alsoRemote } = message.payload;
      await store.run(names.length === 1 ? `Delete ${names[0]}` : `Delete ${names.length} branches`, async () => {
        const deleted: { name: string; sha: string; upstream?: string }[] = [];
        for (const name of names) {
          const branch = state().branches.local.find(entry => entry.name === name);
          if (!branch) continue;
          try {
            await deleteLocalBranch(repoPath, name, false);
          } catch (error) {
            if (!(error instanceof UnmergedBranchError)) throw error;
            await confirm(`${name} is not fully merged.`, 'Its unmerged commits stay reachable only through the reflog (or Undo).', 'Force Delete');
            await deleteLocalBranch(repoPath, name, true);
          }
          deleted.push({ name, sha: branch.sha, upstream: branch.upstream });
          if (alsoRemote && branch.upstream && !branch.upstreamGone) {
            const slash = branch.upstream.indexOf('/');
            await deleteRemoteBranch(repoPath, branch.upstream.slice(0, slash), branch.upstream.slice(slash + 1));
          }
        }
        if (deleted.length === 0) return;
        store.journal.record({
          label: deleted.length === 1 ? `Delete branch ${deleted[0].name}` : `Delete ${deleted.length} branches`,
          undo: async () => {
            for (const entry of deleted) {
              await createBranch(repoPath, entry.name, entry.sha, false);
              if (entry.upstream && !alsoRemote) await setUpstream(repoPath, entry.name, entry.upstream).catch(() => undefined);
            }
          },
          redo: async () => {
            for (const entry of deleted) await deleteLocalBranch(repoPath, entry.name, true);
          },
          isAfter: async () => {
            for (const entry of deleted) if (await revParse(repoPath, `refs/heads/${entry.name}`)) return false;
            return true;
          },
          isBefore: async () => {
            for (const entry of deleted) if ((await revParse(repoPath, `refs/heads/${entry.name}`)) !== entry.sha) return false;
            return true;
          },
        });
      });
      return;
    }
    case 'branch:deleteRemote': {
      const { remote, branch } = message.payload;
      await store.run(`Delete ${remote}/${branch}`, () => deleteRemoteBranch(repoPath, remote, branch));
      return;
    }
    case 'branch:setUpstream': {
      const { branch, remote, remoteBranch } = message.payload;
      await store.run(`Set upstream of ${branch} to ${remote}/${remoteBranch}`, async () => {
        if (await revParse(repoPath, `refs/remotes/${remote}/${remoteBranch}`)) await setUpstream(repoPath, branch, `${remote}/${remoteBranch}`);
        else await push(repoPath, { remote, branch, remoteBranch, setUpstream: true });
      });
      return;
    }
    case 'branch:fastForward': {
      const { branch, target } = message.payload;
      await store.run(`Fast-forward ${branch} to ${target}`, () => fastForwardBranch(repoPath, branch, target, branch === state().head.branch));
      return;
    }
    case 'branch:pull': {
      const { branch } = message.payload;
      await store.run(`Pull ${branch} (fast-forward)`, () => pullBranch(repoPath, branch));
      void host.checkConflicts(false);
      return;
    }
    case 'branch:merge': {
      const { ref, into } = message.payload;
      const squash = config().get('squashMerge', false);
      await store.run(`Merge ${ref} into ${into ?? state().head.branch ?? 'HEAD'}`, async () => {
        if (into && into !== state().head.branch) await recordCheckout(store, `Checkout ${into}`, () => checkoutBranch(repoPath, into));
        await mergeRef(repoPath, ref, { squash });
        store.journal.clear();
      });
      return;
    }
    case 'branch:rebase': {
      const { onto, branch } = message.payload;
      await store.run(`Rebase ${branch ?? state().head.branch ?? 'HEAD'} onto ${onto}`, async () => {
        if (branch && branch !== state().head.branch) await checkoutWithStash(store, () => checkoutBranch(repoPath, branch));
        await recordRewrite(store, `Rebase onto ${onto}`, () => rebase(repoPath, { onto }));
      });
      return;
    }
    case 'branch:rebaseRange': {
      const { onto, from } = message.payload;
      await store.run(`Rebase commits onto ${onto}`, async () => {
        const parent = state().commitLog.find(entry => entry.sha === from)?.parents[0];
        if (!parent) throw new Error('The first commit of the range needs a parent.');
        const merges = (await runGit(repoPath, ['rev-list', '--merges', `${parent}..HEAD`])).trim();
        if (merges) throw new Error('The commits between the selection and the branch head include merge commits.');
        await recordRewrite(store, `Rebase onto ${onto}`, () => rebase(repoPath, { onto, upstream: parent }));
      });
      return;
    }
    case 'branch:pushTo': {
      const { branch, remote, remoteBranch, setUpstream: track } = message.payload;
      await store.run(`Push ${branch} to ${remote}/${remoteBranch}`, async () => {
        try {
          await push(repoPath, { remote, branch, remoteBranch, setUpstream: track });
        } catch (error) {
          if (!(error instanceof PushRejectedError)) throw error;
          await confirm('Push rejected: the remote branch has commits that are not in yours.', error.detail, 'Force Push');
          await confirm('Force push is a destructive action and cannot be undone.', `${remote}/${remoteBranch} is overwritten.`, 'Force Push');
          await push(repoPath, { remote, branch, remoteBranch, setUpstream: track, force: true });
        }
      });
      return;
    }
    case 'branch:pin': {
      const { name, pinned } = message.payload;
      store.setRepoPrefs({ pinned: pinned ? [name] : state().repoPrefs.pinned.filter(entry => entry !== name) });
      await store.refreshGraph();
      return;
    }

    // ------------------------------------------------------------ visibility
    case 'refs:hide': {
      const { ids, hidden } = message.payload;
      const set = new Set(state().repoPrefs.hidden);
      for (const id of ids) {
        if (hidden) set.add(id);
        else set.delete(id);
      }
      store.setRepoPrefs({ hidden: [...set] });
      await store.refreshGraph();
      return;
    }
    case 'refs:solo': {
      const { ids, solo } = message.payload;
      const set = new Set(state().repoPrefs.solo);
      for (const id of ids) {
        if (solo) set.add(id);
        else set.delete(id);
      }
      store.setRepoPrefs({ solo: [...set] });
      store.publishLog();
      return;
    }
    case 'graph:smartVisibility':
      store.setRepoPrefs({ smartVisibility: message.payload.on });
      await store.refreshGraph();
      return;
    case 'prefs:columns':
      store.setRepoPrefs({ columns: message.payload.columns });
      return;
    case 'prefs:sections':
      store.setRepoPrefs({ sectionsHidden: message.payload.hidden });
      return;
    case 'prefs:collapsed':
      store.setRepoPrefs({ collapsed: message.payload.collapsed });
      return;

    // ------------------------------------------------------------ tags
    case 'tag:create': {
      const { name, ref, message: annotation } = message.payload;
      await store.run(`Create tag ${name}`, () => createTag(repoPath, name, ref, annotation));
      return;
    }
    case 'tag:delete':
      await store.run(`Delete tag ${message.payload.name}`, () => deleteTag(repoPath, message.payload.name));
      return;
    case 'tag:deleteRemote':
      await store.run(`Delete tag ${message.payload.name} from ${message.payload.remote}`, () => deleteRemoteTag(repoPath, message.payload.name, message.payload.remote));
      return;
    case 'tag:push':
      await store.run(`Push tag ${message.payload.name} to ${message.payload.remote}`, () => pushTag(repoPath, message.payload.name, message.payload.remote));
      return;
    case 'tag:annotate':
      await store.run(`Annotate tag ${message.payload.name}`, () => annotateTag(repoPath, message.payload.name, message.payload.message));
      return;
    case 'tag:fastForward': {
      const tag = state().tags.find(entry => entry.name === message.payload.name);
      if (!tag) return;
      await store.run(`Fast-forward tag ${tag.name}`, () => fastForwardTag(repoPath, tag));
      return;
    }

    // ------------------------------------------------------------ remotes
    case 'remote:fetch': {
      const { remote } = message.payload;
      await store.run(remote ? `Fetch ${remote}` : 'Fetch all', () => fetch(repoPath, { remote, prune: prune(), writeCommitGraph: config().get('writeCommitGraph', true) }));
      void host.checkConflicts(false);
      return;
    }
    case 'remote:pull': {
      const mode: PullMode = message.payload.mode ?? state().repoPrefs.defaultPull;
      const labels: Record<PullMode, string> = {
        fetch: 'Fetch all',
        ff: 'Pull (fast-forward if possible)',
        'ff-only': 'Pull (fast-forward only)',
        rebase: 'Pull (rebase)',
      };
      await store.run(labels[mode], async () => {
        if (mode !== 'fetch' && !state().head.upstream) throw new Error(`${state().head.branch ?? 'HEAD'} has no upstream to pull from. Set one with "Set Upstream".`);
        await pull(repoPath, mode, prune());
        if (mode !== 'fetch') store.journal.clear();
      });
      return;
    }
    case 'remote:setDefaultPull':
      store.setRepoPrefs({ defaultPull: message.payload.mode });
      return;
    case 'remote:push':
      await store.run(message.payload.force ? 'Force push' : 'Push', () => pushCurrent(store, message.payload.force));
      return;
    case 'remote:add': {
      const { name, fetchUrl, pushUrl } = message.payload;
      await store.run(`Add remote ${name}`, async () => {
        await addRemote(repoPath, name, fetchUrl, pushUrl || undefined);
        await fetch(repoPath, { remote: name, prune: false }).catch(error => vscode.window.showWarningMessage(`Remote ${name} added; fetching it failed: ${error.message}`));
      });
      return;
    }
    case 'remote:edit': {
      const { name, next } = message.payload;
      await store.run(`Edit remote ${name}`, async () => {
        const stored = (await listRemotes(repoPath)).find(entry => entry.name === name);
        // The dialog shows redacted URLs: an unchanged field keeps the stored URL with its credentials.
        const keep = (value: string, original: string | undefined) => (original && value === redactUrl(original) ? original : value);
        await editRemote(repoPath, name, { ...next, fetchUrl: keep(next.fetchUrl, stored?.fetchUrl), pushUrl: keep(next.pushUrl, stored?.pushUrl) });
      });
      return;
    }
    case 'remote:copyUrl': {
      const stored = (await listRemotes(repoPath)).find(entry => entry.name === message.payload.name);
      if (stored) await vscode.env.clipboard.writeText(stored.fetchUrl);
      return;
    }
    case 'remote:remove': {
      const { name } = message.payload;
      await store.run(`Remove remote ${name}`, async () => {
        const snapshot = await snapshotRemote(repoPath, name);
        await removeRemote(repoPath, name);
        store.journal.record({
          label: `Remove remote ${name}`,
          undo: () => restoreRemote(repoPath, snapshot),
          redo: () => removeRemote(repoPath, name),
          isAfter: async () => !(await runGit(repoPath, ['remote'])).split('\n').includes(name),
          isBefore: async () => (await runGit(repoPath, ['remote'])).split('\n').includes(name),
        });
      });
      return;
    }

    // ------------------------------------------------------------ stashes
    case 'stash:save': {
      const { message: stashMessage, paths } = message.payload;
      await store.run(paths ? `Stash ${paths.length === 1 ? paths[0] : `${paths.length} files`}` : 'Stash changes', () => stashSave(repoPath, { message: stashMessage || undefined, paths }));
      return;
    }
    case 'stash:apply':
      await store.run(`Apply ${message.payload.ref}`, () => stashApply(repoPath, message.payload.ref));
      return;
    case 'stash:pop':
      await store.run(`Pop ${message.payload.ref ?? 'stash'}`, async () => {
        if (state().stashes.length === 0) throw new Error('There is no stash to pop.');
        await stashPop(repoPath, message.payload.ref);
      });
      return;
    case 'stash:drop':
      await store.run(`Delete ${message.payload.ref}`, () => stashDrop(repoPath, message.payload.ref));
      return;
    case 'stash:rename': {
      const { ref, sha, message: next } = message.payload;
      await store.run(`Rename ${ref}`, () => stashRename(repoPath, ref, sha, next));
      return;
    }

    // ------------------------------------------------------------ in-progress operations
    case 'op:continue':
    case 'op:abort':
    case 'op:skip': {
      const operation = state().repo?.operation;
      if (!operation) return;
      const verb = message.type === 'op:continue' ? 'Continue' : message.type === 'op:abort' ? 'Abort' : 'Skip';
      await store.run(`${verb} ${operation.kind}`, async () => {
        if (message.type === 'op:continue') await continueOperation(repoPath, operation.kind);
        else if (message.type === 'op:abort') await abortOperation(repoPath, operation.kind);
        else await skipOperation(repoPath, operation.kind);
        if (config().get('deleteOrigFiles', true)) await deleteOrigFiles(repoPath);
      });
      return;
    }
    case 'rebase:start': {
      const { plan, entries } = message.payload;
      const label = plan.kind === 'cherry-pick' ? `Cherry-pick ${entries.filter(entry => entry.action !== 'drop').length} commits` : 'Interactive rebase';
      await store.run(label, async () => {
        store.closeView();
        await recordRewrite(store, label, async () => {
          if (plan.branch && plan.branch !== state().head.branch) await checkoutWithStash(store, () => checkoutBranch(repoPath, plan.branch!));
          await interactiveRebase(repoPath, { upstream: plan.upstream, entries });
        });
      });
      return;
    }

    // ------------------------------------------------------------ undo
    case 'undo':
      await store.run('Undo', async () => {
        const label = await store.journal.undo();
        void vscode.window.showInformationMessage(`Undid: ${label}`);
      });
      return;
    case 'redo':
      await store.run('Redo', async () => {
        const label = await store.journal.redo();
        void vscode.window.showInformationMessage(`Redid: ${label}`);
      });
      return;

    // ------------------------------------------------------------ misc
    case 'clipboard:write':
      await vscode.env.clipboard.writeText(message.payload.text);
      return;
    case 'settings:open':
      await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:local.vscode-git-client mygit');
      return;
    case 'template:save': {
      const { summary, description } = message.payload;
      await store.run('Save commit template', () => saveCommitTemplate(repoPath, store.gitDir, summary, description));
      return;
    }
    case 'sparse:set': {
      const { action, rules } = message.payload;
      await store.run(`Sparse checkout: ${action}`, () => setSparseCheckout(repoPath, action, rules));
      return;
    }
    case 'lfs:run':
      await store.run(`LFS ${message.payload.action}`, () => runLfs(repoPath, message.payload.action));
      return;
    case 'conflicts:check':
      await host.checkConflicts(true);
      return;
    case 'conflicts:ignore': {
      const ignored = new Set([...state().repoPrefs.conflictIgnored, ...message.payload.keys]);
      store.setRepoPrefs({ conflictIgnored: [...ignored] });
      return;
    }
    case 'log:clear':
      host.clearLog();
      return;
    case 'command':
      if (message.payload.id.startsWith('mygit.')) await vscode.commands.executeCommand(message.payload.id);
      return;
  }
}
