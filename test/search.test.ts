import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscodeMock from './mocks/vscode';

vi.mock('vscode', () => vscodeMock);

import { countNewerCommits, getCommitLog, searchCommits } from '../src/git/graph';
import { combineMatches } from '../src/webview/lib/search';
import { Store } from '../src/panel/state';
import { ActivityLog } from '../src/panel/activityLog';

const T0 = 1_700_000_000;

/**
 * Linear history on main, oldest first, one second apart; `special` maps a commit index to
 * its author and message. Built with fast-import: hundreds of `git commit` calls are slow.
 */
function makeHistory(count: number, special: Record<number, { name: string; email: string; message: string }>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygit-search-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  let stream = '';
  for (let i = 0; i < count; i += 1) {
    const { name, email, message } = special[i] ?? { name: 'Tester', email: 't@x', message: `commit ${i}` };
    const when = `${T0 + i} +0000`;
    const data = Buffer.byteLength(message);
    stream += `commit refs/heads/main\nmark :${i + 1}\nauthor ${name} <${email}> ${when}\ncommitter ${name} <${email}> ${when}\ndata ${data}\n${message}\n`;
    if (i > 0) stream += `from :${i}\n`;
    stream += '\n';
  }
  execFileSync('git', ['fast-import', '--quiet'], { cwd: dir, input: stream });
  return dir;
}

const shaAt = (repo: string, index: number, count: number) =>
  execFileSync('git', ['rev-parse', `main~${count - 1 - index}`], { cwd: repo }).toString().trim();

describe('searchCommits', () => {
  const COUNT = 50;
  let repo: string;
  beforeAll(() => {
    repo = makeHistory(COUNT, {
      3: { name: 'Alice', email: 'alice@example.org', message: 'Fix the Parser' },
      10: { name: 'Bob', email: 'bob@example.org', message: 'docs' },
      20: { name: 'Carol', email: 'parser@example.org', message: 'release' },
      30: { name: 'Bob', email: 'bob@example.org', message: 'parser: speed up' },
    });
  });
  afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

  it('matches message and author case-insensitively, newest first', async () => {
    const result = await searchCommits(repo, { revs: ['--branches'], query: 'PARSER', limit: 100 });
    expect(result).toEqual({ shas: [shaAt(repo, 30, COUNT), shaAt(repo, 20, COUNT), shaAt(repo, 3, COUNT)], truncated: false });
  });

  it('matches an author name', async () => {
    const result = await searchCommits(repo, { revs: ['--branches'], query: 'bob', limit: 100 });
    expect(result.shas).toEqual([shaAt(repo, 30, COUNT), shaAt(repo, 10, COUNT)]);
  });

  it('matches a SHA prefix and treats the query as a literal', async () => {
    const sha = shaAt(repo, 7, COUNT);
    expect((await searchCommits(repo, { revs: ['--branches'], query: sha.slice(0, 10), limit: 100 })).shas).toEqual([sha]);
    expect((await searchCommits(repo, { revs: ['--branches'], query: 'p.rser', limit: 100 })).shas).toEqual([]);
  });

  it('reports truncation at the limit', async () => {
    const result = await searchCommits(repo, { revs: ['--branches'], query: 'commit', limit: 5 });
    expect(result.shas).toHaveLength(5);
    expect(result.truncated).toBe(true);
  });

  it('rejects once aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(searchCommits(repo, { revs: ['--branches'], query: 'parser', limit: 100, signal: controller.signal })).rejects.toThrow(/aborted/);
  });

  it('counts the commits dated at or after a commit', async () => {
    expect(await countNewerCommits(repo, ['--branches'], shaAt(repo, 10, COUNT))).toBe(COUNT - 10);
  });
});

describe('combineMatches', () => {
  const commit = (sha: string, message: string) => ({
    sha, parents: [], message, author: 'a', authorEmail: 'a@x', date: '', commitDate: '', refs: [], body: '', lane: 0,
  }) as never;

  it('appends unloaded history matches after the loaded ones', () => {
    const log = [commit('aaa', 'parser one'), commit('bbb', 'other')];
    const result = combineMatches(log, 'parser', { query: 'parser', shas: ['aaa', 'ccc', 'ddd'], searching: false, truncated: false });
    expect(result.matches).toEqual(['aaa', 'ccc', 'ddd']);
    expect(result.older).toBe(2);
  });

  it('ignores results of an earlier query', () => {
    const result = combineMatches([commit('aaa', 'parser')], 'parse', { query: 'pars', shas: ['ccc'], searching: false, truncated: false });
    expect(result.matches).toEqual(['aaa']);
    expect(result.older).toBe(0);
  });
});

describe('Store full-history search', () => {
  // Above the 500-commit minimum of mygit.initialCommits, so the first page leaves history unloaded.
  const COUNT = 2600;
  let repo: string;
  beforeAll(() => {
    repo = makeHistory(COUNT, { 300: { name: 'Dana', email: 'd@x', message: 'ancient needle' } });
  });
  afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

  function makeStore(): Store {
    const memento = { get: <T>(_key: string, fallback?: T) => fallback, update: vi.fn(), keys: () => [] };
    return new Store({ repoPath: repo, gitDir: path.join(repo, '.git'), memento: memento as never, log: new ActivityLog(), reportError: vi.fn() });
  }

  it('finds a commit below the loaded rows and loads the graph down to it', async () => {
    const store = makeStore();
    await store.refreshAll();
    const target = shaAt(repo, 300, COUNT);
    expect(store.getState().commitLog).toHaveLength(2000);
    expect(store.getState().commitLog.some(commit => commit.sha === target)).toBe(false);

    await store.search('needle');
    expect(store.getState().commitSearch).toEqual({ query: 'needle', shas: [target], searching: false, truncated: false });

    await store.revealCommit(target);
    const log = store.getState().commitLog;
    expect(log.some(commit => commit.sha === target)).toBe(true);
    expect(log).toHaveLength(COUNT - 300 + 200);
    expect(store.getState().selection).toEqual([target]);
    const full = await getCommitLog(repo, { revs: ['--branches'], limit: null, offset: 0 });
    expect(log.map(commit => commit.sha)).toEqual(full.slice(0, log.length).map(commit => commit.sha));
  });

  it('runs no git search once the whole history is loaded', async () => {
    const store = makeStore();
    await store.refreshAll();
    await store.loadAll();
    await store.search('needle');
    expect(store.getState().commitSearch).toEqual({ query: 'needle', shas: [], searching: false, truncated: false });
  });
});
