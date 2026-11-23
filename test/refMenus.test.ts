import { describe, expect, it } from 'vitest';
import type { MenuItem } from '../src/webview/components/ContextMenu';
import type { Ctx } from '../src/webview/lib/ui';
import type { ClientState } from '../src/panel/messages';
import type { TagRef } from '../src/git/refs';
import { remoteBranchMenu, tagMenu } from '../src/webview/lib/actions';

const HEAD = 'a'.repeat(40);
const PARENT = 'b'.repeat(40);

/** B was merged locally (HEAD) and not pushed: origin/B and tag v1 point at HEAD's parent. */
function ctx(): Ctx {
  const state = {
    head: { sha: HEAD, branch: 'B', upstream: 'origin/B', pushed: false },
    commitLog: [
      { sha: HEAD, parents: [PARENT, 'c'.repeat(40)], refs: ['HEAD', 'B'] },
      { sha: PARENT, parents: [], refs: ['origin/B', 'tag: v1'] },
    ],
    selection: [],
    branches: { local: [{ name: 'B', sha: HEAD, isHead: true }], remote: [{ remoteName: 'origin', branches: [{ name: 'B', sha: PARENT }] }] },
    tags: [{ name: 'v1', sha: PARENT, annotated: false }],
    remotes: [{ name: 'origin' }],
    repoPrefs: { hidden: [], solo: [], pinned: [] },
  } as unknown as ClientState;
  return { state, dispatch: () => undefined, ui: {} as Ctx['ui'] };
}

function resetSubmenu(items: MenuItem[]): Extract<MenuItem, { kind: 'submenu' }> | undefined {
  return items.find((entry): entry is Extract<MenuItem, { kind: 'submenu' }> => entry.kind === 'submenu' && entry.label === 'Reset B to this commit');
}

describe('reset from ref pill menus', () => {
  it('remote branch menu offers soft, mixed and hard reset of the checked-out branch', () => {
    const sub = resetSubmenu(remoteBranchMenu(ctx(), 'origin', 'B'));
    expect(sub?.items.map(entry => (entry.kind === 'item' ? entry.label.split(':')[0] : ''))).toEqual(['Soft', 'Mixed', 'Hard']);
  });

  it('tag menu offers reset of the checked-out branch', () => {
    const tag = ctx().state.tags[0] as TagRef;
    expect(resetSubmenu(tagMenu(ctx(), tag))).toBeDefined();
  });

  it('reset sends the pill commit', () => {
    const sent: unknown[] = [];
    const context = { ...ctx(), dispatch: (message: unknown) => sent.push(message) } as Ctx;
    const soft = resetSubmenu(remoteBranchMenu(context, 'origin', 'B'))!.items[0];
    if (soft.kind === 'item') soft.onSelect();
    expect(sent).toEqual([{ type: 'commit:reset', payload: { sha: PARENT, mode: 'soft' } }]);
  });
});
