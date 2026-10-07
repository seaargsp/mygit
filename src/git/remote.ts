import { runGit, GitError, NON_INTERACTIVE_ENV } from './gitService';

export async function checkoutBranch(repoPath: string, ref: string): Promise<void> {
  await runGit(repoPath, ['checkout', ref]);
}

/** Checks out a commit without a branch. */
export async function checkoutDetached(repoPath: string, rev: string): Promise<void> {
  await runGit(repoPath, ['checkout', '--detach', rev]);
}

/**
 * Remote branch checkout: the local branch of the same name if it exists, otherwise a new
 * local branch tracking the remote one.
 */
export async function checkoutRemoteBranch(repoPath: string, remote: string, branch: string, localExists: boolean): Promise<void> {
  if (localExists) await runGit(repoPath, ['checkout', branch]);
  else await runGit(repoPath, ['checkout', '-b', branch, '--track', `${remote}/${branch}`]);
}

export async function createBranch(repoPath: string, name: string, from: string, checkout: boolean): Promise<void> {
  if (checkout) await runGit(repoPath, ['checkout', '-b', name, from]);
  else await runGit(repoPath, ['branch', name, from]);
}

export async function renameBranch(repoPath: string, from: string, to: string): Promise<void> {
  await runGit(repoPath, ['branch', '-m', from, to]);
}

export async function isValidBranchName(repoPath: string, name: string): Promise<boolean> {
  try {
    await runGit(repoPath, ['check-ref-format', '--branch', name]);
    return true;
  } catch {
    return false;
  }
}

export class UnmergedBranchError extends Error {
  constructor(public readonly branch: string) {
    super(`${branch} is not fully merged.`);
  }
}

/** Safe delete; an unmerged branch raises UnmergedBranchError unless `force`. */
export async function deleteLocalBranch(repoPath: string, name: string, force: boolean): Promise<void> {
  try {
    await runGit(repoPath, ['branch', force ? '-D' : '-d', name]);
  } catch (error) {
    if (!force && error instanceof GitError && /not fully merged/.test(error.stderr)) throw new UnmergedBranchError(name);
    throw error;
  }
}

export async function deleteRemoteBranch(repoPath: string, remote: string, branch: string): Promise<void> {
  await runGit(repoPath, ['push', remote, '--delete', branch]);
}

export async function setUpstream(repoPath: string, branch: string, upstream: string): Promise<void> {
  await runGit(repoPath, ['branch', `--set-upstream-to=${upstream}`, branch]);
}

/**
 * Moves a branch forward to `target` when that is a fast-forward. The checked-out branch
 * merges with --ff-only; any other branch is updated through a local fetch, which refuses
 * non-fast-forward updates by itself.
 */
export async function fastForwardBranch(repoPath: string, branch: string, target: string, isHead: boolean): Promise<void> {
  if (isHead) await runGit(repoPath, ['merge', '--ff-only', target]);
  else await runGit(repoPath, ['fetch', '.', `${target}:refs/heads/${branch}`]);
}

/**
 * Pulls a branch that is not checked out: fetches its upstream straight into the local ref,
 * which git applies only as a fast-forward. The remote-tracking ref is updated as well.
 */
export async function pullBranch(repoPath: string, branch: string): Promise<void> {
  const config = async (key: string) => (await runGit(repoPath, ['config', '--get', key]).catch(() => '')).trim();
  const remote = await config(`branch.${branch}.remote`);
  const merge = await config(`branch.${branch}.merge`);
  if (!remote || !merge) throw new Error(`${branch} has no upstream to pull from. Set one with "Set Upstream".`);
  try {
    await runGit(repoPath, ['fetch', remote, `${merge}:refs/heads/${branch}`]);
  } catch (error) {
    if (error instanceof GitError && /non-fast-forward|rejected/.test(error.stderr)) {
      throw new Error(`${branch} has diverged from its upstream, so it cannot be fast-forwarded. Check it out and pull to merge or rebase.`);
    }
    throw error;
  }
}

/** Points a branch that is not checked out at another commit. */
export async function moveBranch(repoPath: string, branch: string, sha: string): Promise<void> {
  await runGit(repoPath, ['branch', '-f', branch, sha]);
}

/** Upper bound for an automatic fetch: a stalled network or remote must not hold the fetch slot. */
const BACKGROUND_FETCH_TIMEOUT_MS = 60_000;

export async function fetch(
  repoPath: string,
  opts: { remote?: string; prune: boolean; writeCommitGraph?: boolean; background?: boolean }
): Promise<void> {
  // fetch.writeCommitGraph extends the commit-graph with the fetched commits.
  const args = opts.writeCommitGraph ? ['-c', 'fetch.writeCommitGraph=true', 'fetch'] : ['fetch'];
  args.push(opts.remote ?? '--all');
  if (opts.prune) args.push('--prune');
  // A background fetch has no user to answer a credential prompt: it fails instead of waiting.
  await runGit(repoPath, args, opts.background ? { env: NON_INTERACTIVE_ENV, timeoutMs: BACKGROUND_FETCH_TIMEOUT_MS } : {});
}

export type PullMode = 'fetch' | 'ff' | 'ff-only' | 'rebase';

export async function pull(repoPath: string, mode: PullMode, prune: boolean): Promise<void> {
  if (mode === 'fetch') {
    await fetch(repoPath, { prune });
    return;
  }
  const args = ['pull'];
  if (mode === 'ff') args.push('--ff', '--no-rebase');
  if (mode === 'ff-only') args.push('--ff-only');
  if (mode === 'rebase') args.push('--rebase', '--autostash');
  if (prune) args.push('--prune');
  await runGit(repoPath, args, { env: { GIT_EDITOR: 'true' } });
}

export class PushRejectedError extends Error {
  constructor(public readonly detail: string) {
    super(detail);
  }
}

/** Pushes `branch` to `remote/remoteBranch`; `force` uses --force-with-lease. */
export async function push(
  repoPath: string,
  opts: { remote?: string; branch?: string; remoteBranch?: string; setUpstream?: boolean; force?: boolean }
): Promise<void> {
  const args = ['push'];
  if (opts.setUpstream) args.push('--set-upstream');
  if (opts.force) args.push('--force-with-lease');
  if (opts.remote) {
    args.push(opts.remote);
    if (opts.branch) args.push(`refs/heads/${opts.branch}:refs/heads/${opts.remoteBranch ?? opts.branch}`);
  }
  try {
    await runGit(repoPath, args);
  } catch (error) {
    if (error instanceof GitError && /\[rejected\]|non-fast-forward|fetch first|stale info/.test(error.stderr)) {
      throw new PushRejectedError(error.stderr);
    }
    throw error;
  }
}

export async function addRemote(repoPath: string, name: string, fetchUrl: string, pushUrl?: string): Promise<void> {
  await runGit(repoPath, ['remote', 'add', name, fetchUrl]);
  if (pushUrl && pushUrl !== fetchUrl) await runGit(repoPath, ['remote', 'set-url', '--push', name, pushUrl]);
}

export async function editRemote(repoPath: string, name: string, next: { name: string; fetchUrl: string; pushUrl: string }): Promise<void> {
  if (next.name !== name) await runGit(repoPath, ['remote', 'rename', name, next.name]);
  await runGit(repoPath, ['remote', 'set-url', next.name, next.fetchUrl]);
  if (next.pushUrl && next.pushUrl !== next.fetchUrl) await runGit(repoPath, ['remote', 'set-url', '--push', next.name, next.pushUrl]);
  else await runGit(repoPath, ['config', '--unset-all', `remote.${next.name}.pushurl`]).catch(() => undefined);
}

export type RemoteSnapshot = {
  name: string;
  config: [string, string][];
  refs: [string, string][];
};

/** Configuration and remote-tracking refs of a remote, enough to recreate it after removal. */
export async function snapshotRemote(repoPath: string, name: string): Promise<RemoteSnapshot> {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const config = (await runGit(repoPath, ['config', '--local', '--get-regexp', `^remote\\.${escaped}\\.`]).catch(() => ''))
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const space = line.indexOf(' ');
      return [line.slice(0, space), line.slice(space + 1)] as [string, string];
    });
  const refs = (await runGit(repoPath, ['for-each-ref', '--format=%(refname) %(objectname)', `refs/remotes/${name}/`]))
    .split('\n')
    .filter(Boolean)
    .map(line => line.split(' ') as [string, string]);
  return { name, config, refs };
}

export async function removeRemote(repoPath: string, name: string): Promise<void> {
  await runGit(repoPath, ['remote', 'remove', name]);
}

export async function restoreRemote(repoPath: string, snapshot: RemoteSnapshot): Promise<void> {
  for (const [key, value] of snapshot.config) await runGit(repoPath, ['config', '--local', '--add', key, value]);
  for (const [ref, sha] of snapshot.refs) await runGit(repoPath, ['update-ref', ref, sha]);
}
