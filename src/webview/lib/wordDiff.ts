import type { DiffHunk, DiffLine } from '../../git/diff';

export type Segment = { text: string; changed: boolean };

const TOKEN = /\w+|\s+|[^\w\s]/g;
const MAX_TOKENS = 400;

/** Token-level LCS between two lines: segments of each line that differ from the other. */
export function wordDiff(before: string, after: string): [Segment[], Segment[]] | null {
  const a = before.match(TOKEN) ?? [];
  const b = after.match(TOKEN) ?? [];
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) return null;
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const left: Segment[] = [];
  const right: Segment[] = [];
  const push = (list: Segment[], text: string, changed: boolean) => {
    const last = list[list.length - 1];
    if (last && last.changed === changed) last.text += text;
    else list.push({ text, changed });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push(left, a[i++], false);
      push(right, b[j++], false);
    } else if (table[i + 1][j] >= table[i][j + 1]) push(left, a[i++], true);
    else push(right, b[j++], true);
  }
  while (i < a.length) push(left, a[i++], true);
  while (j < b.length) push(right, b[j++], true);
  // Lines that share almost nothing read better fully highlighted than speckled.
  const common = left.filter(segment => !segment.changed).reduce((sum, segment) => sum + segment.text.trim().length, 0);
  if (common < Math.min(before.trim().length, after.trim().length) * 0.25) return null;
  return [left, right];
}

export type Block = { hunk: number; start: number; end: number; lines: number[] };

/** Runs of consecutive added/removed lines inside each hunk. */
export function changeBlocks(hunks: DiffHunk[]): Block[] {
  const blocks: Block[] = [];
  hunks.forEach((hunk, hunkIndex) => {
    let current: Block | null = null;
    hunk.lines.forEach((line, index) => {
      const changed = line.kind === 'add' || line.kind === 'del';
      if (changed) {
        if (!current) {
          current = { hunk: hunkIndex, start: index, end: index, lines: [] };
          blocks.push(current);
        }
        current.end = index;
        current.lines.push(index);
      } else if (line.kind !== 'meta') {
        current = null;
      }
    });
  });
  return blocks;
}

/** Word-level segments for each changed line of a hunk, pairing deletions with the additions that follow. */
export function hunkWordDiffs(hunk: DiffHunk): Map<number, Segment[]> {
  const result = new Map<number, Segment[]>();
  const lines = hunk.lines;
  let i = 0;
  while (i < lines.length) {
    if (lines[i].kind !== 'del') {
      i += 1;
      continue;
    }
    const dels: number[] = [];
    while (i < lines.length && lines[i].kind === 'del') dels.push(i++);
    const adds: number[] = [];
    while (i < lines.length && lines[i].kind === 'add') adds.push(i++);
    const pairs = Math.min(dels.length, adds.length);
    for (let k = 0; k < pairs; k += 1) {
      const segments = wordDiff(lines[dels[k]].text, lines[adds[k]].text);
      if (!segments) continue;
      result.set(dels[k], segments[0]);
      result.set(adds[k], segments[1]);
    }
  }
  return result;
}

export type SplitRow = { left: { line: DiffLine; index: number } | null; right: { line: DiffLine; index: number } | null };

/** Side-by-side rows: context on both sides, deletions left paired with additions right. */
export function splitRows(hunk: DiffHunk): SplitRow[] {
  const rows: SplitRow[] = [];
  const lines = hunk.lines;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.kind === 'context') {
      rows.push({ left: { line, index: i }, right: { line, index: i } });
      i += 1;
      continue;
    }
    if (line.kind === 'meta') {
      i += 1;
      continue;
    }
    const dels: number[] = [];
    while (i < lines.length && lines[i].kind === 'del') dels.push(i++);
    const adds: number[] = [];
    while (i < lines.length && lines[i].kind === 'add') adds.push(i++);
    for (let k = 0; k < Math.max(dels.length, adds.length); k += 1) {
      rows.push({
        left: dels[k] !== undefined ? { line: lines[dels[k]], index: dels[k] } : null,
        right: adds[k] !== undefined ? { line: lines[adds[k]], index: adds[k] } : null,
      });
    }
  }
  return rows;
}
