import { runGit } from './gitService';
import type { StashRef } from './refs';

export type CommitNode = {
  sha: string;
  parents: string[];
  message: string;
  author: string;
  authorEmail: string;
  /** Author date. */
  date: string;
  /** Committer date: the graph's sort key. */
  commitDate: string;
  refs: string[];
  body: string;
  /** Synthetic stash row: drawn on the commit the stash was created from. */
  stash?: { ref: string; index: number };
};

const FIELD_SEP = '\x1f';
const RECORD_SEP = '\x1e';

/**
 * Commits reachable from `revs`, newest committer date first with every child above its
 * parents (`--date-order`). Refnames go on stdin, so thousands of refs do not hit the
 * command-line limit; pseudo-options (`--branches`, `--remotes`, `--tags`) go on argv. An
 * empty list yields no commits.
 */
export async function getCommitLog(
  repoPath: string,
  opts: { revs: string[]; limit: number | null; offset: number }
): Promise<CommitNode[]> {
  if (opts.revs.length === 0) return [];
  const pseudo = opts.revs.filter(rev => rev.startsWith('--'));
  const refs = opts.revs.filter(rev => !rev.startsWith('--'));
  const args = [
    'log',
    '--stdin',
    `--skip=${opts.offset}`,
    '--date-order',
    // log.showSignature would run gpg once per commit.
    '--no-show-signature',
    '--decorate=short',
    `--pretty=format:%H${FIELD_SEP}%P${FIELD_SEP}%an${FIELD_SEP}%ae${FIELD_SEP}%aI${FIELD_SEP}%cI${FIELD_SEP}%s${FIELD_SEP}%D${FIELD_SEP}%b${RECORD_SEP}`,
    ...pseudo,
  ];
  if (opts.limit !== null) args.push(`--max-count=${opts.limit}`);

  const output = await runGit(repoPath, args, { input: refs.length > 0 ? `${refs.join('\n')}\n` : '' });
  return output
    .split(RECORD_SEP)
    .map(record => record.replace(/^\n/, ''))
    .filter(Boolean)
    .map(record => {
      const [sha, parents, author, authorEmail, date, commitDate, message, refs, body] = record.split(FIELD_SEP);
      return {
        sha,
        parents: parents ? parents.split(' ').filter(Boolean) : [],
        author,
        authorEmail,
        date,
        commitDate,
        message,
        refs: refs ? refs.split(', ').filter(ref => ref && ref !== 'refs/stash') : [],
        body: body?.trim() ?? '',
      };
    });
}

/** Pseudo-options go on argv, refnames on stdin (see getCommitLog). */
function splitRevs(revs: string[]): { pseudo: string[]; input: string } {
  const refs = revs.filter(rev => !rev.startsWith('--'));
  return { pseudo: revs.filter(rev => rev.startsWith('--')), input: refs.length > 0 ? `${refs.join('\n')}\n` : '' };
}

export type CommitSearch = { shas: string[]; truncated: boolean };

/** Minimum length of a message or author query; shorter ones match too much history to be useful. */
export const MIN_SEARCH_LENGTH = 3;

/**
 * Commits reachable from `revs` whose message or author ("Name <email>") contains `query`
 * (case-insensitive, literal), or whose SHA starts with it, in graph order (`--date-order`).
 * Only SHAs are read. Message and author run as two walks: git ANDs `--grep` with `--author`.
 */
export async function searchCommits(
  repoPath: string,
  opts: { revs: string[]; query: string; limit: number; signal?: AbortSignal }
): Promise<CommitSearch> {
  const needle = opts.query.trim();
  if (opts.revs.length === 0 || !needle) return { shas: [], truncated: false };
  const { pseudo, input } = splitRevs(opts.revs);
  type Hit = { sha: string; time: number };
  const walk = (filter: string): Promise<Hit[]> => runGit(repoPath, [
    'log', '--stdin', '--date-order', '--no-show-signature', '-i', '-F', filter,
    '--format=%H %ct', `--max-count=${opts.limit + 1}`, ...pseudo,
  ], { input, signal: opts.signal }).then(output => output.split('\n').filter(Boolean).map(line => {
    const [sha, time] = line.split(' ');
    return { sha, time: Number(time) };
  }));

  const sha = /^[0-9a-f]{4,40}$/i.test(needle)
    ? runGit(repoPath, ['rev-parse', '--verify', '-q', `${needle}^{commit}`], { signal: opts.signal }).then(output => output.trim(), () => '')
    : Promise.resolve('');
  const text = needle.length >= MIN_SEARCH_LENGTH;
  const [bySha, byMessage, byAuthor] = await Promise.all([
    sha,
    text ? walk(`--grep=${needle}`) : Promise.resolve([]),
    text ? walk(`--author=${needle}`) : Promise.resolve([]),
  ]);

  // --date-order sorts by committer date (children first on clock skew): merging the two
  // walks by that date reproduces the graph order.
  const merged: string[] = bySha ? [bySha] : [];
  const seen = new Set(merged);
  let m = 0;
  let a = 0;
  while (m < byMessage.length || a < byAuthor.length) {
    const next = a >= byAuthor.length || (m < byMessage.length && byMessage[m].time >= byAuthor[a].time) ? byMessage[m++] : byAuthor[a++];
    if (!seen.has(next.sha)) {
      seen.add(next.sha);
      merged.push(next.sha);
    }
  }
  const truncated = byMessage.length > opts.limit || byAuthor.length > opts.limit || merged.length > opts.limit;
  return { shas: merged.slice(0, opts.limit), truncated };
}

/** Commits reachable from `revs` with a committer date at or after `sha`'s: about its row in the graph. */
export async function countNewerCommits(repoPath: string, revs: string[], sha: string): Promise<number | null> {
  const date = (await runGit(repoPath, ['log', '-1', '--no-show-signature', '--format=%cI', sha]).catch(() => '')).trim();
  if (!date) return null;
  const { pseudo, input } = splitRevs(revs);
  const output = await runGit(repoPath, ['rev-list', '--stdin', '--count', `--since=${date}`, ...pseudo], { input });
  return Number(output.trim()) || 0;
}

/** Places each stash directly above the commit it was created from; stashes on unloaded commits are left out. */
export function insertStashes(commits: CommitNode[], stashes: StashRef[]): CommitNode[] {
  if (stashes.length === 0) return commits;
  const byBase = new Map<string, StashRef[]>();
  for (const stash of stashes) {
    const list = byBase.get(stash.base) ?? [];
    list.push(stash);
    byBase.set(stash.base, list);
  }
  const result: CommitNode[] = [];
  for (const commit of commits) {
    for (const stash of byBase.get(commit.sha) ?? []) {
      result.push({
        sha: stash.sha,
        parents: [stash.base],
        message: stash.message,
        author: '',
        authorEmail: '',
        date: stash.date,
        commitDate: stash.date,
        refs: [],
        body: '',
        stash: { ref: stash.ref, index: stash.index },
      });
    }
    result.push(commit);
  }
  return result;
}

export type LaneCommit = CommitNode & {
  lane: number;
  /** Lane each parent edge travels down; it bends into the parent's own lane at the parent row. */
  parentLanes: number[];
  /** Outside the soloed references: drawn dimmed. */
  muted?: boolean;
};

/**
 * Lane assignment over a topologically ordered list. A lane is reserved for the parent an
 * edge is heading to and released when that parent is placed. `pinned` holds the
 * first-parent chain of a branch pinned to the left: it alone occupies lane 0.
 */
export function assignLanes(commits: CommitNode[], pinned: Set<string> = new Set()): LaneCommit[] {
  const pinActive = pinned.size > 0;
  const lanes: (string | null)[] = pinActive ? [null] : [];
  const result: LaneCommit[] = [];

  const findFreeLane = (): number => {
    for (let i = pinActive ? 1 : 0; i < lanes.length; i += 1) {
      if (lanes[i] === null) return i;
    }
    lanes.push(null);
    return lanes.length - 1;
  };

  for (const commit of commits) {
    const holders: number[] = [];
    lanes.forEach((sha, index) => {
      if (sha === commit.sha) holders.push(index);
    });

    let lane: number;
    if (pinned.has(commit.sha)) lane = 0;
    else lane = holders.find(index => !(pinActive && index === 0)) ?? findFreeLane();
    for (const holder of holders) lanes[holder] = null;

    const parentLanes: number[] = [];
    commit.parents.forEach((parent, index) => {
      if (index === 0) {
        if (pinned.has(commit.sha) && pinned.has(parent)) {
          lanes[0] = parent;
          parentLanes.push(0);
        } else {
          lanes[lane] = parent;
          parentLanes.push(lane);
        }
        return;
      }
      const existing = lanes.indexOf(parent);
      if (existing !== -1) {
        parentLanes.push(existing);
        return;
      }
      const free = findFreeLane();
      lanes[free] = parent;
      parentLanes.push(free);
    });

    while (lanes.length > (pinActive ? 1 : 0) && lanes[lanes.length - 1] === null) lanes.pop();
    result.push({ ...commit, lane, parentLanes });
  }

  return result;
}

/** First-parent chain from `tip` within the loaded commits. */
export function firstParentChain(commits: CommitNode[], tip: string): Set<string> {
  const bySha = new Map(commits.map(commit => [commit.sha, commit]));
  const chain = new Set<string>();
  let current = bySha.get(tip);
  while (current && !chain.has(current.sha)) {
    chain.add(current.sha);
    current = current.parents[0] ? bySha.get(current.parents[0]) : undefined;
  }
  return chain;
}

/** Commits reachable from `tips` within the loaded commits (tips included). */
export function reachableFrom(commits: CommitNode[], tips: Iterable<string>): Set<string> {
  const bySha = new Map(commits.map(commit => [commit.sha, commit]));
  const reached = new Set<string>();
  const stack = [...tips];
  while (stack.length > 0) {
    const sha = stack.pop()!;
    if (reached.has(sha)) continue;
    reached.add(sha);
    const commit = bySha.get(sha);
    if (commit) stack.push(...commit.parents);
  }
  return reached;
}
