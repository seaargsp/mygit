import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getCommitDetail } from '../src/git/commit';

describe('getCommitDetail', () => {
  it('lists a merge commit against its first parent only, each path once', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygit-detail-'));
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', ...args], { cwd: dir, stdio: 'pipe' }).toString().trim();
    const write = (file: string, content: string) => fs.writeFileSync(path.join(dir, file), content);
    git('init', '-q', '-b', 'main');
    write('feat.txt', 'base\n');
    write('main.txt', 'base\n');
    write('app.css', 'base\n');
    git('add', '.');
    git('commit', '-q', '-m', 'init');
    git('checkout', '-q', '-b', 'feat');
    write('feat.txt', 'feat\n');
    write('app.css', 'feat\n');
    git('commit', '-q', '-am', 'feat');
    git('checkout', '-q', 'main');
    write('main.txt', 'main\n');
    write('app.css', 'main\n');
    git('commit', '-q', '-am', 'main');
    try { git('merge', '-q', 'feat'); } catch { /* app.css conflicts */ }
    // Resolved and recompiled: the result matches neither side.
    write('app.css', 'recompiled\n');
    git('add', 'app.css');
    git('commit', '-q', '--no-edit');

    const detail = await getCommitDetail(dir, git('rev-parse', 'HEAD'));
    expect(detail.files.map(file => file.path).sort()).toEqual(['app.css', 'feat.txt']);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('lists a root commit against the empty tree', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygit-detail-'));
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', ...args], { cwd: dir, stdio: 'pipe' }).toString().trim();
    git('init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
    git('add', '.');
    git('commit', '-q', '-m', 'init');

    const detail = await getCommitDetail(dir, git('rev-parse', 'HEAD'));
    expect(detail.files).toEqual([{ path: 'a.txt', status: 'A' }]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
