import { DEFAULT_REPO_PREFS, type ClientState } from '../../panel/messages';

/** State drawn on a restored panel; repo prefs saved by an older version lack newer fields. */
export function restoreSnapshot(empty: ClientState, snapshot: Partial<ClientState> | null): ClientState {
  if (!snapshot) return empty;
  return { ...empty, ...snapshot, repoPrefs: { ...DEFAULT_REPO_PREFS, ...snapshot.repoPrefs } };
}

/** Collapsed keys from the webview state used before per-repository persistence, when the repository has none. */
export function legacyCollapsedKeys(legacy: Record<string, boolean> | null, current: string[]): string[] | null {
  if (!legacy || current.length > 0) return null;
  const keys = Object.entries(legacy).filter(([, value]) => value).map(([key]) => key);
  return keys.length > 0 ? keys : null;
}
