import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { runGit } from './gitService';
import type { FileChange } from './status';

export type DiffLineKind = 'context' | 'add' | 'del' | 'meta';

export type DiffLine = {
  kind: DiffLineKind;
  oldLine: number | null;
  newLine: number | null;
  text: string;
};

export type DiffHunk = { header: string; oldStart: number; newStart: number; lines: DiffLine[] };

export type FileDiff = {
  path: string;
  /** Lines before the first hunk (`diff --git`, `---`, `+++`), needed to rebuild partial patches. */
  header: string[];
  hunks: DiffHunk[];
  binary: boolean;
  additions: number;
  deletions: number;
};

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseUnifiedDiff(filePath: string, patch: string): FileDiff {
  const diff: FileDiff = { path: filePath, header: [], hunks: [], binary: false, additions: 0, deletions: 0 };
  let hunk: DiffHunk | undefined;
  let oldLine = 0;
  let newLine = 0;

  const lines = patch.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();

  for (const line of lines) {
    if (!hunk && (line.startsWith('Binary files') || line.startsWith('GIT binary patch'))) {
      diff.binary = true;
      return diff;
    }

    const header = HUNK_HEADER.exec(line);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      hunk = { header: line, oldStart: oldLine, newStart: newLine, lines: [] };
      diff.hunks.push(hunk);
      continue;
    }
    if (!hunk) {
      diff.header.push(line);
      continue;
    }

    if (line.startsWith('\\')) {
      hunk.lines.push({ kind: 'meta', oldLine: null, newLine: null, text: line.slice(2) });
    } else if (line.startsWith('+')) {
      hunk.lines.push({ kind: 'add', oldLine: null, newLine: newLine++, text: line.slice(1) });
      diff.additions += 1;
    } else if (line.startsWith('-')) {
      hunk.lines.push({ kind: 'del', oldLine: oldLine++, newLine: null, text: line.slice(1) });
      diff.deletions += 1;
    } else if (line.startsWith(' ') || line === '') {
      hunk.lines.push({ kind: 'context', oldLine: oldLine++, newLine: newLine++, text: line.slice(1) });
    }
  }

  return diff;
}

/** Context lines around each change: a few for hunk view, the whole file for inline and split. */
export type DiffContext = 'hunk' | 'full';

function unified(context: DiffContext): string {
  return context === 'full' ? '--unified=1000000' : '--unified=3';
}

/** Diff of one path in a commit against its first parent (root commits against the empty tree). */
export async function getCommitFileDiff(repoPath: string, sha: string, filePath: string, context: DiffContext = 'hunk'): Promise<FileDiff> {
  const patch = await runGit(repoPath, [
    'show', '--format=', '--no-color', '-m', '--first-parent', unified(context), sha, '--', filePath,
  ]);
  return parseUnifiedDiff(filePath, patch);
}

/** Diff of one path between two revisions; `to` may be the working tree. */
export async function getRangeFileDiff(
  repoPath: string,
  from: string,
  to: string | 'working-tree',
  filePath: string,
  context: DiffContext = 'hunk'
): Promise<FileDiff> {
  const args = ['diff', '--no-color', unified(context), from];
  if (to !== 'working-tree') args.push(to);
  args.push('--', filePath);
  return parseUnifiedDiff(filePath, await runGit(repoPath, args));
}

export async function getWorkingFileDiff(
  repoPath: string,
  filePath: string,
  staged: boolean,
  context: DiffContext = 'hunk',
  untracked = false
): Promise<FileDiff> {
  if (untracked) {
    const patch = await runGit(
      repoPath,
      ['diff', '--no-color', '--no-index', unified(context), '--', '/dev/null', filePath],
      { okCodes: [1] }
    );
    return parseUnifiedDiff(filePath, patch);
  }
  const args = ['diff', '--no-color', unified(context)];
  if (staged) args.push('--cached');
  args.push('--', filePath);
  return parseUnifiedDiff(filePath, await runGit(repoPath, args));
}

/** Files changed between two revisions (or a revision and the working tree). */
export async function getRangeFiles(repoPath: string, from: string, to: string | 'working-tree'): Promise<FileChange[]> {
  const args = ['diff', '--name-status', '-z', '-M', from];
  if (to !== 'working-tree') args.push(to);
  return parseNameStatus(await runGit(repoPath, args));
}

export function parseNameStatus(output: string): FileChange[] {
  const fields = output.split('\0');
  const files: FileChange[] = [];
  for (let i = 0; i < fields.length; i += 1) {
    const code = fields[i];
    if (!code) continue;
    const kind = code[0];
    if (kind === 'R' || kind === 'C') {
      const oldPath = fields[++i];
      const newPath = fields[++i];
      files.push({ path: newPath, oldPath, status: kind === 'R' ? 'R' : 'A' });
    } else {
      const filePath = fields[++i];
      files.push({ path: filePath, status: (kind === 'T' ? 'M' : kind) as FileChange['status'] });
    }
  }
  return files;
}

/** File content at a revision; `working-tree` reads the file on disk, `index` the staged blob. */
export async function getFileContent(repoPath: string, rev: string | 'working-tree' | 'index', filePath: string): Promise<string> {
  if (rev === 'working-tree') {
    try {
      return await fs.readFile(path.join(repoPath, filePath), 'utf8');
    } catch {
      return '';
    }
  }
  const spec = rev === 'index' ? `:${filePath}` : `${rev}:${filePath}`;
  try {
    return await runGit(repoPath, ['show', spec]);
  } catch {
    return '';
  }
}

export type HistoryEntry = { sha: string; author: string; date: string; message: string; path: string };

/** Commits touching a file, following renames; each entry carries the path the file had in it. */
export async function getFileHistory(repoPath: string, filePath: string, limit = 500): Promise<HistoryEntry[]> {
  const output = await runGit(repoPath, [
    'log', '--follow', '--name-only', `--max-count=${limit}`,
    '--format=%x1e%H%x1f%an%x1f%aI%x1f%s', '--', filePath,
  ]);
  const entries: HistoryEntry[] = [];
  for (const record of output.split('\x1e')) {
    if (!record.trim()) continue;
    const [head, ...rest] = record.split('\n');
    const [sha, author, date, message] = head.split('\x1f');
    const filePathAt = rest.map(line => line.trim()).find(Boolean) ?? filePath;
    entries.push({ sha, author, date, message, path: filePathAt });
  }
  return entries;
}

export type BlameLine = { sha: string; author: string; date: string; summary: string; line: number; text: string };

/** Line-by-line blame at a revision (or the working tree). */
export async function getBlame(repoPath: string, filePath: string, rev: string | 'working-tree'): Promise<BlameLine[]> {
  const args = ['blame', '--porcelain'];
  if (rev !== 'working-tree') args.push(rev);
  args.push('--', filePath);
  const output = await runGit(repoPath, args);
  const commits = new Map<string, { author: string; date: string; summary: string }>();
  const lines: BlameLine[] = [];
  const records = output.split('\n');
  let current: { sha: string; line: number } | undefined;
  let pending: { author?: string; time?: number; summary?: string } = {};

  for (const record of records) {
    if (record.startsWith('\t')) {
      if (!current) continue;
      if (!commits.has(current.sha)) {
        commits.set(current.sha, {
          author: pending.author ?? '',
          date: pending.time ? new Date(pending.time * 1000).toISOString() : '',
          summary: pending.summary ?? '',
        });
      }
      const info = commits.get(current.sha)!;
      lines.push({ sha: current.sha, line: current.line, text: record.slice(1), ...info });
      pending = {};
      continue;
    }
    const head = /^([0-9a-f]{40}) \d+ (\d+)/.exec(record);
    if (head) {
      current = { sha: head[1], line: Number(head[2]) };
      continue;
    }
    if (record.startsWith('author ')) pending.author = record.slice(7);
    else if (record.startsWith('author-time ')) pending.time = Number(record.slice(12));
    else if (record.startsWith('summary ')) pending.summary = record.slice(8);
  }
  return lines;
}

export type LineSelection = { hunk: number; lines?: number[] };

/**
 * Patch holding only the selected lines of one hunk, for `git apply`. `reverse` marks a
 * patch that is applied with -R (unstage, discard): unselected additions are then already
 * present on the target side and stay as context, unselected deletions are left out.
 * Forward patches (stage) keep unselected deletions as context and drop unselected additions.
 */
export function buildPartialPatch(diff: FileDiff, selection: LineSelection, reverse: boolean): string {
  const hunk = diff.hunks[selection.hunk];
  if (!hunk) throw new Error('The hunk no longer exists. Refresh the diff and try again.');
  const chosen = selection.lines ? new Set(selection.lines) : undefined;
  const body: string[] = [];
  let oldCount = 0;
  let newCount = 0;

  hunk.lines.forEach((line, index) => {
    const selected = !chosen || chosen.has(index);
    if (line.kind === 'meta') {
      body.push(`\\ ${line.text}`);
      return;
    }
    if (line.kind === 'context') {
      body.push(` ${line.text}`);
      oldCount += 1;
      newCount += 1;
    } else if (line.kind === 'add') {
      if (selected) {
        body.push(`+${line.text}`);
        newCount += 1;
      } else if (reverse) {
        body.push(` ${line.text}`);
        oldCount += 1;
        newCount += 1;
      }
    } else if (line.kind === 'del') {
      if (selected) {
        body.push(`-${line.text}`);
        oldCount += 1;
      } else if (!reverse) {
        body.push(` ${line.text}`);
        oldCount += 1;
        newCount += 1;
      }
    }
  });

  // A partial patch never creates or deletes the file, so creation and deletion markers go.
  const header = diff.header
    .filter(line => line.startsWith('diff --git') || line.startsWith('--- ') || line.startsWith('+++ '))
    .map(line => {
      if (line === '--- /dev/null') return `--- a/${diff.path}`;
      if (line === '+++ /dev/null') return `+++ b/${diff.path}`;
      return line;
    });
  // A hunk with lines on a side cannot start at line 0 (git uses 0 only for an empty side).
  const oldStart = oldCount > 0 ? Math.max(1, hunk.oldStart) : hunk.oldStart;
  const newStart = newCount > 0 ? Math.max(1, hunk.newStart) : hunk.newStart;
  const hunkHeader = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`;
  return `${[...header, hunkHeader, ...body].join('\n')}\n`;
}

/** Text of a patch file for a commit (format-patch) or for chosen paths of a diff. */
export async function createPatch(
  repoPath: string,
  source: { kind: 'commits'; from: string; to: string } | { kind: 'paths'; from: string | null; to: string | 'working-tree' | 'index'; paths: string[] }
): Promise<string> {
  if (source.kind === 'commits') {
    return runGit(repoPath, ['format-patch', '--stdout', `${source.from}..${source.to}`]);
  }
  const args = ['diff', '--no-color', '--binary'];
  if (source.to === 'index') args.push('--cached');
  else if (source.from) {
    args.push(source.from);
    if (source.to !== 'working-tree') args.push(source.to);
  } else {
    args.push('HEAD');
  }
  args.push('--', ...source.paths);
  return runGit(repoPath, args);
}
