import { runGit } from './gitService';

export type CommitNode = {
  sha: string;
  parents: string[];
  message: string;
  author: string;
  date: string;
  refs: string[];
  body: string;
};

const FIELD_SEP = '\x1f';
const RECORD_SEP = '\x1e';

export async function getCommitLog(
  repoPath: string,
  opts: { refs?: string[]; limit: number; offset: number }
): Promise<CommitNode[]> {
  const args = [
    'log',
    `--skip=${opts.offset}`,
    `--max-count=${opts.limit}`,
    '--topo-order',
    `--pretty=format:%H${FIELD_SEP}%P${FIELD_SEP}%an${FIELD_SEP}%aI${FIELD_SEP}%s${FIELD_SEP}%D${FIELD_SEP}%b${RECORD_SEP}`,
  ];
  args.push(...(opts.refs && opts.refs.length > 0 ? opts.refs : ['--all']));

  const output = await runGit(repoPath, args);
  return output
    .split(RECORD_SEP)
    .map(record => record.trim())
    .filter(Boolean)
    .map(record => {
      const [sha, parents, author, date, message, refs, body] = record.split(FIELD_SEP);
      return {
        sha,
        parents: parents ? parents.split(' ').filter(Boolean) : [],
        author,
        date,
        message,
        refs: refs ? refs.split(', ').filter(Boolean) : [],
        body: body?.trim() ?? '',
      };
    });
}

export type LaneCommit = CommitNode & { lane: number };

export function assignLanes(commits: CommitNode[]): LaneCommit[] {
  const lanes: (string | null)[] = [];
  const result: LaneCommit[] = [];

  const findLaneOf = (sha: string): number => lanes.indexOf(sha);
  const findFreeLane = (): number => {
    const free = lanes.indexOf(null);
    if (free !== -1) return free;
    lanes.push(null);
    return lanes.length - 1;
  };

  for (const commit of commits) {
    let lane = findLaneOf(commit.sha);
    if (lane === -1) {
      lane = findFreeLane();
    }
    result.push({ ...commit, lane });

    const [firstParent, ...otherParents] = commit.parents;
    lanes[lane] = firstParent ?? null;

    for (const parentSha of otherParents) {
      if (findLaneOf(parentSha) === -1) {
        const freeLane = findFreeLane();
        lanes[freeLane] = parentSha;
      }
    }
  }

  return result;
}
