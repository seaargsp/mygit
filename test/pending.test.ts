import { describe, expect, it } from 'vitest';
import { pendingOf } from '../src/panel/messages';

describe('pendingOf', () => {
  it('maps fetch of one remote to that remote and fetch all to every remote', () => {
    expect(pendingOf({ type: 'remote:fetch', payload: { remote: 'origin' } }, 'main', ['origin', 'up'])).toEqual({ op: 'remote:fetch', refs: ['remote:origin'] });
    expect(pendingOf({ type: 'remote:fetch', payload: {} }, 'main', ['origin', 'up'])).toEqual({ op: 'remote:fetch', refs: ['remote:origin', 'remote:up'] });
  });

  it('resolves head-relative ops to the checked-out branch', () => {
    expect(pendingOf({ type: 'remote:push', payload: { force: false } }, 'main', [])?.refs).toEqual(['local:main']);
    expect(pendingOf({ type: 'remote:pull', payload: { mode: 'ff' } }, 'main', [])?.refs).toEqual(['local:main']);
    expect(pendingOf({ type: 'remote:pull', payload: { mode: 'ff' } }, null, [])?.refs).toEqual([]);
  });

  it('names both sides of a push to a remote branch', () => {
    const message = { type: 'branch:pushTo', payload: { branch: 'feat', remote: 'origin', remoteBranch: 'feat', setUpstream: true } } as const;
    expect(pendingOf(message, 'main', [])?.refs).toEqual(['local:feat', 'remote:origin/feat']);
  });

  it('skips instantaneous ops', () => {
    expect(pendingOf({ type: 'graph:select', payload: { shas: [] } }, 'main', [])).toBeNull();
    expect(pendingOf({ type: 'stage:all', payload: {} }, 'main', [])).toBeNull();
  });
});
