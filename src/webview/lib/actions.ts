import type { LaneCommit } from '../../git/graph';
import type { FileChange } from '../../git/status';
import type { StashRef, TagRef } from '../../git/refs';
import type { ClientState, DiffSource, OpName, Ops, ResetMode, WebviewToExtensionMessage } from '../../panel/messages';
import type { MenuItem } from '../components/ContextMenu';
import { confirmDialog, promptDialog, type DialogRequest } from '../components/Dialog';
import { branchNameError, dragRefLabel, type Ctx, type DragRef } from './ui';
import { emit } from './events';
import { plural, shortSha } from './format';

export function send<K extends OpName>(ctx: Pick<Ctx, 'dispatch'>, type: K, payload: Ops[K]): void {
  ctx.dispatch({ type, payload } as WebviewToExtensionMessage);
}

const NONE = {} as Record<string, never>;
export { NONE };

const sep: MenuItem = { kind: 'separator' };
const item = (label: string, onSelect: () => void, extra: Partial<Extract<MenuItem, { kind: 'item' }>> = {}): MenuItem => ({ kind: 'item', label, onSelect, ...extra });

// ------------------------------------------------------------------ history helpers

const ancestorCache = new WeakMap<LaneCommit[], Map<string, Set<string>>>();

/** Commits reachable from `sha` within the loaded graph (sha included). */
export function ancestorsOf(commitLog: LaneCommit[], sha: string | null): Set<string> {
  if (!sha) return new Set();
  let perLog = ancestorCache.get(commitLog);
  if (!perLog) {
    perLog = new Map();
    ancestorCache.set(commitLog, perLog);
  }
  const cached = perLog.get(sha);
  if (cached) return cached;
  const bySha = new Map(commitLog.map(commit => [commit.sha, commit]));
  const result = new Set<string>();
  const stack = [sha];
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (result.has(next)) continue;
    result.add(next);
    const commit = bySha.get(next);
    if (commit && !commit.stash) stack.push(...commit.parents);
  }
  perLog.set(sha, result);
  return result;
}

export function branchesAt(state: ClientState, sha: string): string[] {
  return state.branches.local.filter(branch => branch.sha === sha).map(branch => branch.name);
}

/** Selected commits sorted newest first, without the WIP row or stashes. */
export function selectedCommits(state: ClientState): LaneCommit[] {
  const rows = new Map(state.commitLog.map((commit, index) => [commit.sha, { commit, index }]));
  return state.selection
    .map(sha => rows.get(sha))
    .filter((row): row is { commit: LaneCommit; index: number } => row !== undefined && !row.commit.stash)
    .sort((a, b) => a.index - b.index)
    .map(row => row.commit);
}

/** Two or more commits on one first-parent line with no merges and a parent below the oldest. */
export function isSquashable(commits: LaneCommit[]): boolean {
  if (commits.length < 2) return false;
  if (commits.some(commit => commit.parents.length !== 1)) return false;
  return commits.every((commit, index) => index === commits.length - 1 || commit.parents[0] === commits[index + 1].sha);
}

// ------------------------------------------------------------------ flows

export function createBranchAt(ctx: Ctx, sha: string): void {
  ctx.ui.startInline({ kind: 'branch', sha });
}

export function createTagAt(ctx: Ctx, sha: string): void {
  ctx.ui.startInline({ kind: 'tag', sha });
}

export function annotatedTagDialog(ctx: Ctx, sha: string): void {
  const existing = ctx.state.tags.map(tag => tag.name);
  ctx.ui.openDialog({
    title: 'Create annotated tag',
    body: `Tag ${shortSha(sha)} with a message.`,
    fields: [
      { kind: 'text', id: 'name', label: 'Tag name', placeholder: 'v1.0.0', required: true, validate: value => (existing.includes(value) ? `${value} already exists.` : branchNameError(value)) },
      { kind: 'textarea', id: 'message', label: 'Message', required: true, rows: 4 },
    ],
    actions: [{ label: 'Create tag', onSelect: values => send(ctx, 'tag:create', { name: String(values.name), ref: sha, message: String(values.message) }) }],
  });
}

export function checkoutLocal(ctx: Ctx, name: string): void {
  if (name === ctx.state.head.branch) return;
  send(ctx, 'branch:checkout', { name });
}

export function checkoutRemote(ctx: Ctx, remote: string, branch: string): void {
  send(ctx, 'branch:checkoutRemote', { remote, branch });
}

export function renameDialog(ctx: Ctx, name: string): void {
  const existing = ctx.state.branches.local.map(branch => branch.name).filter(entry => entry !== name);
  ctx.ui.openDialog(promptDialog('Rename branch', `New name for ${name}`, 'Rename', to => send(ctx, 'branch:rename', { from: name, to }), {
    value: name,
    validate: value => branchNameError(value, existing),
  }));
}

export function deleteBranchesDialog(ctx: Ctx, names: string[]): void {
  const branches = ctx.state.branches.local.filter(branch => names.includes(branch.name) && !branch.isHead);
  if (branches.length === 0) return;
  const withUpstream = branches.filter(branch => branch.upstream && !branch.upstreamGone);
  ctx.ui.openDialog({
    title: branches.length === 1 ? `Delete ${branches[0].name}` : `Delete ${branches.length} branches`,
    body: 'Deleting a branch is permanent. Unmerged branches ask again before a force delete.',
    fields: [
      ...(branches.length > 1 ? [{ kind: 'list' as const, items: branches.map(branch => branch.name) }] : []),
      ...(withUpstream.length > 0
        ? [{ kind: 'checkbox' as const, id: 'remote', label: `Also delete the remote ${withUpstream.length === 1 ? `branch ${withUpstream[0].upstream}` : 'branches'}`, value: false }]
        : []),
    ],
    actions: [{
      label: 'Delete',
      tone: 'danger',
      onSelect: values => send(ctx, 'branch:delete', { names: branches.map(branch => branch.name), alsoRemote: Boolean(values.remote) }),
    }],
  });
}

export function setUpstreamDialog(ctx: Ctx, branch: string): void {
  const remotes = ctx.state.remotes;
  if (remotes.length === 0) {
    ctx.ui.openDialog({ title: 'Set upstream', body: 'This repository has no remotes. Add one from the REMOTE section first.', actions: [] , cancelLabel: 'Close' });
    return;
  }
  const current = ctx.state.branches.local.find(entry => entry.name === branch)?.upstream;
  const [currentRemote, ...rest] = current?.split('/') ?? [];
  ctx.ui.openDialog({
    title: `Set upstream for ${branch}`,
    fields: [
      { kind: 'select', id: 'remote', label: 'Remote', value: currentRemote && remotes.some(remote => remote.name === currentRemote) ? currentRemote : remotes[0].name, options: remotes.map(remote => ({ value: remote.name, label: remote.name })) },
      { kind: 'text', id: 'branch', label: 'Remote branch', value: rest.length > 0 ? rest.join('/') : branch, required: true, validate: value => branchNameError(value) },
      { kind: 'note', text: 'A remote branch that does not exist yet is created by pushing to it.' },
    ],
    actions: [{ label: 'Submit', onSelect: values => send(ctx, 'branch:setUpstream', { branch, remote: String(values.remote), remoteBranch: String(values.branch) }) }],
  });
}

/** Push the checked-out branch; without an upstream, prompt for the remote branch to create. */
export function pushFlow(ctx: Ctx, force = false): void {
  const { head, remotes } = ctx.state;
  if (!head.branch) {
    ctx.ui.openDialog({ title: 'Push', body: 'HEAD is detached. Create a branch on this commit to push it.', actions: [], cancelLabel: 'Close' });
    return;
  }
  if (head.upstream) {
    send(ctx, 'remote:push', { force });
    return;
  }
  if (remotes.length === 0) {
    ctx.ui.openDialog({ title: 'Push', body: 'This repository has no remotes. Add one from the REMOTE section first.', actions: [], cancelLabel: 'Close' });
    return;
  }
  const branch = head.branch;
  ctx.ui.openDialog({
    title: `Push ${branch}`,
    body: `${branch} has no upstream. Choose the remote branch to create; it becomes the upstream.`,
    fields: [
      { kind: 'select', id: 'remote', label: 'Remote', value: remotes.some(remote => remote.name === 'origin') ? 'origin' : remotes[0].name, options: remotes.map(remote => ({ value: remote.name, label: remote.name })) },
      { kind: 'text', id: 'branch', label: 'Remote branch name', value: branch, required: true, validate: value => branchNameError(value) },
    ],
    actions: [{ label: 'Submit', onSelect: values => send(ctx, 'branch:pushTo', { branch, remote: String(values.remote), remoteBranch: String(values.branch), setUpstream: true }) }],
  });
}

export function forcePushDialog(ctx: Ctx): void {
  ctx.ui.openDialog(confirmDialog('Force push', 'Force push is a destructive action and cannot be undone.', 'Force Push', () => send(ctx, 'remote:push', { force: true }), true));
}

export function rebaseConfirm(ctx: Ctx, source: string, onto: string, run: () => void): void {
  ctx.ui.openDialog(confirmDialog(
    `Rebase ${source} onto ${onto}`,
    `The commits of ${source} that are not on ${onto} are replayed on top of ${onto}. This rewrites ${source}'s history.`,
    'Rebase',
    run
  ));
}

function resetItems(ctx: Ctx, sha: string, branch: string | undefined): MenuItem {
  const head = ctx.state.head;
  const target = branch ?? head.branch ?? 'HEAD';
  if (branch && branch !== head.branch) {
    return item(`Reset ${branch} to this commit`, () => send(ctx, 'commit:reset', { sha, mode: 'mixed', branch }));
  }
  const reset = (mode: ResetMode) => send(ctx, 'commit:reset', { sha, mode });
  return {
    kind: 'submenu',
    label: `Reset ${target} to this commit`,
    items: [
      item('Soft: keep all changes staged', () => reset('soft')),
      item('Mixed: keep working directory, reset index', () => reset('mixed')),
      item('Hard: discard all changes', () => ctx.ui.openDialog(confirmDialog(
        'Hard reset',
        `${target} moves to ${shortSha(sha)}; the index and working directory are reset to it and uncommitted changes are discarded.`,
        'Reset Hard',
        () => reset('hard'),
        true
      )), { danger: true }),
    ],
  };
}

export function discardAllDialog(ctx: Ctx): void {
  const untracked = ctx.state.workingTreeStatus.unstaged.filter(file => file.untracked).length;
  ctx.ui.openDialog(confirmDialog(
    'Discard all changes',
    `Every staged and unstaged change is discarded${untracked > 0 ? `, and ${plural(untracked, 'untracked file')} deleted` : ''}. Undo restores them.`,
    'Discard',
    () => send(ctx, 'stage:discardAll', NONE),
    true
  ));
}

export function discardFilesDialog(ctx: Ctx, files: FileChange[]): void {
  ctx.ui.openDialog({
    ...confirmDialog(
      files.length === 1 ? `Discard changes to ${files[0].path}` : `Discard changes to ${files.length} files`,
      files.some(file => file.untracked) ? 'Unstaged changes are discarded; untracked files are deleted. Undo restores them.' : 'Unstaged changes are discarded. Undo restores them.',
      'Discard',
      () => send(ctx, 'stage:discard', { files: files.map(file => ({ path: file.path, untracked: file.untracked })) }),
      true
    ),
    fields: files.length > 1 ? [{ kind: 'list', items: files.map(file => file.path) }] : undefined,
  });
}

export function remoteDialog(ctx: Ctx, existing?: { name: string; fetchUrl: string; pushUrl: string }): void {
  const names = ctx.state.remotes.map(remote => remote.name).filter(name => name !== existing?.name);
  ctx.ui.openDialog({
    title: existing ? `Edit remote ${existing.name}` : 'Add remote',
    fields: [
      { kind: 'text', id: 'name', label: 'Remote name', value: existing?.name ?? (names.includes('origin') ? '' : 'origin'), required: true, validate: value => (names.includes(value) ? `${value} already exists.` : /\s/.test(value) ? 'Remote names cannot contain spaces.' : null) },
      { kind: 'text', id: 'fetchUrl', label: 'Fetch URL', value: existing?.fetchUrl, placeholder: 'https://example.com/repo.git', required: true, mono: true },
      { kind: 'text', id: 'pushUrl', label: 'Push URL (optional, defaults to the fetch URL)', value: existing && existing.pushUrl !== existing.fetchUrl ? existing.pushUrl : '', mono: true },
    ],
    actions: [{
      label: existing ? 'Save' : 'Add remote',
      onSelect: values => {
        const next = { name: String(values.name), fetchUrl: String(values.fetchUrl), pushUrl: String(values.pushUrl) };
        if (existing) send(ctx, 'remote:edit', { name: existing.name, next });
        else send(ctx, 'remote:add', next);
      },
    }],
  });
}

export function stashMessageDialog(ctx: Ctx, stash: StashRef): void {
  ctx.ui.openDialog(promptDialog('Edit stash message', 'Message', 'Save', message => send(ctx, 'stash:rename', { ref: stash.ref, sha: stash.sha, message }), { value: stash.message }));
}

export function interactiveRebaseOnto(ctx: Ctx, upstream: string, label: string, branch?: string): void {
  send(ctx, 'view:interactiveRebase', { upstream, branch, label });
}

// ------------------------------------------------------------------ visibility

export function visibilityItems(ctx: Ctx, ids: string[], label = ''): MenuItem[] {
  const { hidden, solo } = ctx.state.repoPrefs;
  const isHidden = ids.every(id => hidden.includes(id));
  const isSolo = ids.every(id => solo.includes(id));
  return [
    item(isHidden ? `Show${label}` : `Hide${label}`, () => send(ctx, 'refs:hide', { ids, hidden: !isHidden })),
    item(isSolo ? `Unsolo${label}` : `Solo${label}`, () => send(ctx, 'refs:solo', { ids, solo: !isSolo })),
  ];
}

export function stashIds(state: ClientState): string[] {
  return state.stashes.map(stash => `stash:${stash.sha}`);
}

// ------------------------------------------------------------------ menus

export function commitMenu(ctx: Ctx, commit: LaneCommit): MenuItem[] {
  const { state } = ctx;
  const head = state.head;
  const selected = selectedCommits(state);
  if (selected.length > 1 && selected.some(entry => entry.sha === commit.sha)) return multiCommitMenu(ctx, selected);

  const isHead = commit.sha === head.sha;
  const headAncestors = ancestorsOf(state.commitLog, head.sha);
  const onCurrent = headAncestors.has(commit.sha);
  const branchLabel = head.branch ?? 'HEAD';
  const attached = commit.refs.some(ref => !ref.startsWith('tag: ') && ref !== 'HEAD');
  const copy = (text: string) => send(ctx, 'clipboard:write', { text });

  return [
    item('Create branch here', () => createBranchAt(ctx, commit.sha)),
    ...(isHead ? [] : [item('Checkout this commit', () => send(ctx, 'commit:checkout', { sha: commit.sha }))]),
    item('Create tag here', () => createTagAt(ctx, commit.sha)),
    item('Create annotated tag here', () => annotatedTagDialog(ctx, commit.sha)),
    sep,
    ...(onCurrent ? [] : [item('Cherry pick commit', () => send(ctx, 'commit:cherryPick', { sha: commit.sha }))]),
    ...(head.sha ? [resetItems(ctx, commit.sha, undefined)] : []),
    item('Revert commit', () => ctx.ui.openDialog(confirmDialog('Revert commit', `A new commit on ${branchLabel} reverses the changes of ${shortSha(commit.sha)}. History is kept.`, 'Revert', () => send(ctx, 'commit:revert', { sha: commit.sha })))),
    ...(!attached && !isHead && head.branch && !onCurrent
      ? [item('Rebase onto this commit', () => rebaseConfirm(ctx, branchLabel, shortSha(commit.sha), () => send(ctx, 'branch:rebase', { onto: commit.sha })))]
      : []),
    ...(onCurrent && !isHead ? [item(`Interactive Rebase ${branchLabel} to here`, () => interactiveRebaseOnto(ctx, commit.sha, shortSha(commit.sha)))] : []),
    ...(onCurrent && commit.parents.length === 1 ? [item('Drop commit', () => ctx.ui.openDialog(confirmDialog('Drop commit', `${shortSha(commit.sha)} is removed from ${branchLabel}; later commits are replayed. Undo restores it.`, 'Drop', () => send(ctx, 'commit:drop', { sha: commit.sha }), true)))] : []),
    ...(isHead ? [item('Edit commit message', () => {
      send(ctx, 'graph:select', { shas: [commit.sha] });
      window.setTimeout(() => window.dispatchEvent(new CustomEvent('mygit:editMessage')), 50);
    })] : []),
    sep,
    item('Compare commit against working directory', () => send(ctx, 'graph:select', { shas: ['working-tree', commit.sha] })),
    item('Create patch from commit', () => send(ctx, 'patch:commits', { shas: [commit.sha] })),
    sep,
    item('Copy commit SHA', () => copy(commit.sha)),
    item('Copy commit message', () => copy(commit.body ? `${commit.message}\n\n${commit.body}` : commit.message)),
  ];
}

function multiCommitMenu(ctx: Ctx, commits: LaneCommit[]): MenuItem[] {
  const { state } = ctx;
  const headAncestors = ancestorsOf(state.commitLog, state.head.sha);
  const squashable = isSquashable(commits) && commits.every(commit => headAncestors.has(commit.sha));
  const consecutive = commits.every((commit, index) => index === commits.length - 1 || commit.parents[0] === commits[index + 1].sha);
  const pickable = commits.filter(commit => !headAncestors.has(commit.sha) && commit.parents.length === 1);
  const count = commits.length;
  return [
    ...(pickable.length === count ? [item(`Cherry pick ${count} commits`, () => send(ctx, 'view:cherryPickMany', { shas: commits.map(commit => commit.sha) }))] : []),
    ...(squashable ? [item(`Squash ${count} commits`, () => ctx.ui.openDialog(confirmDialog(
      `Squash ${count} commits`,
      `The ${count} commits become one commit carrying all their messages. ${state.head.pushed ? 'They are already pushed: the branch will need a force push.' : ''}`,
      'Squash',
      () => send(ctx, 'commit:squash', { shas: commits.map(commit => commit.sha) })
    )))] : []),
    ...(consecutive ? [item(`Create patch from ${count} commits`, () => send(ctx, 'patch:commits', { shas: commits.map(commit => commit.sha) }))] : []),
    sep,
    item('Copy commit SHAs', () => send(ctx, 'clipboard:write', { text: commits.map(commit => commit.sha).join('\n') })),
  ];
}

/**
 * "Rebase [N] commits onto [branch]": the selected range (or a single commit mid-branch and
 * every later commit up to HEAD) is replayed onto the branch.
 */
function rebaseSelectionItem(ctx: Ctx, onto: string, ontoSha: string | undefined): MenuItem[] {
  const { state } = ctx;
  const selected = selectedCommits(state);
  if (selected.length === 0 || !state.head.sha || !state.head.branch) return [];
  const oldest = selected[selected.length - 1];
  if (oldest.sha === ontoSha || oldest.parents.length !== 1) return [];
  const bySha = new Map(state.commitLog.map(commit => [commit.sha, commit]));
  let count = 0;
  let current = bySha.get(state.head.sha);
  while (current && current.sha !== oldest.sha) {
    if (current.parents.length !== 1) return [];
    count += 1;
    current = bySha.get(current.parents[0]);
  }
  if (!current) return [];
  count += 1;
  return [item(`Rebase ${plural(count, 'commit')} onto ${onto}`, () => rebaseConfirm(ctx, `${plural(count, 'commit')} of ${state.head.branch}`, onto, () => send(ctx, 'branch:rebaseRange', { onto, from: oldest.sha })))];
}

export function localBranchMenu(ctx: Ctx, name: string, multi: string[] = []): MenuItem[] {
  const { state } = ctx;
  const branches = state.branches.local;
  if (multi.length > 1 && multi.includes(name)) {
    const deletable = multi.filter(entry => !branches.find(branch => branch.name === entry)?.isHead);
    return [
      item(`Delete ${deletable.length} branches`, () => deleteBranchesDialog(ctx, deletable), { danger: true, disabled: deletable.length === 0 }),
      sep,
      ...visibilityItems(ctx, multi.map(entry => `refs/heads/${entry}`), ` ${multi.length} branches`),
    ];
  }

  const branch = branches.find(entry => entry.name === name);
  if (!branch) return [];
  const head = state.head;
  const current = head.branch ?? 'HEAD';
  const isHead = branch.isHead;
  const id = `refs/heads/${name}`;
  const pinned = state.repoPrefs.pinned.includes(name);
  const upstreamParts = branch.upstream?.split('/') ?? [];

  return [
    ...(isHead ? [] : [item(`Checkout ${name}`, () => checkoutLocal(ctx, name))]),
    ...(isHead && branch.upstream ? [item('Pull (fast-forward if possible)', () => send(ctx, 'remote:pull', { mode: 'ff' }))] : []),
    ...(isHead ? [item('Push', () => pushFlow(ctx))] : branch.upstream && !branch.upstreamGone
      ? [item('Push', () => send(ctx, 'branch:pushTo', { branch: name, remote: upstreamParts[0], remoteBranch: upstreamParts.slice(1).join('/'), setUpstream: false }))]
      : []),
    ...(branch.upstream && branch.behind > 0 && branch.ahead === 0
      ? [item(`Fast-forward ${name} to ${branch.upstream}`, () => send(ctx, 'branch:fastForward', { branch: name, target: branch.upstream! }))]
      : []),
    item('Set Upstream', () => setUpstreamDialog(ctx, name)),
    sep,
    ...(isHead ? [] : [
      item(`Merge ${name} into ${current}`, () => send(ctx, 'branch:merge', { ref: name })),
      item(`Rebase ${current} onto ${name}`, () => rebaseConfirm(ctx, current, name, () => send(ctx, 'branch:rebase', { onto: name }))),
      item(`Interactive Rebase ${current} onto ${name}`, () => interactiveRebaseOnto(ctx, name, name)),
      ...rebaseSelectionItem(ctx, name, branch.sha),
      item('Cherry pick commit', () => send(ctx, 'commit:cherryPick', { sha: branch.sha })),
      sep,
    ]),
    item('Create branch here', () => createBranchAt(ctx, branch.sha)),
    ...(isHead ? [] : [resetItems(ctx, branch.sha, undefined)]),
    sep,
    item(`Rename ${name}`, () => ctx.ui.startRename(name)),
    ...(isHead ? [] : [item(`Delete ${name}`, () => deleteBranchesDialog(ctx, [name]), { danger: true })]),
    sep,
    item(pinned ? 'Unpin from left' : 'Pin to left', () => send(ctx, 'branch:pin', { name, pinned: !pinned })),
    ...visibilityItems(ctx, [id]),
    sep,
    item('Compare commit against working directory', () => send(ctx, 'graph:select', { shas: ['working-tree', branch.sha] })),
    item('Copy branch name', () => send(ctx, 'clipboard:write', { text: name })),
  ];
}

export function remoteBranchMenu(ctx: Ctx, remote: string, branch: string): MenuItem[] {
  const { state } = ctx;
  const current = state.head.branch ?? 'HEAD';
  const qualified = `${remote}/${branch}`;
  const sha = state.branches.remote.find(group => group.remoteName === remote)?.branches.find(entry => entry.name === branch)?.sha;
  return [
    item('Checkout', () => checkoutRemote(ctx, remote, branch)),
    item(`Merge ${qualified} into ${current}`, () => send(ctx, 'branch:merge', { ref: qualified })),
    item(`Rebase ${current} onto ${qualified}`, () => rebaseConfirm(ctx, current, qualified, () => send(ctx, 'branch:rebase', { onto: qualified }))),
    item(`Interactive Rebase ${current} onto ${qualified}`, () => interactiveRebaseOnto(ctx, qualified, qualified)),
    ...rebaseSelectionItem(ctx, qualified, sha),
    sep,
    ...(sha ? [item('Create branch here', () => createBranchAt(ctx, sha))] : []),
    ...(state.head.branch && !state.head.upstream
      ? [item(`Set as upstream of ${state.head.branch}`, () => send(ctx, 'branch:setUpstream', { branch: state.head.branch!, remote, remoteBranch: branch }))]
      : []),
    item(`Delete ${qualified}`, () => ctx.ui.openDialog(confirmDialog(`Delete ${qualified}`, `The branch is deleted on ${remote} for everyone. This cannot be undone.`, 'Delete', () => send(ctx, 'branch:deleteRemote', { remote, branch }), true)), { danger: true }),
    sep,
    ...visibilityItems(ctx, [`refs/remotes/${qualified}`]),
    item('Copy branch name', () => send(ctx, 'clipboard:write', { text: qualified })),
  ];
}

export function remoteMenu(ctx: Ctx, name: string): MenuItem[] {
  const remote = ctx.state.remotes.find(entry => entry.name === name);
  return [
    item(`Fetch ${name}`, () => send(ctx, 'remote:fetch', { remote: name })),
    ...(remote ? [item('Edit remote', () => remoteDialog(ctx, remote))] : []),
    item(`Remove ${name}`, () => ctx.ui.openDialog(confirmDialog(`Remove ${name}`, `The remote and its remote-tracking branches are removed from this repository. Undo restores them.`, 'Remove', () => send(ctx, 'remote:remove', { name }), true)), { danger: true }),
    sep,
    ...visibilityItems(ctx, [`remote:${name}`]),
    ...(remote ? [item('Copy remote URL', () => send(ctx, 'clipboard:write', { text: remote.fetchUrl }))] : []),
  ];
}

export function tagMenu(ctx: Ctx, tag: TagRef): MenuItem[] {
  const { state } = ctx;
  const current = state.head.branch ?? 'HEAD';
  const remotes = state.remotes.map(remote => remote.name);
  const headAncestors = ancestorsOf(state.commitLog, state.head.sha);
  const fastForwardable = state.head.sha !== null && tag.sha !== state.head.sha && headAncestors.has(tag.sha);
  const perRemote = (label: (remote: string) => string, run: (remote: string) => void, danger = false): MenuItem[] => {
    if (remotes.length === 0) return [];
    if (remotes.length === 1) return [item(label(remotes[0]), () => run(remotes[0]), { danger })];
    return [{ kind: 'submenu', label: label('…'), items: remotes.map(remote => item(remote, () => run(remote), { danger })) }];
  };
  return [
    ...perRemote(remote => `Push ${tag.name} to ${remote}`, remote => send(ctx, 'tag:push', { name: tag.name, remote })),
    sep,
    item(`Merge ${tag.name} into ${current}`, () => send(ctx, 'branch:merge', { ref: `refs/tags/${tag.name}` })),
    item(`Rebase ${current} onto ${tag.name}`, () => rebaseConfirm(ctx, current, tag.name, () => send(ctx, 'branch:rebase', { onto: `refs/tags/${tag.name}` }))),
    item('Create branch here', () => createBranchAt(ctx, tag.sha)),
    item('Checkout this commit', () => send(ctx, 'commit:checkout', { sha: tag.sha })),
    ...(tag.annotated ? [] : [item('Annotate tag', () => ctx.ui.openDialog({
      title: `Annotate ${tag.name}`,
      fields: [{ kind: 'textarea', id: 'message', label: 'Message', required: true }],
      actions: [{ label: 'Annotate', onSelect: values => send(ctx, 'tag:annotate', { name: tag.name, message: String(values.message) }) }],
    }))]),
    ...(fastForwardable ? [item(`Fast-forward ${tag.name} to ${current}`, () => send(ctx, 'tag:fastForward', { name: tag.name }))] : []),
    sep,
    item(`Delete ${tag.name} locally`, () => ctx.ui.openDialog(confirmDialog(`Delete ${tag.name}`, 'The tag is deleted from this repository. This is permanent.', 'Delete', () => send(ctx, 'tag:delete', { name: tag.name }), true)), { danger: true }),
    ...perRemote(remote => `Delete ${tag.name} from ${remote}`, remote => ctx.ui.openDialog(confirmDialog(`Delete ${tag.name} from ${remote}`, `The tag is deleted on ${remote} for everyone. This is permanent.`, 'Delete', () => send(ctx, 'tag:deleteRemote', { name: tag.name, remote }), true)), true),
    sep,
    ...visibilityItems(ctx, [`refs/tags/${tag.name}`]),
    item('Copy tag name', () => send(ctx, 'clipboard:write', { text: tag.name })),
  ];
}

export function stashMenu(ctx: Ctx, stash: StashRef, fromLeftPanel: boolean): MenuItem[] {
  const ids = stashIds(ctx.state);
  return [
    item('Apply Stash', () => send(ctx, 'stash:apply', { ref: stash.ref })),
    item('Pop Stash', () => send(ctx, 'stash:pop', { ref: stash.ref })),
    item('Delete Stash', () => ctx.ui.openDialog(confirmDialog('Delete stash', `"${stash.message}" is deleted. This cannot be undone.`, 'Delete', () => send(ctx, 'stash:drop', { ref: stash.ref }), true)), { danger: true }),
    ...(fromLeftPanel ? [item('Edit stash message', () => stashMessageDialog(ctx, stash))] : []),
    sep,
    ...visibilityItems(ctx, [`stash:${stash.sha}`]),
    item('Hide all stashes', () => send(ctx, 'refs:hide', { ids, hidden: true })),
    item('Show all stashes', () => send(ctx, 'refs:hide', { ids, hidden: false })),
  ];
}

export function wipMenu(ctx: Ctx): MenuItem[] {
  return [
    item('Stash changes', () => send(ctx, 'stash:save', {})),
    item('Discard all changes', () => discardAllDialog(ctx), { danger: true }),
    sep,
    ...(ctx.state.head.sha ? [item('Create branch here', () => createBranchAt(ctx, ctx.state.head.sha!))] : []),
  ];
}

// ------------------------------------------------------------------ drag and drop

export type DropTarget =
  | { kind: 'local'; name: string }
  | { kind: 'remote'; remote: string; branch: string }
  | { kind: 'commit'; sha: string };

export function dropMenu(ctx: Ctx, source: DragRef, target: DropTarget): MenuItem[] {
  const { state } = ctx;
  const sourceLabel = dragRefLabel(source);
  const sourceRef = source.kind === 'tag' ? `refs/tags/${source.name}` : sourceLabel;
  const sourceSha = source.kind === 'local'
    ? state.branches.local.find(branch => branch.name === source.name)?.sha
    : source.kind === 'remote'
      ? state.branches.remote.find(group => group.remoteName === source.remote)?.branches.find(branch => branch.name === source.branch)?.sha
      : state.tags.find(tag => tag.name === source.name)?.sha;

  if (target.kind === 'commit') {
    if (source.kind !== 'local') return [];
    return [resetItems(ctx, target.sha, source.name)];
  }

  if (target.kind === 'local') {
    if (source.kind === 'local' && source.name === target.name) return [];
    const targetSha = state.branches.local.find(branch => branch.name === target.name)?.sha;
    const fastForward = sourceSha && targetSha && targetSha !== sourceSha && ancestorsOf(state.commitLog, sourceSha).has(targetSha);
    const items: MenuItem[] = [
      item(`Merge ${sourceLabel} into ${target.name}`, () => send(ctx, 'branch:merge', { ref: sourceRef, into: target.name })),
    ];
    if (source.kind === 'local') {
      items.push(
        item(`Rebase ${source.name} onto ${target.name}`, () => rebaseConfirm(ctx, source.name, target.name, () => send(ctx, 'branch:rebase', { onto: target.name, branch: source.name }))),
        item(`Interactive Rebase ${source.name} onto ${target.name}`, () => interactiveRebaseOnto(ctx, target.name, target.name, source.name)),
      );
    } else {
      items.push(
        item(`Rebase ${target.name} onto ${sourceLabel}`, () => rebaseConfirm(ctx, target.name, sourceLabel, () => send(ctx, 'branch:rebase', { onto: sourceRef, branch: target.name }))),
        ...(source.kind === 'remote' ? [item(`Interactive Rebase ${target.name} onto ${sourceLabel}`, () => interactiveRebaseOnto(ctx, sourceRef, sourceLabel, target.name))] : []),
      );
    }
    if (fastForward) items.push(item(`Fast-forward ${target.name} to ${sourceLabel}`, () => send(ctx, 'branch:fastForward', { branch: target.name, target: sourceRef })));
    return items;
  }

  // Remote branch target.
  const qualified = `${target.remote}/${target.branch}`;
  if (source.kind !== 'local') return [];
  return [
    item(`Push ${source.name} to ${qualified}`, () => send(ctx, 'branch:pushTo', { branch: source.name, remote: target.remote, remoteBranch: target.branch, setUpstream: false })),
    item(`Push ${source.name} to ${qualified} and set upstream`, () => send(ctx, 'branch:pushTo', { branch: source.name, remote: target.remote, remoteBranch: target.branch, setUpstream: true })),
    sep,
    item(`Merge ${qualified} into ${source.name}`, () => send(ctx, 'branch:merge', { ref: qualified, into: source.name })),
    item(`Rebase ${source.name} onto ${qualified}`, () => rebaseConfirm(ctx, source.name, qualified, () => send(ctx, 'branch:rebase', { onto: qualified, branch: source.name }))),
    item(`Interactive Rebase ${source.name} onto ${qualified}`, () => interactiveRebaseOnto(ctx, qualified, qualified, source.name)),
  ];
}

// ------------------------------------------------------------------ files

export type FileRef = FileChange & { source: DiffSource };

function ignoreItems(ctx: Ctx, file: FileChange): MenuItem {
  const name = file.path.split('/').pop() ?? file.path;
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : null;
  const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/') + 1) : null;
  const run = (mode: Ops['file:ignore']['mode']) => {
    if (file.untracked) {
      send(ctx, 'file:ignore', { path: file.path, mode, stopTracking: false });
      return;
    }
    ctx.ui.openDialog({
      title: `${file.path} is tracked`,
      body: 'An ignore rule does not affect files Git already tracks. "Ignore and Stop Tracking" also removes the file from the index; it stays on disk.',
      actions: [
        { label: 'Ignore', tone: 'default', onSelect: () => send(ctx, 'file:ignore', { path: file.path, mode, stopTracking: false }) },
        { label: 'Ignore and Stop Tracking', onSelect: () => send(ctx, 'file:ignore', { path: file.path, mode, stopTracking: true }) },
      ],
    });
  };
  return {
    kind: 'submenu',
    label: 'Ignore',
    items: [
      item(`Ignore ${name}`, () => run('file')),
      ...(ext ? [item(`Ignore all files with extension ${ext}`, () => run('extension'))] : []),
      ...(dir ? [item(`Ignore all files in ${dir}`, () => run('directory'))] : []),
    ],
  };
}

function commonFileItems(ctx: Ctx, path: string, rev: string): MenuItem[] {
  return [
    item('File History', () => send(ctx, 'view:history', { path })),
    item('File Blame', () => send(ctx, 'view:blame', { path, rev })),
    sep,
    item('Edit file', () => send(ctx, 'file:open', { path })),
    item('Show in folder', () => send(ctx, 'file:reveal', { path })),
    item('Copy file path', () => send(ctx, 'clipboard:write', { text: path })),
  ];
}

export function wipFileMenu(ctx: Ctx, files: FileRef[], conflictLabels?: { current: string; incoming: string }): MenuItem[] {
  if (files.length === 0) return [];
  const paths = files.map(file => file.path);
  const first = files[0];
  const many = files.length > 1;
  const source = first.source;

  if (first.status === 'U' && first.conflict) {
    return [
      item('Open merge tool', () => send(ctx, 'view:merge', { path: first.path }), { disabled: many }),
      item('Open in external merge tool', () => send(ctx, 'merge:external', { path: first.path }), { disabled: many }),
      sep,
      item(`Take current (${conflictLabels?.current ?? 'ours'})`, () => send(ctx, 'file:takeSide', { paths, side: 'ours' })),
      item(`Take incoming (${conflictLabels?.incoming ?? 'theirs'})`, () => send(ctx, 'file:takeSide', { paths, side: 'theirs' })),
      item('Mark resolved (stage)', () => send(ctx, 'stage:paths', { paths })),
      sep,
      ...commonFileItems(ctx, first.path, 'working-tree'),
    ];
  }

  return [
    source === 'unstaged'
      ? item(many ? `Stage ${files.length} files` : 'Stage', () => send(ctx, 'stage:paths', { paths }))
      : item(many ? `Unstage ${files.length} files` : 'Unstage', () => send(ctx, 'stage:unstagePaths', { paths })),
    ...(source === 'unstaged' ? [item(many ? 'Discard selected' : 'Discard changes', () => discardFilesDialog(ctx, files), { danger: true })] : []),
    item(many ? `Stash ${files.length} files` : 'Stash file', () => send(ctx, 'stash:save', { paths })),
    ...(source === 'unstaged' && !many ? [ignoreItems(ctx, first)] : []),
    sep,
    item('Create patch from file changes', () => send(ctx, 'patch:files', { from: null, to: source === 'staged' ? 'index' : 'working-tree', paths })),
    item('Open diff in external tool', () => send(ctx, 'file:externalDiff', { file: { path: first.path, source, sha: 'working-tree', untracked: first.untracked, status: first.status } }), { disabled: many }),
    ...(first.status !== 'D' ? [item('Delete file', () => ctx.ui.openDialog(confirmDialog(
      many ? `Delete ${files.length} files` : `Delete ${first.path}`,
      'The files are deleted from the working directory. The deletion shows up as an unstaged change.',
      'Delete',
      () => send(ctx, 'file:delete', { paths }),
      true
    )), { danger: true })] : []),
    sep,
    ...commonFileItems(ctx, first.path, 'working-tree'),
  ];
}

export function commitFileMenu(ctx: Ctx, sha: string, files: FileChange[], parent: string | null): MenuItem[] {
  if (files.length === 0) return [];
  const paths = files.map(file => file.path);
  const first = files[0];
  const many = files.length > 1;
  return [
    item(many ? 'Restore selected files from this commit' : 'Restore file from this commit', () => send(ctx, 'file:restore', { sha, paths })),
    item('Create patch from file changes', () => send(ctx, 'patch:files', { from: parent, to: sha, paths })),
    item('Open file at this revision', () => send(ctx, 'file:open', { path: first.path, rev: first.status === 'D' ? `${sha}^` : sha }), { disabled: many }),
    item('Open diff in external tool', () => send(ctx, 'file:externalDiff', { file: { path: first.path, source: 'commit', sha, status: first.status } }), { disabled: many }),
    sep,
    item('File History', () => send(ctx, 'view:history', { path: first.path })),
    item('File Blame', () => send(ctx, 'view:blame', { path: first.path, rev: sha })),
    sep,
    item('Edit file', () => send(ctx, 'file:open', { path: first.path })),
    item('Copy file path', () => send(ctx, 'clipboard:write', { text: first.path })),
  ];
}

export function revisionFileMenu(ctx: Ctx, file: FileChange, rev: string, from: string | null, to: string): MenuItem[] {
  return [
    item('Open file at this revision', () => send(ctx, 'file:open', { path: file.path, rev })),
    item('Create patch from file changes', () => send(ctx, 'patch:files', { from, to, paths: [file.path] })),
    sep,
    item('File History', () => send(ctx, 'view:history', { path: file.path })),
    item('Edit file', () => send(ctx, 'file:open', { path: file.path })),
    item('Copy file path', () => send(ctx, 'clipboard:write', { text: file.path })),
  ];
}

export function createFileDialog(ctx: Ctx): void {
  ctx.ui.openDialog(promptDialog('Create file', 'File path (a / creates folders)', 'Create', path => send(ctx, 'file:create', { path }), {
    placeholder: 'src/utils.js',
    validate: value => (ctx.state.workingTreeStatus.unstaged.some(file => file.path === value) ? `${value} already exists.` : null),
  }));
}

export function templateDialog(ctx: Ctx): void {
  const template = ctx.state.template;
  ctx.ui.openDialog({
    title: 'Commit template',
    body: 'Saved to the repository (commit.template). The global Git configuration is never changed.',
    wide: true,
    fields: [
      { kind: 'text', id: 'summary', label: 'Summary', value: template?.summary ?? '' },
      { kind: 'textarea', id: 'description', label: 'Description', value: template?.description ?? '', rows: 8, mono: true },
    ],
    actions: [{ label: 'Save template', onSelect: values => send(ctx, 'template:save', { summary: String(values.summary), description: String(values.description) }) }],
  });
}

export function sparseDialog(ctx: Ctx): void {
  const sparse = ctx.state.repo?.sparse;
  const run = (action: 'enable' | 'disable' | 'reapply') => (values: Record<string, string | boolean>) =>
    send(ctx, 'sparse:set', { action, rules: String(values.rules ?? '').split('\n').map(line => line.trim()).filter(Boolean) });
  const request: DialogRequest = {
    title: 'Sparse checkout',
    body: 'Directories to check out, one per line. Files in the repository root are always checked out (cone mode).',
    wide: true,
    fields: [
      { kind: 'textarea', id: 'rules', label: 'Paths', value: (sparse?.rules ?? []).join('\n'), rows: 8, mono: true, placeholder: 'src/\ndocs/' },
      { kind: 'note', text: sparse?.enabled ? 'Sparse checkout is enabled.' : 'Sparse checkout is disabled.' },
    ],
    actions: [
      ...(sparse?.enabled ? [
        { label: 'Disable', tone: 'default' as const, validated: false, onSelect: run('disable') },
        { label: 'Reapply', tone: 'default' as const, validated: false, onSelect: run('reapply') },
      ] : []),
      { label: sparse?.enabled ? 'Apply paths' : 'Enable', onSelect: run('enable') },
    ],
  };
  ctx.ui.openDialog(request);
}

export function requestExternalDiff(): void {
  emit({ kind: 'externalDiff' });
}
