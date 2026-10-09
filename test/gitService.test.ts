import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runGitFull, setGitBinaryPath, setGitTimeout } from '../src/git/gitService';
import { listBranches } from '../src/git/refs';

describe('runGitFull timeout', () => {
  afterEach(() => {
    setGitBinaryPath('git');
    setGitTimeout(300_000);
  });

  it('kills a process that exceeds its timeout and rejects with the limit', async () => {
    setGitBinaryPath('/bin/sh');
    const started = Date.now();
    await expect(runGitFull(os.tmpdir(), ['-c', 'sleep 5'], { timeoutMs: 100 })).rejects.toThrow(/timed out after 0 s/);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('applies the configured default and lets 0 wait', async () => {
    setGitBinaryPath('/bin/sh');
    setGitTimeout(100);
    await expect(runGitFull(os.tmpdir(), ['-c', 'sleep 5'])).rejects.toThrow(/timed out/);
    await expect(runGitFull(os.tmpdir(), ['-c', 'sleep 0.2'], { timeoutMs: 0 })).resolves.toMatchObject({ code: 0 });
  });
});

describe('listBranches', () => {
  it('leaves out upstream counts when tracking is off', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygit-refs-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
    git('init', '-q', '-b', 'main');
    git('-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-q', '--allow-empty', '-m', 'a');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    git('-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-q', '--allow-empty', '-m', 'b');
    git('remote', 'add', 'origin', 'https://example.invalid/r.git');
    git('config', 'branch.main.remote', 'origin');
    git('config', 'branch.main.merge', 'refs/heads/main');

    const tracked = await listBranches(dir);
    expect(tracked.local[0]).toMatchObject({ name: 'main', isHead: true, upstream: 'origin/main', ahead: 1, behind: 0 });
    const untracked = await listBranches(dir, { track: false });
    expect(untracked.local[0]).toMatchObject({ name: 'main', isHead: true, upstream: 'origin/main', ahead: 0, behind: 0 });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('runGitFull process handling', () => {
  afterEach(() => setGitBinaryPath('git'));

  it('passes arguments without a shell', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygit-argv-'));
    setGitBinaryPath('/bin/echo');
    const result = await runGitFull(dir, ['$(touch pwned)', ';', '|', '`id`']);
    expect(result.stdout.trim()).toBe('$(touch pwned) ; | `id`');
    expect(fs.existsSync(path.join(dir, 'pwned'))).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('stops a process whose output exceeds the cap', async () => {
    setGitBinaryPath('/bin/sh');
    await expect(runGitFull(os.tmpdir(), ['-c', 'yes'], { maxOutputBytes: 64 * 1024 })).rejects.toThrow(/output exceeded/);
  });

  it.skipIf(process.platform === 'win32')('escalates to SIGKILL when SIGTERM is ignored', async () => {
    const pidFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mygit-kill-')), 'pid');
    setGitBinaryPath('/bin/sh');
    await expect(runGitFull(os.tmpdir(), ['-c', 'echo $$ > "$0"; trap "" TERM; sleep 30', pidFile], { timeoutMs: 200 })).rejects.toThrow(/timed out/);
    const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    await new Promise(resolve => setTimeout(resolve, 3500));
    expect(() => process.kill(pid, 0)).toThrow();
  }, 10_000);
});
