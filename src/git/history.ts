import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { runGit, shellQuote, END_OF_OPTIONS as END } from './gitService';
import { assertRev } from './argGuard';
import type { OperationKind } from './repoState';

export type ResetMode = 'soft' | 'mixed' | 'hard';

/** Continue commands must not open an editor: the prepared message is used as-is. */
const NO_EDITOR = { GIT_EDITOR: 'true' };

export async function revertCommit(repoPath: string, sha: string, mainline?: number): Promise<void> {
  const args = ['revert', '--no-edit'];
  if (mainline) args.push('-m', String(mainline));
  args.push(END, assertRev('commit', sha));
  await runGit(repoPath, args);
}

export async function resetTo(repoPath: string, sha: string, mode: ResetMode | 'keep'): Promise<void> {
  await runGit(repoPath, ['reset', `--${mode}`, assertRev('commit', sha)]);
}

export async function mergeRef(repoPath: string, ref: string, opts: { squash: boolean }): Promise<void> {
  const args = ['merge'];
  if (opts.squash) args.push('--squash');
  else args.push('--no-edit');
  args.push(END, assertRev('reference', ref));
  await runGit(repoPath, args, { env: NO_EDITOR });
}

export async function cherryPick(repoPath: string, sha: string, mainline?: number): Promise<void> {
  const args = ['cherry-pick'];
  if (mainline) args.push('-m', String(mainline));
  args.push(END, assertRev('commit', sha));
  await runGit(repoPath, args, { env: NO_EDITOR });
}

/** `git rebase <onto> [branch]`, or `--onto <onto> <upstream> [branch]` for a commit range. */
export async function rebase(repoPath: string, opts: { onto: string; upstream?: string; branch?: string }): Promise<void> {
  assertRev('onto', opts.onto);
  const args = ['rebase'];
  if (opts.upstream) args.push('--onto', opts.onto, END, assertRev('upstream', opts.upstream));
  else args.push(END, opts.onto);
  if (opts.branch) args.push(assertRev('branch', opts.branch));
  await runGit(repoPath, args, { env: NO_EDITOR });
}

export async function continueOperation(repoPath: string, kind: OperationKind): Promise<void> {
  await runGit(repoPath, [kind, '--continue'], { env: NO_EDITOR });
}

export async function abortOperation(repoPath: string, kind: OperationKind): Promise<void> {
  await runGit(repoPath, [kind, '--abort']);
}

export async function skipOperation(repoPath: string, kind: OperationKind): Promise<void> {
  await runGit(repoPath, [kind, '--skip'], { env: NO_EDITOR });
}

export type TodoAction = 'pick' | 'reword' | 'squash' | 'drop';

/** One row of an interactive rebase or multi-commit cherry-pick, oldest first. */
export type TodoEntry = { sha: string; action: TodoAction; message?: string };

/**
 * Interactive rebase driven by a generated todo. `upstream` is the base the rows are
 * replayed onto (`git rebase -i upstream [branch]`); rows may name any commit, which is how
 * a multi-commit cherry-pick runs (upstream HEAD, rows from elsewhere). Rewords run as an
 * `exec` that amends the message from a file; squashes keep git's combined message.
 */
export async function interactiveRebase(
  repoPath: string,
  opts: { upstream: string; branch?: string; entries: TodoEntry[]; root?: boolean }
): Promise<void> {
  for (const entry of opts.entries) assertRev('commit', entry.sha);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mygit-rebase-'));
  try {
    const lines: string[] = [];
    let messageIndex = 0;
    for (const entry of opts.entries) {
      if (entry.action === 'drop') {
        lines.push(`drop ${entry.sha}`);
        continue;
      }
      lines.push(`${entry.action === 'squash' ? 'squash' : 'pick'} ${entry.sha}`);
      if (entry.action === 'reword' && entry.message !== undefined) {
        const file = path.join(dir, `message-${messageIndex++}`);
        await fs.writeFile(file, entry.message);
        lines.push(`exec git commit --amend --only --cleanup=strip --no-verify -q -F ${shellQuote(file)}`);
      }
    }
    if (lines.length === 0) lines.push('noop');
    const todo = path.join(dir, 'todo');
    await fs.writeFile(todo, `${lines.join('\n')}\n`);

    const args = ['rebase', '-i', '--no-autosquash'];
    if (opts.root) args.push('--root');
    args.push(END);
    if (!opts.root) args.push(assertRev('upstream', opts.upstream));
    if (opts.branch) args.push(assertRev('branch', opts.branch));
    await runGit(repoPath, args, {
      env: { GIT_SEQUENCE_EDITOR: `cp ${shellQuote(todo)}`, GIT_EDITOR: 'true' },
    });
  } finally {
    // An exec line still pending after a conflict reads its message file: keep the
    // directory while a rebase is stopped.
    const stopped = await runGit(repoPath, ['rev-parse', '--git-path', 'rebase-merge']).then(
      async gitPath => fs.stat(path.resolve(repoPath, gitPath.trim())).then(() => true, () => false),
      () => false
    );
    if (!stopped) await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Commits in `from..to`, newest first, for the interactive rebase list. */
export async function listRange(repoPath: string, from: string | null, to: string): Promise<{ sha: string; message: string; body: string; author: string; merge: boolean }[]> {
  if (from) assertRev('range start', from);
  assertRev('range end', to);
  const output = await runGit(repoPath, [
    'log', '--topo-order', '--format=%H%x1f%P%x1f%s%x1f%an%x1f%b%x1e', END, from ? `${from}..${to}` : to,
  ]);
  return output.split('\x1e').map(record => record.replace(/^\n/, '')).filter(Boolean).map(record => {
    const [sha, parents, message, author, body] = record.split('\x1f');
    return { sha, message, author, body: body.trim(), merge: parents.split(' ').filter(Boolean).length > 1 };
  });
}

export async function isAncestor(repoPath: string, ancestor: string, descendant: string): Promise<boolean> {
  try {
    await runGit(repoPath, ['merge-base', '--is-ancestor', END, assertRev('commit', ancestor), assertRev('commit', descendant)]);
    return true;
  } catch {
    return false;
  }
}

export async function mergeBase(repoPath: string, a: string, b: string): Promise<string | null> {
  try {
    return (await runGit(repoPath, ['merge-base', END, assertRev('commit', a), assertRev('commit', b)])).trim() || null;
  } catch {
    return null;
  }
}

/** Commits on no branch, tag or remote ref: those a checkout away from a detached HEAD leaves behind. */
export async function isReferenced(repoPath: string, sha: string): Promise<boolean> {
  const output = await runGit(repoPath, ['for-each-ref', '--contains', assertRev('commit', sha), '--count=1', '--format=%(refname)', 'refs/heads', 'refs/remotes', 'refs/tags']);
  return output.trim().length > 0;
}
