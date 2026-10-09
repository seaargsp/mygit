import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscodeMock from './mocks/vscode';

vi.mock('vscode', () => vscodeMock);

import { Store } from '../src/panel/state';
import { ActivityLog } from '../src/panel/activityLog';

describe('Store.compareRefs', () => {
  it('lists the files changed on the right side since the merge base, and keeps them across a refresh', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygit-compare-'));
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', ...args], { cwd: dir, stdio: 'pipe' }).toString().trim();
    const write = (file: string) => { fs.writeFileSync(path.join(dir, file), file); git('add', file); git('commit', '-q', '-m', file); };
    git('init', '-q', '-b', 'main');
    write('base.txt');
    git('checkout', '-q', '-b', 'feat');
    write('f1.txt');
    write('f2.txt');
    git('checkout', '-q', 'main');
    write('m1.txt');
    const memento = { get: <T>(_key: string, fallback?: T) => fallback, update: vi.fn(), keys: () => [] };
    const store = new Store({ repoPath: dir, gitDir: path.join(dir, '.git'), memento: memento as never, log: new ActivityLog(), reportError: vi.fn() });
    await store.refreshAll();

    await store.compareRefs('main', 'feat');
    const files = () => {
      const view = store.getState().selectionView;
      return view.kind === 'range' ? view.files.map(file => file.path).sort() : view.kind;
    };
    expect(files()).toEqual(['f1.txt', 'f2.txt']);
    await store.refreshAll();
    expect(files()).toEqual(['f1.txt', 'f2.txt']);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
