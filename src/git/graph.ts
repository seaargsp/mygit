import { runGit } from './gitService';
import type { StashRef } from './refs';

export type CommitNode = {
  sha: string;
  parents: string[];
  message: string;
  author: string;
  authorEmail: string;
  date: string;
  refs: string[];
  body: string;
  /** Synthetic stash row: drawn on the commit the stash was created from. */
  stash?: { ref: string; index: number };
};

const FIELD_SEP = '\x1f';
const RECORD_SEP = '\x1e';

/**
 * Commits reachable from `revs` (passed on stdin, so thousands of refs do not hit the
 * command-line limit). An empty list yields no commits.
 */
export async function getCommitLog(
  repoPath: string,
  opts: { revs: string[]; limit: number | null; offset: number }
): Promise<CommitNode[]> {
  if (opts.revs.length === 0) return [];
  const args = [
    'log',
    '--stdin',
    `--skip=${opts.offset}`,
    '--topo-order',
    '--decorate=short',
    `--pretty=format:%H${FIELD_SEP}%P${FIELD_SEP}%an${FIELD_SEP}%ae${FIELD_SEP}%aI${FIELD_SEP}%s${FIELD_SEP}%D${FIELD_SEP}%b${RECORD_SEP}`,
  ];
  if (opts.limit !== null) args.push(`--max-count=${opts.limit}`);

  const output = await runGit(repoPath, args, { input: `${opts.revs.join('\n')}\n` });
  return output
    .split(RECORD_SEP)
    .map(record => record.replace(/^\n/, ''))
    .filter(Boolean)
    .map(record => {
      const [sha, parents, author, authorEmail, date, message, refs, body] = record.split(FIELD_SEP);
      return {
        sha,
        parents: parents ? parents.split(' ').filter(Boolean) : [],
        author,
        authorEmail,
        date,
        message,
        refs: refs ? refs.split(', ').filter(ref => ref && ref !== 'refs/stash') : [],
        body: body?.trim() ?? '',
      };
    });
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
