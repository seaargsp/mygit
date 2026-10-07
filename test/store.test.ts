import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscodeMock from './mocks/vscode';

vi.mock('vscode', () => vscodeMock);

import { Store } from '../src/panel/state';
import { ActivityLog } from '../src/panel/activityLog';
import type { ClientState } from '../src/panel/messages';

function makeRepo(commits: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygit-store-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  for (let i = 0; i < commits; i += 1) git('-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-q', '--allow-empty', '-m', `c${i}`);
  git('branch', 'feature');
  fs.writeFileSync(path.join(dir, 'new.txt'), 'x');
  return dir;
}

function makeStore(repoPath: string): Store {
  const memento = { get: <T>(_key: string, fallback?: T) => fallback, update: vi.fn(), keys: () => [] };
  return new Store({ repoPath, gitDir: path.join(repoPath, '.git'), memento: memento as never, log: new ActivityLog(), reportError: vi.fn() });
}

describe('Store.refreshAll', () => {
  it('publishes references before finishing and clears every loading flag', async () => {
    const repo = makeRepo(3);
    const store = makeStore(repo);
    const patches: Partial<ClientState>[] = [];
    store.subscribe(patch => patches.push(patch));

    expect(store.getState().loading).toEqual({ refs: true, status: true, graph: true });
    expect(store.loadedState()).not.toHaveProperty('branches');
    await store.refreshAll();

    const state = store.getState();
    expect(state.loading).toEqual({ refs: false, status: false, graph: false });
    expect(state.branches.local.map(branch => branch.name).sort()).toEqual(['feature', 'main']);
    expect(state.head).toMatchObject({ branch: 'main', message: 'c2' });
    expect(state.workingTreeStatus.unstaged.map(file => file.path)).toEqual(['new.txt']);
    expect(state.commitLog).toHaveLength(3);
    expect(store.loadedState()).toHaveProperty('branches');

    const refsAt = patches.findIndex(patch => patch.branches !== undefined);
    const lastAt = patches.findIndex(patch => patch.loading && !patch.loading.refs && !patch.loading.status && !patch.loading.graph);
    expect(refsAt).toBeGreaterThanOrEqual(0);
    expect(refsAt).toBeLessThan(patches.length - 1);
    expect(lastAt).toBeGreaterThan(refsAt);
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('draws a short first page before the full one on the initial load', async () => {
    const repo = makeRepo(230);
    const store = makeStore(repo);
    const sizes: number[] = [];
    store.subscribe(patch => patch.commitLog && sizes.push(patch.commitLog.length));
    await store.refreshAll();
    expect(sizes[0]).toBe(200);
    expect(sizes[sizes.length - 1]).toBe(230);
    fs.rmSync(repo, { recursive: true, force: true });
  }, 30_000);
});
