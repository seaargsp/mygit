import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { runGit } from './gitService';

export type FileStatus = 'A' | 'M' | 'D' | 'R' | 'U';

export type FileChange = {
  path: string;
  status: FileStatus;
  oldPath?: string;
  /** Untracked files are listed as added in the unstaged section. */
  untracked?: boolean;
  /** Porcelain XY code of a conflicted path (UU, AA, DU, ...). */
  conflict?: string;
};

export type BranchStatus = {
  oid: string | null;
  head: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
};

export type WorkingTreeStatus = {
  staged: FileChange[];
  unstaged: FileChange[];
  conflicted: FileChange[];
  branch: BranchStatus;
};

export const EMPTY_STATUS: WorkingTreeStatus = {
  staged: [],
  unstaged: [],
  conflicted: [],
  branch: { oid: null, head: null, upstream: null, ahead: 0, behind: 0 },
};

function normalise(code: string): FileStatus {
  if (code === 'T') return 'M';
  if (code === 'C') return 'A';
  return code as FileStatus;
}

/** Path field of a porcelain v2 record: everything after `fixed` space-separated fields. */
function pathAfter(record: string, fixed: number): string {
  let index = 0;
  for (let i = 0; i < fixed; i += 1) index = record.indexOf(' ', index) + 1;
  return record.slice(index);
}

export async function getWorkingTreeStatus(repoPath: string): Promise<WorkingTreeStatus> {
  // --no-optional-locks keeps status from rewriting .git/index, which the panel watches.
  const output = await runGit(repoPath, [
    '--no-optional-locks', 'status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all',
  ]);
  const status: WorkingTreeStatus = {
    staged: [],
    unstaged: [],
    conflicted: [],
    branch: { oid: null, head: null, upstream: null, ahead: 0, behind: 0 },
  };
  const records = output.split('\0');

  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (!record) continue;
    if (record.startsWith('# ')) {
      const [, key, ...rest] = record.split(' ');
      const value = rest.join(' ');
      if (key === 'branch.oid') status.branch.oid = value === '(initial)' ? null : value;
      else if (key === 'branch.head') status.branch.head = value === '(detached)' ? null : value;
      else if (key === 'branch.upstream') status.branch.upstream = value;
      else if (key === 'branch.ab') {
        const [ahead, behind] = rest;
        status.branch.ahead = Math.abs(Number(ahead));
        status.branch.behind = Math.abs(Number(behind));
      }
    } else if (record.startsWith('1 ') || record.startsWith('2 ')) {
      const renamed = record.startsWith('2 ');
      const xy = record.slice(2, 4);
      const filePath = pathAfter(record, renamed ? 9 : 8);
      const oldPath = renamed ? records[++i] : undefined;
      const [x, y] = xy;
      if (x !== '.') status.staged.push({ path: filePath, status: normalise(x), oldPath: x === 'R' ? oldPath : undefined });
      if (y !== '.') status.unstaged.push({ path: filePath, status: normalise(y), oldPath: y === 'R' ? oldPath : undefined });
    } else if (record.startsWith('u ')) {
      status.conflicted.push({ path: pathAfter(record, 10), status: 'U', conflict: record.slice(2, 4) });
    } else if (record.startsWith('? ')) {
      status.unstaged.push({ path: record.slice(2), status: 'A', untracked: true });
    }
  }

  return status;
}

export async function stageFiles(repoPath: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await runGit(repoPath, ['add', '-A', '--', ...paths]);
}

export async function unstageFiles(repoPath: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  if (await hasHead(repoPath)) await runGit(repoPath, ['restore', '--staged', '--', ...paths]);
  else await runGit(repoPath, ['rm', '--cached', '-r', '-q', '--', ...paths]);
}

export async function stageAll(repoPath: string): Promise<void> {
  await runGit(repoPath, ['add', '-A']);
}

export async function unstageAll(repoPath: string): Promise<void> {
  if (await hasHead(repoPath)) await runGit(repoPath, ['reset', '-q']);
  else await runGit(repoPath, ['rm', '--cached', '-r', '-q', '.']);
}

/** Discards unstaged changes: tracked paths return to the index version, untracked paths are deleted. */
export async function discardFiles(repoPath: string, files: { path: string; untracked?: boolean }[]): Promise<void> {
  const tracked = files.filter(file => !file.untracked).map(file => file.path);
  const untracked = files.filter(file => file.untracked).map(file => file.path);
  if (tracked.length > 0) await runGit(repoPath, ['checkout', '--', ...tracked]);
  if (untracked.length > 0) await runGit(repoPath, ['clean', '-f', '-q', '--', ...untracked]);
}

export async function discardAll(repoPath: string): Promise<void> {
  if (await hasHead(repoPath)) await runGit(repoPath, ['reset', '--hard', '-q']);
  await runGit(repoPath, ['clean', '-f', '-d', '-q']);
}

export async function hasHead(repoPath: string): Promise<boolean> {
  try {
    await runGit(repoPath, ['rev-parse', '--verify', '-q', 'HEAD']);
    return true;
  } catch {
    return false;
  }
}

/** Applies a patch to the index (`cached`), the working tree, or reversed. */
export async function applyPatch(repoPath: string, patch: string, opts: { cached: boolean; reverse: boolean }): Promise<void> {
  const args = ['apply', '--whitespace=nowarn', '--recount'];
  if (opts.cached) args.push('--cached');
  if (opts.reverse) args.push('-R');
  args.push('-');
  await runGit(repoPath, args, { input: patch });
}

/** Records an untracked file in the index without content, so its lines can be staged one by one. */
export async function intentToAdd(repoPath: string, filePath: string): Promise<void> {
  await runGit(repoPath, ['add', '-N', '--', filePath]);
}

export async function takeSide(repoPath: string, paths: string[], side: 'ours' | 'theirs'): Promise<void> {
  await runGit(repoPath, ['checkout', `--${side}`, '--', ...paths]);
  await runGit(repoPath, ['add', '--', ...paths]);
}

/** Every tracked path (working tree) or every path in a commit's tree. */
export async function listAllFiles(repoPath: string, rev: string | 'working-tree'): Promise<string[]> {
  const output = rev === 'working-tree'
    ? await runGit(repoPath, ['ls-files', '-z'])
    : await runGit(repoPath, ['ls-tree', '-r', '-z', '--name-only', rev]);
  return output.split('\0').filter(Boolean);
}

export type IgnoreMode = 'file' | 'extension' | 'directory';

export function ignoreRule(filePath: string, mode: IgnoreMode): string {
  if (mode === 'extension') return `*${path.posix.extname(filePath)}`;
  if (mode === 'directory') return `/${path.posix.dirname(filePath)}/`;
  return `/${filePath}`;
}

/** Appends a rule to the root .gitignore; `stopTracking` also removes the file from the index. */
export async function ignoreFile(repoPath: string, filePath: string, mode: IgnoreMode, stopTracking: boolean): Promise<void> {
  const file = path.join(repoPath, '.gitignore');
  let existing = '';
  try {
    existing = await fs.readFile(file, 'utf8');
  } catch {
    existing = '';
  }
  const rule = ignoreRule(filePath, mode);
  if (!existing.split(/\r?\n/).includes(rule)) {
    const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
    await fs.writeFile(file, `${existing}${separator}${rule}\n`);
  }
  if (stopTracking) {
    const target = mode === 'file' ? filePath : mode === 'directory' ? path.posix.dirname(filePath) : filePath;
    await runGit(repoPath, ['rm', '--cached', '-r', '-q', '--', target]);
  }
}

export async function isTracked(repoPath: string, filePath: string): Promise<boolean> {
  const output = await runGit(repoPath, ['ls-files', '--', filePath]);
  return output.trim().length > 0;
}

export async function createFile(repoPath: string, filePath: string): Promise<string> {
  const absolute = path.join(repoPath, filePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, '', { flag: 'wx' });
  return absolute;
}

export async function deleteFiles(repoPath: string, paths: string[]): Promise<void> {
  for (const filePath of paths) await fs.rm(path.join(repoPath, filePath), { force: true, recursive: true });
}

/** Writes a file's content at `sha` to the working tree and the index; restores deleted files too. */
export async function restoreFromCommit(repoPath: string, sha: string, paths: string[]): Promise<void> {
  await runGit(repoPath, ['checkout', sha, '--', ...paths]);
}

/** Removes `*.orig` backups left by merge tools. */
export async function deleteOrigFiles(repoPath: string): Promise<void> {
  const output = await runGit(repoPath, ['ls-files', '-z', '--others', '--exclude-standard']);
  const backups = output.split('\0').filter(file => file.endsWith('.orig'));
  await deleteFiles(repoPath, backups);
}
