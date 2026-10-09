import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { isInside, writeRegularFile } from '../src/git/safeWrite';
import { ignoreFile } from '../src/git/status';
import { saveCommitTemplate } from '../src/git/commit';

describe.skipIf(process.platform === 'win32')('writeRegularFile', () => {
  it('creates, updates and refuses symlinks', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygit-write-'));
    const file = path.join(dir, 'a.txt');
    await writeRegularFile(file, 'one');
    await writeRegularFile(file, 'two');
    expect(fs.readFileSync(file, 'utf8')).toBe('two');
    const outside = path.join(dir, 'outside.txt');
    fs.writeFileSync(outside, 'keep');
    const link = path.join(dir, 'link.txt');
    fs.symlinkSync(outside, link);
    await expect(writeRegularFile(link, 'x')).rejects.toThrow(/symbolic link/);
    expect(fs.readFileSync(outside, 'utf8')).toBe('keep');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('refuses a .gitignore that is a symlink', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygit-ignore-'));
    execFileSync('git', ['init', '-q'], { cwd: dir });
    const target = path.join(os.tmpdir(), `mygit-target-${process.pid}`);
    fs.writeFileSync(target, 'keep\n');
    fs.symlinkSync(target, path.join(dir, '.gitignore'));
    await expect(ignoreFile(dir, 'x.log', 'file', false)).rejects.toThrow(/symbolic link/);
    expect(fs.readFileSync(target, 'utf8')).toBe('keep\n');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(target, { force: true });
  });

  it('refuses a local commit.template outside the repository', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygit-tpl-'));
    execFileSync('git', ['init', '-q'], { cwd: dir });
    const outside = path.join(os.tmpdir(), `mygit-tpl-out-${process.pid}.txt`);
    fs.writeFileSync(outside, 'keep');
    execFileSync('git', ['config', '--local', 'commit.template', outside], { cwd: dir });
    await expect(saveCommitTemplate(dir, path.join(dir, '.git'), 'S', 'D')).rejects.toThrow(/outside the repository/);
    expect(fs.readFileSync(outside, 'utf8')).toBe('keep');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { force: true });
  });
});

describe('isInside', () => {
  it('compares resolved paths', () => {
    expect(isInside('/r/a/b', '/r')).toBe(true);
    expect(isInside('/r', '/r')).toBe(true);
    expect(isInside('/rx/a', '/r')).toBe(false);
    expect(isInside('/r/../x', '/r')).toBe(false);
  });
});
