import { runGit } from './gitService';

export type DiffLineKind = 'context' | 'add' | 'del' | 'meta';

export type DiffLine = {
  kind: DiffLineKind;
  oldLine: number | null;
  newLine: number | null;
  text: string;
};

export type DiffHunk = { header: string; lines: DiffLine[] };

export type FileDiff = {
  path: string;
  hunks: DiffHunk[];
  binary: boolean;
  additions: number;
  deletions: number;
};

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseUnifiedDiff(path: string, patch: string): FileDiff {
  const diff: FileDiff = { path, hunks: [], binary: false, additions: 0, deletions: 0 };
  let hunk: DiffHunk | undefined;
  let oldLine = 0;
  let newLine = 0;

  for (const line of patch.split('\n')) {
    if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) {
      diff.binary = true;
      return diff;
    }

    const header = HUNK_HEADER.exec(line);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      hunk = { header: line, lines: [] };
      diff.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;

    if (line.startsWith('\\')) {
      hunk.lines.push({ kind: 'meta', oldLine: null, newLine: null, text: line.slice(2) });
    } else if (line.startsWith('+')) {
      hunk.lines.push({ kind: 'add', oldLine: null, newLine: newLine++, text: line.slice(1) });
      diff.additions += 1;
    } else if (line.startsWith('-')) {
      hunk.lines.push({ kind: 'del', oldLine: oldLine++, newLine: null, text: line.slice(1) });
      diff.deletions += 1;
    } else if (line.startsWith(' ')) {
      hunk.lines.push({ kind: 'context', oldLine: oldLine++, newLine: newLine++, text: line.slice(1) });
    }
  }

  return diff;
}

/** Diff of one path in a commit. Merges are shown against their first parent. */
export async function getCommitFileDiff(repoPath: string, sha: string, path: string): Promise<FileDiff> {
  const patch = await runGit(repoPath, [
    'show', '--format=', '--no-color', '-m', '--first-parent', '--unified=3', sha, '--', path,
  ]);
  return parseUnifiedDiff(path, patch);
}

export async function getWorkingFileDiff(repoPath: string, path: string, staged: boolean): Promise<FileDiff> {
  const args = ['diff', '--no-color', '--unified=3'];
  if (staged) args.push('--cached');
  args.push('--', path);
  return parseUnifiedDiff(path, await runGit(repoPath, args));
}
