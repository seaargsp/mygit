import type { Prefs } from '../../panel/messages';

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

let datePrefs: Pick<Prefs, 'dateFormat' | 'relativeDateDays' | 'dateLocale'> = { dateFormat: 'Y-m-d H:i', relativeDateDays: 3, dateLocale: '' };

/** Date format, relative threshold and locale preferences, set by the shell from the extension settings. */
export function setDatePrefs(prefs: Pick<Prefs, 'dateFormat' | 'relativeDateDays' | 'dateLocale'>): void {
  datePrefs = prefs;
}

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * Formats a date in local time with PHP `date()` tokens (Y y m n M F d j D l H G h g i s A a);
 * a backslash emits the next character literally, any other character is copied.
 */
export function formatDate(date: Date, pattern: string, locale?: string): string {
  const name = (options: Intl.DateTimeFormatOptions) => date.toLocaleString(locale || undefined, options);
  const hours12 = date.getHours() % 12 || 12;
  const tokens: Record<string, () => string> = {
    Y: () => String(date.getFullYear()),
    y: () => pad(date.getFullYear() % 100),
    m: () => pad(date.getMonth() + 1),
    n: () => String(date.getMonth() + 1),
    M: () => name({ month: 'short' }),
    F: () => name({ month: 'long' }),
    d: () => pad(date.getDate()),
    j: () => String(date.getDate()),
    D: () => name({ weekday: 'short' }),
    l: () => name({ weekday: 'long' }),
    H: () => pad(date.getHours()),
    G: () => String(date.getHours()),
    h: () => pad(hours12),
    g: () => String(hours12),
    i: () => pad(date.getMinutes()),
    s: () => pad(date.getSeconds()),
    A: () => (date.getHours() < 12 ? 'AM' : 'PM'),
    a: () => (date.getHours() < 12 ? 'am' : 'pm'),
  };
  let out = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '\\' && i + 1 < pattern.length) {
      i += 1;
      out += pattern[i];
    } else {
      out += tokens[char]?.() ?? char;
    }
  }
  return out;
}

function ago(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}

/** Graph date: relative below the configured age in days, the configured format beyond it. */
export function relativeDate(iso: string, now = Date.now()): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  const age = now - time;
  if (age < 0 || age >= datePrefs.relativeDateDays * DAY) return formatDate(new Date(time), datePrefs.dateFormat, datePrefs.dateLocale);
  if (age < MINUTE) return 'just now';
  if (age < HOUR) return ago(Math.floor(age / MINUTE), 'minute');
  if (age < DAY) return ago(Math.floor(age / HOUR), 'hour');
  return ago(Math.floor(age / DAY), 'day');
}

/** Absolute date in the configured format. */
export function fullDate(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return iso;
  return formatDate(new Date(time), datePrefs.dateFormat, datePrefs.dateLocale);
}

export type ParsedRef =
  | { kind: 'head'; label: string }
  | { kind: 'local'; label: string }
  | { kind: 'remote'; label: string; remote: string; branch: string }
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
    } else {
      const remote = remoteNames.find(name => ref.startsWith(`${name}/`));
      if (remote) {
        if (ref.slice(remote.length + 1) === 'HEAD') continue;
        parsed.push({ kind: 'remote', label: ref, remote, branch: ref.slice(remote.length + 1) });
      } else {
        parsed.push({ kind: 'local', label: ref });
      }
    }
  }
  const rank = { head: 0, local: 1, remote: 2, tag: 3 };
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

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
