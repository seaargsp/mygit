import { describe, expect, it } from 'vitest';
import { legacyCollapsedKeys, restoreSnapshot } from '../src/webview/lib/snapshot';
import { DEFAULT_REPO_PREFS, type ClientState } from '../src/panel/messages';

const empty = { repoName: '', repoPrefs: DEFAULT_REPO_PREFS } as unknown as ClientState;

describe('restoreSnapshot', () => {
  it('fills repo prefs a pre-upgrade snapshot lacks', () => {
    const { collapsed: _collapsed, ...old } = DEFAULT_REPO_PREFS;
    const state = restoreSnapshot(empty, { repoName: 'r', repoPrefs: { ...old, hidden: ['refs/heads/x'] } as never });
    expect(state.repoName).toBe('r');
    expect(state.repoPrefs.collapsed).toEqual([]);
    expect(state.repoPrefs.hidden).toEqual(['refs/heads/x']);
  });
  it('returns the empty state without a snapshot', () => {
    expect(restoreSnapshot(empty, null)).toBe(empty);
  });
});

describe('legacyCollapsedKeys', () => {
  it('migrates collapsed keys when the repository has none yet', () => {
    expect(legacyCollapsedKeys({ local: true, tags: false, 'local/feature': true }, [])).toEqual(['local', 'local/feature']);
  });
  it('keeps existing repository state and ignores empty legacy state', () => {
    expect(legacyCollapsedKeys({ local: true }, ['remote'])).toBeNull();
    expect(legacyCollapsedKeys({ tags: false }, [])).toBeNull();
    expect(legacyCollapsedKeys(null, [])).toBeNull();
  });
});
