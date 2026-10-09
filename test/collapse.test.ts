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
import { DEFAULT_REPO_PREFS } from '../src/panel/messages';

describe('prefs:collapsed', () => {
  it('stores the collapsed keys in the repository prefs', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygit-collapse-'));
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
    const update = vi.fn();
    const memento = { get: <T>(_key: string, fallback?: T) => fallback, update, keys: () => [] };
    const store = new Store({ repoPath: dir, gitDir: path.join(dir, '.git'), memento: memento as never, log: new ActivityLog(), reportError: vi.fn() });
    const host = { store, post: vi.fn(), checkConflicts: vi.fn(), clearLog: vi.fn() };

    expect(DEFAULT_REPO_PREFS.collapsed).toEqual([]);
    await handleMessage(host, { type: 'prefs:collapsed', payload: { collapsed: ['local', 'local/feature'] } });

    expect(store.getState().repoPrefs.collapsed).toEqual(['local', 'local/feature']);
    expect(update).toHaveBeenCalledWith('mygit.repoPrefs', expect.objectContaining({ collapsed: ['local', 'local/feature'] }));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
