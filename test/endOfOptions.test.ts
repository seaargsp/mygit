import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { checkoutBranch } from '../src/git/remote';
import { mergeRef } from '../src/git/history';
import { GuardError } from '../src/git/argGuard';
import { parseGitVersion, versionAtLeast } from '../src/git/gitService';

function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygit-eoo-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-q', '--allow-empty', '-m', 'a');
  return dir;
}

describe('option-shaped arguments', () => {
  it('are rejected before git runs', async () => {
    const dir = repo();
    await expect(checkoutBranch(dir, '--detach')).rejects.toBeInstanceOf(GuardError);
    expect(execFileSync('git', ['symbolic-ref', 'HEAD'], { cwd: dir }).toString().trim()).toBe('refs/heads/main');
    await expect(mergeRef(dir, '--abort', { squash: false })).rejects.toBeInstanceOf(GuardError);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('pass ordinary names through', async () => {
    const dir = repo();
    execFileSync('git', ['branch', 'feature/ü-x'], { cwd: dir });
    await checkoutBranch(dir, 'feature/ü-x');
    expect(execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: dir }).toString().trim()).toBe('feature/ü-x');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('git version', () => {
  it('parses and compares versions', () => {
    expect(parseGitVersion('git version 2.43.0\n')).toEqual([2, 43, 0]);
    expect(parseGitVersion('git version 2.39.3 (Apple Git-145)')).toEqual([2, 39, 3]);
    expect(parseGitVersion('git version 2.45.1.windows.1')).toEqual([2, 45, 1]);
    expect(parseGitVersion('nonsense')).toBeNull();
    expect(versionAtLeast([2, 24, 0], [2, 24, 0])).toBe(true);
    expect(versionAtLeast([2, 23, 9], [2, 24, 0])).toBe(false);
    expect(versionAtLeast([3, 0, 0], [2, 24, 0])).toBe(true);
  });
});
