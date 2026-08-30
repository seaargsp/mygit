export const LANE_COUNT = 8;

export function laneColor(lane: number): string {
  return `var(--lane-${((lane % LANE_COUNT) + LANE_COUNT) % LANE_COUNT})`;
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Relative for the last week, absolute beyond it: recent work is read by age, old work by date. */
export function relativeDate(iso: string, now = Date.now()): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  const age = now - time;
  if (age < MINUTE) return 'just now';
  if (age < HOUR) return `${Math.floor(age / MINUTE)}m ago`;
  if (age < DAY) return `${Math.floor(age / HOUR)}h ago`;
  if (age < 7 * DAY) return `${Math.floor(age / DAY)}d ago`;
  const date = new Date(time);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function fullDate(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return iso;
  return new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export type ParsedRef =
  | { kind: 'head'; label: string }
  | { kind: 'local'; label: string }
  | { kind: 'remote'; label: string }
  | { kind: 'tag'; label: string };

/**
 * Decorations come from `git log %D`: "HEAD -> main, origin/main, tag: v1.2".
 * Remote-tracking refs are recognised by a leading remote name.
 */
export function parseRefs(refs: string[], remoteNames: string[]): ParsedRef[] {
  const parsed: ParsedRef[] = [];
  for (const raw of refs) {
    const ref = raw.trim();
    if (!ref) continue;
    if (ref.startsWith('tag: ')) {
      parsed.push({ kind: 'tag', label: ref.slice(5) });
    } else if (ref.startsWith('HEAD -> ')) {
      parsed.push({ kind: 'head', label: ref.slice(8) });
    } else if (ref === 'HEAD') {
      parsed.push({ kind: 'head', label: 'HEAD' });
    } else if (remoteNames.some(remote => ref.startsWith(`${remote}/`))) {
      parsed.push({ kind: 'remote', label: ref });
    } else {
      parsed.push({ kind: 'local', label: ref });
    }
  }
  const rank = { head: 0, local: 1, tag: 2, remote: 3 };
  return parsed.sort((a, b) => rank[a.kind] - rank[b.kind]);
}

export function splitPath(path: string): { dir: string; name: string } {
  const slash = path.lastIndexOf('/');
  if (slash === -1) return { dir: '', name: path };
  return { dir: path.slice(0, slash + 1), name: path.slice(slash + 1) };
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(hash) % 360} 42% 42%)`;
}
