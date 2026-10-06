import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { assignLanes, getCommitLog, reachableFrom, type CommitNode } from '../src/git/graph';
import { buildEdges } from '../src/webview/columns/GraphRail';
import { formatDate, relativeDate, setDatePrefs } from '../src/webview/lib/format';

const node = (sha: string, parents: string[]): CommitNode => ({
  sha, parents, message: sha, author: 'a', authorEmail: 'a@x', date: '', commitDate: '', refs: [], body: '',
});

describe('buildEdges', () => {
  // M merges F into main; F forks from B.
  //   M (lane 0)
  //   | F (lane 1)
  //   B (lane 0)
  const commits = assignLanes([node('M', ['B', 'F']), node('F', ['B']), node('B', [])]);
  const edges = buildEdges(commits, 0, commits.length);
  const edge = (key: string) => edges.find(entry => entry.key === key)!;

  it('leaves a merge horizontally on the merge row and turns down with a rounded corner', () => {
    expect(edge('M-F').d).toMatch(/^M 15 14 H \d+ A 8 8 0 0 1 33 22 V 42$/);
  });

  it('runs a fork down its lane and turns into the parent on the parent row', () => {
    expect(edge('F-B').d).toMatch(/^M 33 42 V 62 A 8 8 0 0 1 25 70 H 15$/);
  });

  it('draws a same-lane parent as a straight vertical', () => {
    expect(edge('M-B').d).toBe('M 15 14 V 70');
  });

  it('carries the source commit for dimming', () => {
    expect(edge('F-B').sha).toBe('F');
  });
});

describe('reachableFrom', () => {
  it('collects the tips and their loaded ancestors only', () => {
    const commits = [node('C', ['A']), node('B', ['A']), node('A', [])];
    expect([...reachableFrom(commits, ['B'])].sort()).toEqual(['A', 'B']);
  });
});

describe('date formatting', () => {
  const now = new Date(2026, 9, 6, 12, 0, 0).getTime();
  const iso = (offsetMs: number) => new Date(now - offsetMs).toISOString();

  it('formats PHP date tokens with escapes', () => {
    expect(formatDate(new Date(2026, 0, 5, 9, 7, 3), 'Y-m-d H:i:s \\Y j/n g A')).toBe('2026-01-05 09:07:03 Y 5/1 9 AM');
  });

  it('is relative below the threshold and absolute from it on', () => {
    setDatePrefs({ dateFormat: 'Y-m-d H:i', relativeDateDays: 3, dateLocale: '' });
    expect(relativeDate(iso(30_000), now)).toBe('just now');
    expect(relativeDate(iso(5 * 3_600_000), now)).toBe('5 hours ago');
    expect(relativeDate(iso(2 * 86_400_000), now)).toBe('2 days ago');
    expect(relativeDate(iso(3 * 86_400_000), now)).toBe('2026-10-03 12:00');
  });

  it('is always absolute with a zero threshold', () => {
    setDatePrefs({ dateFormat: 'd.m.Y', relativeDateDays: 0, dateLocale: '' });
    expect(relativeDate(iso(60_000), now)).toBe('06.10.2026');
  });
});

describe('getCommitLog', () => {
  let repo: string;
  const git = (args: string[], date?: string) =>
    execFileSync('git', args, {
      cwd: repo,
      env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' },
    }).toString().trim();

  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'mygit-log-'));
    git(['init', '-q', '-b', 'main']);
    git(['commit', '-q', '--allow-empty', '-m', 'base'], '2026-10-01T10:00:00Z');
    git(['checkout', '-q', '-b', 'feature']);
    git(['commit', '-q', '--allow-empty', '-m', 'feature old'], '2026-10-02T10:00:00Z');
    git(['commit', '-q', '--allow-empty', '-m', 'feature new'], '2026-10-05T10:00:00Z');
    git(['checkout', '-q', 'main']);
    git(['commit', '-q', '--allow-empty', '-m', 'main mid'], '2026-10-03T10:00:00Z');
    git(['commit', '-q', '--allow-empty', '-m', 'main newest'], '2026-10-06T10:00:00Z');
  });

  it('orders by committer date, newest first, across branches', async () => {
    const log = await getCommitLog(repo, { revs: ['--branches', 'HEAD'], limit: null, offset: 0 });
    expect(log.map(commit => commit.message)).toEqual(['main newest', 'feature new', 'main mid', 'feature old', 'base']);
    expect(Date.parse(log[0].commitDate)).toBe(Date.parse('2026-10-06T10:00:00Z'));
  });
});
