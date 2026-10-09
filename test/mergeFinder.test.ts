import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { findMerges, viaFromSubject } from '../src/git/mergeFinder';

let dir: string;
const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', ...args], { cwd: dir, stdio: 'pipe' }).toString().trim();
const commit = (message: string) => git('commit', '-q', '--allow-empty', '-m', message);
const sha = (rev: string) => git('rev-parse', rev);

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygit-merges-'));
  git('init', '-q', '-b', 'main');
  commit('c1');
  // feat: merged twice
  git('checkout', '-q', '-b', 'feat');
  commit('f1');
  commit('f2');
  git('checkout', '-q', 'main');
  commit('c2');
  git('merge', '--no-ff', '-q', '-m', "Merge branch 'feat'", 'feat');
  git('checkout', '-q', 'feat');
  commit('f3');
  git('checkout', '-q', 'main');
  git('merge', '--no-ff', '-q', '-m', "Merge branch 'feat' again", 'feat');
  // feat2: merged into release, release merged into main
  git('checkout', '-q', '-b', 'feat2');
  commit('g1');
  git('checkout', '-q', 'main');
  git('checkout', '-q', '-b', 'release');
  commit('r1');
  git('merge', '--no-ff', '-q', '-m', "Merge branch 'feat2' into release", 'feat2');
  git('checkout', '-q', 'main');
  git('merge', '--no-ff', '-q', '-m', "Merge branch 'release'", 'release');
  // feat3: fast-forwarded
  git('checkout', '-q', '-b', 'feat3');
  commit('h1');
  git('checkout', '-q', 'main');
  git('merge', '--ff-only', '-q', 'feat3');
  commit('c3');
  // feat4: never merged; feat5: squash-merged
  git('checkout', '-q', '-b', 'feat4');
  commit('k1');
  git('checkout', '-q', 'main');
  git('checkout', '-q', '-b', 'feat5');
  fs.writeFileSync(path.join(dir, 's.txt'), 's');
  git('add', 's.txt');
  git('commit', '-q', '-m', 's1');
  git('checkout', '-q', 'main');
  git('merge', '--squash', '-q', 'feat5');
  git('commit', '-q', '-m', 'Squashed feat5');
  git('update-ref', 'refs/remotes/origin/feat', sha('feat'));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('findMerges', () => {
  it('lists every merge of a long-lived branch, newest first', async () => {
    const { results, unmerged, truncated } = await findMerges(dir, 'feat', 'main');
    expect(results.map(entry => [entry.subject, entry.kind, entry.count])).toEqual([
      ["Merge branch 'feat' again", 'direct', 1],
      ["Merge branch 'feat'", 'direct', 2],
    ]);
    expect(unmerged).toBe(0);
    expect(truncated).toBe(false);
  });

  it('accepts a remote-tracking source', async () => {
    expect((await findMerges(dir, 'origin/feat', 'main')).results).toHaveLength(2);
  });

  it('reports a merge through another branch as indirect', async () => {
    const { results } = await findMerges(dir, 'feat2', 'main');
    expect(results).toEqual([expect.objectContaining({ subject: "Merge branch 'release'", kind: 'indirect', via: 'release', count: 1 })]);
  });

  it('reports a fast-forward', async () => {
    const { results } = await findMerges(dir, 'feat3', 'main');
    expect(results).toEqual([expect.objectContaining({ sha: sha('feat3'), kind: 'fast-forward', count: null })]);
  });

  it('reports unmerged and squash-merged branches without results', async () => {
    expect(await findMerges(dir, 'feat4', 'main')).toEqual({ results: [], unmerged: 1, truncated: false });
    expect(await findMerges(dir, 'feat5', 'main')).toEqual({ results: [], unmerged: 1, truncated: false });
  });
});

describe('viaFromSubject', () => {
  it.each([
    ["Merge branch 'release/2.1'", 'release/2.1'],
    ["Merge branch 'x' into main", 'x'],
    ["Merge remote-tracking branch 'origin/dev'", 'origin/dev'],
    ['Merge pull request #12 from someone/feature/y', 'feature/y'],
    ['Something else', null],
  ])('%s', (subject, via) => expect(viaFromSubject(subject)).toBe(via));
});
