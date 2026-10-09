import { runGit } from './gitService';
import { assertRev } from './argGuard';
import { parseNameStatus } from './diff';
import type { FileChange } from './status';

/** Stashes all uncommitted changes, untracked files included; `paths` limits it to those files. */
export async function stashSave(repoPath: string, opts: { message?: string; paths?: string[] }): Promise<void> {
  const args = ['stash', 'push', '--include-untracked'];
  if (opts.message) args.push('-m', opts.message);
  if (opts.paths && opts.paths.length > 0) args.push('--', ...opts.paths);
  await runGit(repoPath, args);
}

export async function stashApply(repoPath: string, ref: string): Promise<void> {
  await runGit(repoPath, ['stash', 'apply', assertRev('stash', ref)]);
}

export async function stashPop(repoPath: string, ref?: string): Promise<void> {
  await runGit(repoPath, ref ? ['stash', 'pop', assertRev('stash', ref)] : ['stash', 'pop']);
}

export async function stashDrop(repoPath: string, ref: string): Promise<void> {
  await runGit(repoPath, ['stash', 'drop', assertRev('stash', ref)]);
}

/**
 * Renames a stash by dropping the entry and storing the same commit under a new message.
 * The entry moves to the top of the stash list.
 */
export async function stashRename(repoPath: string, ref: string, sha: string, message: string): Promise<void> {
  await runGit(repoPath, ['stash', 'drop', assertRev('stash', ref)]);
  await runGit(repoPath, ['stash', 'store', '-m', message, assertRev('commit', sha)]);
}

/** Tracked changes against the base commit plus untracked files kept in the stash's third parent. */
export async function getStashFiles(repoPath: string, sha: string): Promise<FileChange[]> {
  const tracked = parseNameStatus(await runGit(repoPath, ['diff', '--name-status', '-z', '-M', `${sha}^1`, sha]));
  let untracked: FileChange[] = [];
  try {
    const output = await runGit(repoPath, ['ls-tree', '-r', '-z', '--name-only', `${sha}^3`]);
    untracked = output.split('\0').filter(Boolean).map(filePath => ({ path: filePath, status: 'A' as const, untracked: true }));
  } catch {
    // No untracked files were stashed.
  }
  return [...tracked, ...untracked];
}

/** Snapshot of the working tree and index as a dangling stash commit, without touching either. */
export async function stashCreate(repoPath: string): Promise<string | null> {
  const sha = (await runGit(repoPath, ['stash', 'create'])).trim();
  return sha || null;
}
