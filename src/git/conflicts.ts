import { runGit, runGitFull } from './gitService';

export type ConflictFile = { path: string; ranges: [number, number][] };
export type TargetConflicts = { target: string; targetSha: string; files: ConflictFile[] };

/** `**` spans path segments, `*` stays inside one, a leading `!` excludes. */
export function globToRegExp(glob: string): RegExp {
  let source = '';
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === '*' && glob[i + 1] === '*') {
      source += '.*';
      i += 1;
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

export function matchTargets(branches: string[], patterns: string[]): string[] {
  const include = patterns.filter(pattern => !pattern.startsWith('!')).map(globToRegExp);
  const exclude = patterns.filter(pattern => pattern.startsWith('!')).map(pattern => globToRegExp(pattern.slice(1)));
  return branches.filter(branch => include.some(re => re.test(branch)) && !exclude.some(re => re.test(branch)));
}

/** Line ranges of conflict blocks in a merged blob that carries conflict markers. */
function markerRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  let start = -1;
  text.split('\n').forEach((line, index) => {
    if (line.startsWith('<<<<<<< ')) start = index + 1;
    else if (line.startsWith('>>>>>>> ') && start !== -1) {
      ranges.push([start, index + 1]);
      start = -1;
    }
  });
  return ranges;
}

/**
 * Predicts the conflicts a merge of HEAD and `target` would produce, without touching the
 * working tree (`git merge-tree --write-tree`, git 2.38+).
 */
export async function predictConflicts(repoPath: string, target: string): Promise<TargetConflicts> {
  const targetSha = (await runGit(repoPath, ['rev-parse', '--verify', `${target}^{commit}`])).trim();
  const result = await runGitFull(repoPath, ['merge-tree', '--write-tree', '--no-messages', 'HEAD', targetSha], { okCodes: [1] });
  if (result.code === 0) return { target, targetSha, files: [] };

  const [tree, ...rest] = result.stdout.split('\n');
  const paths = new Set<string>();
  for (const line of rest) {
    const tab = line.indexOf('\t');
    if (tab !== -1) paths.add(line.slice(tab + 1));
  }
  const files: ConflictFile[] = [];
  for (const filePath of paths) {
    const blob = await runGit(repoPath, ['show', `${tree.trim()}:${filePath}`]).catch(() => '');
    files.push({ path: filePath, ranges: markerRanges(blob) });
  }
  return { target, targetSha, files };
}
