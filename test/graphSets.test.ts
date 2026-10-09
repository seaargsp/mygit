import { describe, expect, it } from 'vitest';
import type { LaneCommit } from '../src/git/graph';
import { ancestorsOf, descendantsOf, traceSet } from '../src/webview/lib/graphSets';

// E merges C and D; C <- B <- A; D <- A; S is a stash row on B.
const row = (sha: string, parents: string[], stash = false) => ({ sha, parents, lane: 0, parentLanes: [], refs: [], message: sha, body: '', author: 'a', authorEmail: 'a@x', date: '', commitDate: '', ...(stash ? { stash: { ref: 'stash@{0}', index: 0 } } : {}) }) as unknown as LaneCommit;
const log = [row('E', ['C', 'D']), row('S', ['B'], true), row('C', ['B']), row('D', ['A']), row('B', ['A']), row('A', [])];

describe('graph sets', () => {
  it('collects ancestors', () => {
    expect([...ancestorsOf(log, 'C')].sort()).toEqual(['A', 'B', 'C']);
  });
  it('collects descendants without stash rows', () => {
    expect([...descendantsOf(log, 'B')].sort()).toEqual(['B', 'C', 'E']);
  });
  it('combines both directions', () => {
    expect([...traceSet(log, 'D', 'both')].sort()).toEqual(['A', 'D', 'E']);
    expect([...traceSet(log, 'D', 'ancestors')].sort()).toEqual(['A', 'D']);
    expect([...traceSet(log, 'D', 'descendants')].sort()).toEqual(['D', 'E']);
  });
});
