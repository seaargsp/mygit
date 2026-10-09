import { END_OF_OPTIONS, runGit } from './gitService';
import { revParse } from './refs';

export type LogQuery = {
  /** Empty: all branches, remotes, tags and HEAD. */
  refs: string[];
  author: string;
  message: string;
  /** YYYY-MM-DD or ''. */
  since: string;
  until: string;
  path: string;
  compare: { left: string; right: string } | null;
};

export type LogRow = { sha: string; parents: string[]; refs: string[]; message: string; author: string; date: string; side?: 'left' | 'right' };

export const LOG_PAGE = 200;

const FORMAT = '%H%x1f%P%x1f%D%x1f%s%x1f%an%x1f%aI%x1f%m%x1e';

export function logArgs(query: LogQuery, mode: { count: true } | { count?: false; offset: number; limit: number }, hasHead: boolean): { args: string[]; input: string } {
  const args = mode.count
    ? ['rev-list', '--count']
    : ['log', '--no-show-signature', '--decorate=short', `--format=${FORMAT}`, `--skip=${mode.offset}`, `--max-count=${mode.limit + 1}`];
  args.push('--date-order');
  if (query.author || query.message) args.push('--regexp-ignore-case', '--fixed-strings');
  if (query.author) args.push(`--author=${query.author}`);
  if (query.message) args.push(`--grep=${query.message}`);
  if (query.since) args.push(`--since=${query.since}T00:00:00`);
  if (query.until) args.push(`--until=${query.until}T23:59:59`);
  let input = '';
  if (query.compare) {
    args.push('--left-right', END_OF_OPTIONS, `${query.compare.left}...${query.compare.right}`);
  } else if (query.refs.length > 0) {
    args.push('--stdin');
    input = `${query.refs.join('\n')}\n`;
  } else {
    args.push('--branches', '--remotes', '--tags');
    if (hasHead) {
      args.push('--stdin');
      input = 'HEAD\n';
    }
  }
  if (query.path) args.push('--', query.path);
  return { args, input };
}

export function parseLog(output: string, compare: boolean): LogRow[] {
  return output.split('\x1e').map(record => record.replace(/^\n/, '')).filter(Boolean).map(record => {
    const [sha, parents, refs, message, author, date, mark] = record.split('\x1f');
    const row: LogRow = {
      sha,
      parents: parents ? parents.split(' ').filter(Boolean) : [],
      refs: refs ? refs.split(', ').filter(ref => ref && ref !== 'refs/stash') : [],
      message,
      author,
      date,
    };
    if (compare) row.side = mark?.trim() === '<' ? 'left' : 'right';
    return row;
  });
}

export async function queryLog(repoPath: string, query: LogQuery, opts: { offset: number; limit: number; signal?: AbortSignal }): Promise<{ rows: LogRow[]; hasMore: boolean }> {
  const hasHead = Boolean(await revParse(repoPath, 'HEAD'));
  const { args, input } = logArgs(query, { offset: opts.offset, limit: opts.limit }, hasHead);
  const rows = parseLog(await runGit(repoPath, args, { input, signal: opts.signal }), Boolean(query.compare));
  return { rows: rows.slice(0, opts.limit), hasMore: rows.length > opts.limit };
}

export async function countLog(repoPath: string, query: LogQuery, signal?: AbortSignal): Promise<number> {
  const hasHead = Boolean(await revParse(repoPath, 'HEAD'));
  const { args, input } = logArgs(query, { count: true }, hasHead);
  const output = (await runGit(repoPath, args, { input, signal })).trim();
  return output.split(/\s+/).filter(Boolean).reduce((sum, part) => sum + Number(part), 0);
}
