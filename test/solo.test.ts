import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscodeMock from './mocks/vscode';

vi.mock('vscode', () => vscodeMock);

import { Store } from '../src/panel/state';
import { ActivityLog } from '../src/panel/activityLog';
import { handleMessage } from '../src/panel/operations';

/** main: c0 - c1 - c2 (with a stash on c2), feature: c0 - f1. */
function makeRepo(): { dir: string; sha: (rev: string) => string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygit-solo-'));
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', ...args], { cwd: dir, stdio: 'pipe' }).toString().trim();
  git('init', '-q', '-b', 'main');
  git('commit', '-q', '--allow-empty', '-m', 'c0');
  git('checkout', '-q', '-b', 'feature');
  git('commit', '-q', '--allow-empty', '-m', 'f1');
  git('checkout', '-q', 'main');
  git('commit', '-q', '--allow-empty', '-m', 'c1');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
  git('add', 'a.txt');
  git('commit', '-q', '-m', 'c2');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'b');
  git('stash', 'push', '-q', '-m', 'wip');
  return { dir, sha: rev => git('rev-parse', rev) };
}

function setup() {
  const repo = makeRepo();
  const memento = { get: <T>(_key: string, fallback?: T) => fallback, update: vi.fn(), keys: () => [] };
  const store = new Store({ repoPath: repo.dir, gitDir: path.join(repo.dir, '.git'), memento: memento as never, log: new ActivityLog(), reportError: vi.fn() });
  const host = { store, post: vi.fn(), checkConflicts: vi.fn(), clearLog: vi.fn() };
  return { ...repo, store, host };
}

const subjects = (store: Store) => store.getState().commitLog.map(commit => commit.message);

describe('refs:solo', () => {
  it('drops the commits outside the soloed references from the graph', async () => {
    const { dir, store, host } = setup();
    await store.refreshAll();
    expect(subjects(store).sort()).toEqual(['c0', 'c1', 'c2', 'f1', 'wip']);

    await handleMessage(host, { type: 'refs:solo', payload: { ids: ['refs/heads/feature'], solo: true } });
    expect(subjects(store)).toEqual(['f1', 'c0']);
    expect(store.getState().commitLog.map(commit => commit.lane)).toEqual([0, 0]);

    await handleMessage(host, { type: 'refs:solo', payload: { ids: ['refs/heads/feature'], solo: false } });
    expect(subjects(store).sort()).toEqual(['c0', 'c1', 'c2', 'f1', 'wip']);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('draws a soloed stash with the history of its base', async () => {
    const { dir, store, host, sha } = setup();
    await store.refreshAll();

    await handleMessage(host, { type: 'refs:solo', payload: { ids: [`stash:${sha('stash@{0}')}`], solo: true } });
    expect(subjects(store)).toEqual(['wip', 'c2', 'c1', 'c0']);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('keeps unsoloed stashes out of a soloed branch history', async () => {
    const { dir, store, host } = setup();
    await store.refreshAll();

    await handleMessage(host, { type: 'refs:solo', payload: { ids: ['refs/heads/main'], solo: true } });
    expect(subjects(store)).toEqual(['c2', 'c1', 'c0']);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
