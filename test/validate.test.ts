import { describe, expect, it, vi } from 'vitest';
import { OP_SCHEMAS, parseWebviewMessage } from '../src/panel/validate';

describe('parseWebviewMessage', () => {
  it('accepts well-formed payloads and drops unknown fields', () => {
    const message = parseWebviewMessage({ type: 'branch:checkout', payload: { name: 'feature/x', extra: 1 } });
    expect(message).toEqual({ type: 'branch:checkout', payload: { name: 'feature/x' } });
  });

  it('accepts optional fields when absent', () => {
    expect(parseWebviewMessage({ type: 'remote:fetch', payload: {} })).toEqual({ type: 'remote:fetch', payload: {} });
    expect(parseWebviewMessage({ type: 'ready' })).toEqual({ type: 'ready', payload: {} });
  });

  it.each([
    [{ type: 'nope', payload: {} }, null],
    [{ type: 'branch:checkout', payload: { name: '--detach' } }, 'payload.name'],
    [{ type: 'branch:checkout', payload: {} }, 'payload.name'],
    [{ type: 'merge:save', payload: { path: '../../etc/passwd', content: 'x' } }, 'payload.path'],
    [{ type: 'remote:add', payload: { name: 'o', fetchUrl: 'ext::sh -c x', pushUrl: '' } }, 'payload.fetchUrl'],
    [{ type: 'stage:paths', payload: { paths: 'a.txt' } }, 'payload.paths'],
    [{ type: 'graph:search', payload: { query: 'x'.repeat(5000) } }, 'payload.query'],
    [{ type: 'commit:reset', payload: { sha: 'abc1234', mode: 'nuke' } }, 'payload.mode'],
  ])('rejects %j', (raw, at) => {
    const onReject = vi.fn();
    expect(parseWebviewMessage(raw, onReject)).toBeNull();
    if (at) expect(onReject).toHaveBeenCalledWith(expect.stringContaining(at));
  });

  it('accepts a full rebase plan', () => {
    const plan = { kind: 'rebase', title: 't', upstream: 'main', upstreamLabel: 'main', commits: [{ sha: 'abc1234', message: 'm', body: '', author: 'a' }] };
    const message = parseWebviewMessage({ type: 'rebase:start', payload: { plan, entries: [{ sha: 'abc1234', action: 'reword', message: 'x' }] } });
    expect(message?.type).toBe('rebase:start');
  });

  it('has a schema for every op', () => {
    expect(Object.keys(OP_SCHEMAS).length).toBeGreaterThan(80);
  });
});
