import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscodeMock from './mocks/vscode';

vi.mock('vscode', () => vscodeMock);

import { redactText, redactUrl } from '../src/git/redact';
import { Store } from '../src/panel/state';
import { ActivityLog } from '../src/panel/activityLog';
import { handleMessage } from '../src/panel/operations';

describe('redactUrl', () => {
  it.each([
    ['https://user:tok@example.com/r.git', 'https://example.com/r.git'],
    ['https://ghp_abc@example.com/r.git', 'https://example.com/r.git'],
    ['http://example.com/r.git?token=x&ref=main&Access_Token=y', 'http://example.com/r.git?ref=main'],
    ['https://example.com/r.git?private_token=x#frag', 'https://example.com/r.git#frag'],
    ['ssh://git@example.com/r.git', 'ssh://git@example.com/r.git'],
    ['git@example.com:o/r.git', 'git@example.com:o/r.git'],
    ['/srv/r.git', '/srv/r.git'],
  ])('%s', (input, output) => expect(redactUrl(input)).toBe(output));
});

describe('redactText', () => {
  it('redacts every URL in a message', () => {
    expect(redactText("fatal: unable to access 'https://u:p@h/r.git/': 403 and https://t@h2/x"))
      .toBe("fatal: unable to access 'https://h/r.git/': 403 and https://h2/x");
  });
});

describe('remotes in state', () => {
  it('reach the webview redacted and keep the stored URL on edit', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygit-redact-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' }).toString().trim();
    git('init', '-q', '-b', 'main');
    git('-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-q', '--allow-empty', '-m', 'a');
    git('remote', 'add', 'origin', 'https://user:tok@example.invalid/r.git');
    const memento = { get: <T>(_key: string, fallback?: T) => fallback, update: vi.fn(), keys: () => [] };
    const log = new ActivityLog();
    const store = new Store({ repoPath: dir, gitDir: path.join(dir, '.git'), memento: memento as never, log, reportError: vi.fn() });
    await store.refreshAll();
    expect(store.getState().remotes[0]).toMatchObject({ name: 'origin', fetchUrl: 'https://example.invalid/r.git', redacted: true });

    const host = { store, post: vi.fn(), checkConflicts: vi.fn(), clearLog: vi.fn() };
    await handleMessage(host, { type: 'remote:edit', payload: { name: 'origin', next: { name: 'origin', fetchUrl: 'https://example.invalid/r.git', pushUrl: '' } } });
    expect(git('remote', 'get-url', 'origin')).toBe('https://user:tok@example.invalid/r.git');

    log.repository('git remote add origin https://user:tok@example.invalid/r.git');
    expect(log.repo[log.repo.length - 1]?.text).toBe('git remote add origin https://example.invalid/r.git');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('remote:add fetch failure', () => {
  it('shows the warning without credentials', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygit-redact-add-'));
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
    const memento = { get: <T>(_key: string, fallback?: T) => fallback, update: vi.fn(), keys: () => [] };
    const store = new Store({ repoPath: dir, gitDir: path.join(dir, '.git'), memento: memento as never, log: new ActivityLog(), reportError: vi.fn() });
    const host = { store, post: vi.fn(), checkConflicts: vi.fn(), clearLog: vi.fn() };
    vscodeMock.window.showWarningMessage.mockClear();
    await handleMessage(host, { type: 'remote:add', payload: { name: 'up', fetchUrl: 'https://user:SECRET1@127.0.0.1:9/x.git?token=SECRET2', pushUrl: '' } });
    const shown = vscodeMock.window.showWarningMessage.mock.calls.map(call => String(call[0])).join('\n');
    expect(shown).toContain('fetching it failed');
    expect(shown).not.toMatch(/SECRET/);
    fs.rmSync(dir, { recursive: true, force: true });
  }, 20_000);
});
