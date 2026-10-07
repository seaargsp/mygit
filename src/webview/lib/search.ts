import type { CommitSearchState } from '../../panel/messages';
import type { LaneCommit } from '../../git/graph';

/** Loaded commits matching `query` by message, body, SHA prefix, author name or e-mail, in graph order. */
export function loadedMatches(commitLog: LaneCommit[], query: string): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return commitLog
    .filter(commit => !commit.stash && (
      commit.message.toLowerCase().includes(needle)
      || commit.body.toLowerCase().includes(needle)
      || commit.sha.startsWith(needle)
      || commit.author.toLowerCase().includes(needle)
      || commit.authorEmail.toLowerCase().includes(needle)
    ))
    .map(commit => commit.sha);
}

export type SearchMatches = { matches: string[]; loaded: Set<string>; older: number };

/**
 * The loaded matches followed by the full-history matches below the loaded rows. The graph
 * is a prefix of the same `--date-order` walk, so unloaded matches all sort after the loaded
 * ones. History results for an earlier query are ignored.
 */
export function combineMatches(commitLog: LaneCommit[], query: string, history: CommitSearchState): SearchMatches {
  const loaded = new Set(commitLog.map(commit => commit.sha));
  const matches = loadedMatches(commitLog, query);
  if (history.query.trim() !== query.trim()) return { matches, loaded, older: 0 };
  const older = history.shas.filter(sha => !loaded.has(sha));
  return { matches: [...matches, ...older], loaded, older: older.length };
}
