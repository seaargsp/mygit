import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscodeMock from './mocks/vscode';

vi.mock('vscode', () => vscodeMock);

import { countLog, queryLog, type LogQuery } from '../src/git/log';
import { EMPTY_LOG_QUERY } from '../src/panel/messages';
import { Store } from '../src/panel/state';
import { ActivityLog } from '../src/panel/activityLog';

let dir: string;
const q = (patch: Partial<LogQuery>): LogQuery => ({ ...EMPTY_LOG_QUERY, ...patch });

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygit-log-'));
  const git = (env: Record<string, string>, ...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe', env: { ...process.env, ...env } });
  const commit = (author: string, message: string, day: string, file?: string) => {
    if (file) fs.writeFileSync(path.join(dir, file), message);
    if (file) git({}, 'add', file);
    const date = `2026-01-${day}T12:00:00Z`;
    git({ GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }, '-c', `user.name=${author}`, '-c', 'user.email=x@y', 'commit', '-q', '--allow-empty', '-m', message);
  };
  git({}, 'init', '-q', '-b', 'main');
  commit('alice', 'fix parser', '01', 'a.txt');
  commit('bob', 'fix lexer', '02');
  git({}, 'branch', 'other');
  commit('alice', 'add tests', '03', 'b.txt');
  git({}, 'checkout', '-q', 'other');
  commit('carol', 'other work', '04');
  git({}, 'checkout', '-q', 'main');
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('queryLog', () => {
  it('lists all refs newest first', async () => {
    const { rows, hasMore } = await queryLog(dir, q({}), { offset: 0, limit: 200 });
    expect(rows.map(row => row.message)).toEqual(['other work', 'add tests', 'fix lexer', 'fix parser']);
    expect(hasMore).toBe(false);
  });
  it('filters by ref, author, message, dates and path', async () => {
    const messages = async (query: LogQuery) => (await queryLog(dir, query, { offset: 0, limit: 200 })).rows.map(row => row.message);
    expect(await messages(q({ refs: ['main'] }))).toEqual(['add tests', 'fix lexer', 'fix parser']);
    expect(await messages(q({ author: 'ALICE' }))).toEqual(['add tests', 'fix parser']);
    expect(await messages(q({ author: 'alice', message: 'fix' }))).toEqual(['fix parser']);
    expect(await messages(q({ since: '2026-01-02', until: '2026-01-03' }))).toEqual(['add tests', 'fix lexer']);
    expect(await messages(q({ path: 'b.txt' }))).toEqual(['add tests']);
  });
  it('pages with hasMore', async () => {
    const first = await queryLog(dir, q({}), { offset: 0, limit: 2 });
    expect(first.rows).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    const second = await queryLog(dir, q({}), { offset: 2, limit: 2 });
    expect(second.rows.map(row => row.message)).toEqual(['fix lexer', 'fix parser']);
    expect(second.hasMore).toBe(false);
  });
  it('compares two refs with sides', async () => {
    const { rows } = await queryLog(dir, q({ compare: { left: 'main', right: 'other' } }), { offset: 0, limit: 200 });
    expect(rows.map(row => [row.message, row.side])).toEqual([['other work', 'right'], ['add tests', 'left']]);
  });
  it('counts matches', async () => {
    expect(await countLog(dir, q({}))).toBe(4);
    expect(await countLog(dir, q({ compare: { left: 'main', right: 'other' } }))).toBe(2);
  });
  it('returns nothing on an empty repository', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'mygit-log-empty-'));
    execFileSync('git', ['init', '-q'], { cwd: empty });
    expect(await queryLog(empty, q({}), { offset: 0, limit: 200 })).toEqual({ rows: [], hasMore: false });
    expect(await countLog(empty, q({}))).toBe(0);
    fs.rmSync(empty, { recursive: true, force: true });
  });
});

describe('Store.openLog', () => {
  it('opens the view, then appends the next page', async () => {
    const memento = { get: <T>(_key: string, fallback?: T) => fallback, update: vi.fn(), keys: () => [] };
    const store = new Store({ repoPath: dir, gitDir: path.join(dir, '.git'), memento: memento as never, log: new ActivityLog(), reportError: vi.fn() });
    await store.openLog(q({}));
    const view = store.getState().view;
    expect(view.kind).toBe('log');
    if (view.kind !== 'log') return;
    expect(view.rows).toHaveLength(4);
    expect(view.error).toBeNull();
  });
});
