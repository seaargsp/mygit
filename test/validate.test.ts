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
    [{ type: 'branch:checkout', payload: { name: '--detach' } }, 'name'],
    [{ type: 'branch:checkout', payload: {} }, 'name'],
    [{ type: 'merge:save', payload: { path: '../../etc/passwd', content: 'x' } }, 'path'],
    [{ type: 'remote:add', payload: { name: 'o', fetchUrl: 'ext::sh -c x', pushUrl: '' } }, 'fetchUrl'],
    [{ type: 'stage:paths', payload: { paths: 'a.txt' } }, 'paths'],
    [{ type: 'graph:search', payload: { query: 'x'.repeat(5000) } }, 'query'],
    [{ type: 'commit:reset', payload: { sha: 'abc1234', mode: 'nuke' } }, 'mode'],
  ])('rejects %j', (raw, at) => {
    const onReject = vi.fn();
    expect(parseWebviewMessage(raw, onReject)).toBeNull();
    if (at) expect(onReject.mock.calls[0][0]).toContain(at);
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

describe('rejection reasons', () => {
  it('name the field and the rejected value', () => {
    const onReject = vi.fn();
    parseWebviewMessage({ type: 'remote:add', payload: { name: '-origin', fetchUrl: 'https://h/r.git', pushUrl: '' } }, onReject);
    expect(onReject).toHaveBeenCalledWith('Invalid name "-origin" (expected a remote name)', 'remote:add');
  });

  it('accept a shift-selection of several thousand graph rows', () => {
    const shas = Array.from({ length: 5000 }, (_, index) => index.toString(16).padStart(7, '0'));
    expect(parseWebviewMessage({ type: 'graph:select', payload: { shas } })?.type).toBe('graph:select');
  });
});

describe('view:log path', () => {
  it('is validated without being rewritten, so the History field keeps what was typed', () => {
    const query = { refs: [], author: '', message: '', since: '', until: '', path: 'src/', compare: null };
    expect(parseWebviewMessage({ type: 'view:log', payload: { query } })).toEqual({ type: 'view:log', payload: { query } });
    expect(parseWebviewMessage({ type: 'view:log', payload: { query: { ...query, path: '../x' } } })).toBeNull();
  });
});
