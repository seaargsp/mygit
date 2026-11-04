import { describe, expect, it } from 'vitest';
import { defaultTarget, markScope, shortBranchName, statusLine } from '../src/webview/components/MergeFinder';

const state = (targetBranch: string | null, local: string[], remote: { remoteName: string; branches: string[] }[] = []) => ({
  targetBranch,
  branches: {
    local: local.map(name => ({ name })),
    remote: remote.map(group => ({ remoteName: group.remoteName, branches: group.branches.map(name => ({ name })) })),
  },
}) as never;

describe('merge finder helpers', () => {
  it('picks the target branch, then main or master', () => {
    expect(defaultTarget(state('develop', ['develop', 'feat']), 'feat')).toBe('develop');
    expect(defaultTarget(state('feat', ['feat', 'main']), 'feat')).toBe('main');
    expect(defaultTarget(state(null, ['master', 'x']), 'x')).toBe('master');
    expect(defaultTarget(state(null, ['x'], [{ remoteName: 'origin', branches: ['main'] }]), 'x')).toBe('origin/main');
    expect(defaultTarget(state(null, ['x']), 'x')).toBe('');
  });

  it('strips the remote from a branch name', () => {
    expect(shortBranchName('origin/feature/x', ['origin'])).toBe('feature/x');
    expect(shortBranchName('feature/x', ['origin'])).toBe('feature/x');
  });

  it('scopes the marks to the merges and the commits they brought in', () => {
    const entry = (sha: string, commits: string[]) => ({ sha, date: '', author: '', subject: '', kind: 'direct' as const, via: null, count: commits.length, commits });
    expect([...markScope([entry('m2', ['c']), entry('m1', ['a', 'b'])])].sort()).toEqual(['a', 'b', 'c', 'm1', 'm2']);
  });

  it('describes the result', () => {
    expect(statusLine('feat', 'main', { results: [], unmerged: 0, truncated: false })).toBe('feat is fully merged into main.');
    expect(statusLine('feat', 'main', { results: [], unmerged: 2, truncated: false })).toBe('feat has 2 commits not yet in main.');
    const ff = { sha: 'a', date: '', author: '', subject: '', kind: 'fast-forward' as const, via: null, count: null, commits: [] };
    expect(statusLine('feat', 'main', { results: [ff], unmerged: 0, truncated: false })).toMatch(/first-parent line/);
  });
});
