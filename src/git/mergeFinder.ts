import { END_OF_OPTIONS as END, runGit } from './gitService';
import { assertRev } from './argGuard';

export type MergeResult = {
  sha: string;
  date: string;
  author: string;
  subject: string;
  /** Direct: the merged parent is on the source branch. Indirect: it came through another branch. */
  kind: 'direct' | 'indirect' | 'fast-forward';
  via: string | null;
  /** Source commits this merge brought in; null for a fast-forward. */
  count: number | null;
};

export type MergeFinderResult = { results: MergeResult[]; unmerged: number; truncated: boolean };

export const MAX_ROUNDS = 200;

const VIA = [/^Merge branch '(.+?)'/, /^Merge remote-tracking branch '(.+?)'/, /^Merge pull request #\d+ from \S+?\/(\S+)/];

export function viaFromSubject(subject: string): string | null {
  for (const pattern of VIA) {
    const match = pattern.exec(subject);
    if (match) return match[1];
  }
  return null;
}

/**
 * Merge commits on `target`'s first-parent line that brought in commits of `source`
 * (the git-when-merged method): the oldest first-parent commit of the target descending
 * from a source commit is the merge that brought it in; the search continues from the
 * newest source commit already in that merge's first parent.
 */
export async function findMerges(repoPath: string, source: string, target: string, signal?: AbortSignal): Promise<MergeFinderResult> {
  assertRev('source', source);
  assertRev('target', target);
  const git = async (args: string[]) => (await runGit(repoPath, args, { signal })).trim();
  const isAncestor = (a: string, b: string) => runGit(repoPath, ['merge-base', '--is-ancestor', END, a, b], { signal }).then(() => true, () => false);
  const meta = async (sha: string) => {
    const [date, author, subject] = (await git(['log', '-1', '--no-show-signature', '--format=%aI%x1f%an%x1f%s', END, sha])).split('\x1f');
    return { date, author, subject };
  };

  const tipB = await git(['rev-parse', '--verify', '-q', `${target}^{commit}`]);
  const tipA = await git(['rev-parse', '--verify', '-q', `${source}^{commit}`]);
  const unmerged = Number(await git(['rev-list', '--count', END, `${tipB}..${tipA}`]));
  const results: MergeResult[] = [];
  const fastForward = async (sha: string): Promise<MergeResult> => ({ sha, ...(await meta(sha)), kind: 'fast-forward', via: null, count: null });

  let x = tipA;
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    if (signal?.aborted) throw new Error('Cancelled');
    if (x === tipB) {
      if (results.length === 0) results.push(await fastForward(x));
      return { results, unmerged, truncated: false };
    }
    // Combined with --first-parent, --ancestry-path follows first-parent edges only and misses a
    // merge that reached x through a second parent: the two walks run separately and intersect.
    const lines = (output: string) => output.split('\n').filter(Boolean);
    const [firstParent, descendants] = await Promise.all([
      git(['rev-list', '--first-parent', END, `${x}..${tipB}`]).then(lines),
      git(['rev-list', '--ancestry-path', END, `${x}..${tipB}`]).then(output => new Set(lines(output))),
    ]);
    const chain = firstParent.filter(sha => descendants.has(sha));
    if (chain.length === 0) return { results, unmerged, truncated: false };
    const merge = chain[chain.length - 1];
    const parents = (await git(['rev-list', '--parents', '-n', '1', END, merge])).split(' ').slice(1);
    if (parents[0] === x) {
      // x lies on the target's first-parent line: a fast-forward when x is the source tip,
      // otherwise the fork point (or an earlier fast-forward, which ancestry cannot tell apart).
      if (results.length === 0) results.push(await fastForward(x));
      return { results, unmerged, truncated: false };
    }
    let merged: string | undefined;
    for (const parent of parents.slice(1)) {
      if (await isAncestor(x, parent)) {
        merged = parent;
        break;
      }
    }
    if (!merged) return { results, unmerged, truncated: false };
    const direct = await isAncestor(merged, tipA);
    const info = await meta(merge);
    let via: string | null = null;
    if (!direct) {
      via = viaFromSubject(info.subject);
      if (!via) via = (await git(['name-rev', '--name-only', '--no-undefined', END, merged]).catch(() => '')).replace(/[~^].*$/, '') || null;
    }
    const count = Number(await git(['rev-list', '--count', END, x, `^${parents[0]}`]));
    results.push({ sha: merge, ...info, kind: direct ? 'direct' : 'indirect', via, count });
    const next = await git(['merge-base', END, tipA, parents[0]]).catch(() => '');
    if (!next || next === x) return { results, unmerged, truncated: false };
    x = next;
  }
  return { results, unmerged, truncated: true };
}
