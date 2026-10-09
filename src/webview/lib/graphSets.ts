import type { LaneCommit } from '../../git/graph';

export type TraceMode = 'ancestors' | 'descendants' | 'both';
export type TraceState = { origin: string; mode: TraceMode };

const ancestorCache = new WeakMap<LaneCommit[], Map<string, Set<string>>>();
const descendantCache = new WeakMap<LaneCommit[], Map<string, Set<string>>>();
const childrenCache = new WeakMap<LaneCommit[], Map<string, string[]>>();

function cached(cache: WeakMap<LaneCommit[], Map<string, Set<string>>>, commitLog: LaneCommit[], sha: string, compute: () => Set<string>): Set<string> {
  let perLog = cache.get(commitLog);
  if (!perLog) {
    perLog = new Map();
    cache.set(commitLog, perLog);
  }
  let result = perLog.get(sha);
  if (!result) {
    result = compute();
    perLog.set(sha, result);
  }
  return result;
}

/** Commits reachable from `sha` within the loaded graph (sha included). */
export function ancestorsOf(commitLog: LaneCommit[], sha: string | null): Set<string> {
  if (!sha) return new Set();
  return cached(ancestorCache, commitLog, sha, () => {
    const bySha = new Map(commitLog.map(commit => [commit.sha, commit]));
    const result = new Set<string>();
    const stack = [sha];
    while (stack.length > 0) {
      const next = stack.pop()!;
      if (result.has(next)) continue;
      result.add(next);
      const commit = bySha.get(next);
      if (commit && !commit.stash) stack.push(...commit.parents);
    }
    return result;
  });
}

function childrenOf(commitLog: LaneCommit[]): Map<string, string[]> {
  let children = childrenCache.get(commitLog);
  if (!children) {
    children = new Map();
    for (const commit of commitLog) {
      if (commit.stash) continue;
      for (const parent of commit.parents) {
        const list = children.get(parent);
        if (list) list.push(commit.sha);
        else children.set(parent, [commit.sha]);
      }
    }
    childrenCache.set(commitLog, children);
  }
  return children;
}

/** Loaded commits that have `sha` as an ancestor (sha included). */
export function descendantsOf(commitLog: LaneCommit[], sha: string | null): Set<string> {
  if (!sha) return new Set();
  return cached(descendantCache, commitLog, sha, () => {
    const children = childrenOf(commitLog);
    const result = new Set<string>();
    const stack = [sha];
    while (stack.length > 0) {
      const next = stack.pop()!;
      if (result.has(next)) continue;
      result.add(next);
      stack.push(...(children.get(next) ?? []));
    }
    return result;
  });
}

export function traceSet(commitLog: LaneCommit[], sha: string, mode: TraceMode): Set<string> {
  if (mode === 'ancestors') return ancestorsOf(commitLog, sha);
  if (mode === 'descendants') return descendantsOf(commitLog, sha);
  return new Set([...ancestorsOf(commitLog, sha), ...descendantsOf(commitLog, sha)]);
}
