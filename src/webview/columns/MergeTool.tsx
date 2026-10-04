import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { CentreView } from '../../panel/messages';
import type { Ctx } from '../lib/ui';
import { Icon } from '../lib/icons';
import { NONE, send } from '../lib/actions';
import { listen } from '../lib/events';
import { usePersisted } from '../lib/persist';
import { FindBar } from '../components/FindBar';
import { confirmDialog } from '../components/Dialog';

type Segment =
  | { kind: 'common'; lines: string[] }
  | { kind: 'conflict'; ours: string[]; theirs: string[]; base: string[] | null };

/** Splits a file with conflict markers (merge or diff3 style) into common and conflicting segments. */
export function parseConflicts(content: string): Segment[] {
  const lines = content.split('\n');
  const segments: Segment[] = [];
  let common: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].startsWith('<<<<<<<')) {
      common.push(lines[i]);
      i += 1;
      continue;
    }
    if (common.length > 0) segments.push({ kind: 'common', lines: common });
    common = [];
    const ours: string[] = [];
    const theirs: string[] = [];
    let base: string[] | null = null;
    let side: 'ours' | 'base' | 'theirs' = 'ours';
    i += 1;
    while (i < lines.length && !lines[i].startsWith('>>>>>>>')) {
      const line = lines[i];
      if (side === 'ours' && line.startsWith('|||||||')) {
        side = 'base';
        base = [];
      } else if (line.startsWith('=======') && side !== 'theirs') {
        side = 'theirs';
      } else if (side === 'ours') ours.push(line);
      else if (side === 'base') base!.push(line);
      else theirs.push(line);
      i += 1;
    }
    i += 1;
    segments.push({ kind: 'conflict', ours, theirs, base });
  }
  if (common.length > 0) segments.push({ kind: 'common', lines: common });
  return segments;
}

/** Picked lines per conflict, in the order they were chosen. */
type Pick = { side: 'ours' | 'theirs'; line: number };

function outputOf(segments: Segment[], picks: Pick[][]): string {
  let conflict = 0;
  const out: string[] = [];
  for (const segment of segments) {
    if (segment.kind === 'common') {
      out.push(...segment.lines);
      continue;
    }
    for (const pick of picks[conflict] ?? []) out.push(pick.side === 'ours' ? segment.ours[pick.line] : segment.theirs[pick.line]);
    conflict += 1;
  }
  return out.join('\n');
}

export function MergeTool({ ctx, view }: { ctx: Ctx; view: Extract<CentreView, { kind: 'merge' }> }) {
  const segments = useMemo(() => (view.content === null ? [] : parseConflicts(view.content)), [view.content]);
  const conflictCount = segments.filter(segment => segment.kind === 'conflict').length;
  const [picks, setPicks] = useState<Pick[][]>([]);
  const [output, setOutput] = useState('');
  const [edited, setEdited] = useState(false);
  const [current, setCurrent] = useState(0);
  const [finding, setFinding] = useState(false);
  const [wrap, setWrap] = usePersisted<boolean>('diffWrap', false);
  const panes = useRef<HTMLDivElement>(null);
  const outputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setPicks(segments.filter(segment => segment.kind === 'conflict').map(() => []));
    setEdited(false);
    setCurrent(0);
  }, [segments]);

  useEffect(() => {
    if (!edited) setOutput(outputOf(segments, picks));
  }, [picks, segments, edited]);

  useEffect(() => listen(event => {
    if (event.kind === 'find') setFinding(true);
    if (event.kind === 'externalDiff') send(ctx, 'merge:external', { path: view.path });
  }), [view.path]);

  function toggleLine(conflict: number, side: 'ours' | 'theirs', line: number): void {
    setEdited(false);
    setPicks(prev => prev.map((list, index) => {
      if (index !== conflict) return list;
      return list.some(pick => pick.side === side && pick.line === line)
        ? list.filter(pick => !(pick.side === side && pick.line === line))
        : [...list, { side, line }];
    }));
  }

  function toggleSide(conflict: number, side: 'ours' | 'theirs'): void {
    const segment = segments.filter(entry => entry.kind === 'conflict')[conflict] as Extract<Segment, { kind: 'conflict' }>;
    const lines = side === 'ours' ? segment.ours : segment.theirs;
    setEdited(false);
    setPicks(prev => prev.map((list, index) => {
      if (index !== conflict) return list;
      const all = lines.every((_line, line) => list.some(pick => pick.side === side && pick.line === line));
      const without = list.filter(pick => pick.side !== side);
      return all ? without : [...without, ...lines.map((_line, line) => ({ side, line }))];
    }));
  }

  function step(delta: 1 | -1): void {
    if (conflictCount === 0) return;
    const next = (current + delta + conflictCount) % conflictCount;
    setCurrent(next);
    panes.current?.querySelectorAll(`[data-conflict="${next}"]`).forEach(element => element.scrollIntoView({ block: 'center' }));
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      step(1);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      step(-1);
    }
  }

  const unresolved = /^(<{7}|={7}|>{7})( |$)/m.test(output);

  function save(): void {
    const run = () => send(ctx, 'merge:save', { path: view.path, content: output });
    if (unresolved) ctx.ui.openDialog(confirmDialog('Conflict markers remain', 'The output still contains conflict markers. Save it and mark the file resolved anyway?', 'Save and mark resolved', run, true));
    else run();
  }

  function pane(side: 'ours' | 'theirs') {
    let conflict = -1;
    return segments.map((segment, index) => {
      if (segment.kind === 'common') {
        return segment.lines.map((line, lineIndex) => <div key={`${index}-${lineIndex}`} class="merge-line merge-line--common">{line || ' '}</div>);
      }
      conflict += 1;
      const id = conflict;
      const lines = side === 'ours' ? segment.ours : segment.theirs;
      const chosen = picks[id] ?? [];
      const all = lines.length > 0 && lines.every((_line, line) => chosen.some(pick => pick.side === side && pick.line === line));
      return (
        <div key={index} class={`merge-hunk merge-hunk--${side}${id === current ? ' merge-hunk--current' : ''}`} data-conflict={id}>
          <label class="merge-hunk__head" data-find-skip>
            <input type="checkbox" checked={all} onChange={() => toggleSide(id, side)} />
            Conflict {id + 1}: {lines.length} {lines.length === 1 ? 'line' : 'lines'}
          </label>
          {lines.map((line, lineIndex) => {
            const order = chosen.findIndex(pick => pick.side === side && pick.line === lineIndex);
            return (
              <div key={lineIndex} class={`merge-line${order !== -1 ? ' merge-line--picked' : ''}`} onClick={() => toggleLine(id, side, lineIndex)}>
                <button class="merge-line__toggle" aria-label={order !== -1 ? 'Remove line from output' : 'Add line to output'} data-find-skip>
                  {order !== -1 ? order + 1 : '+'}
                </button>
                <span>{line || ' '}</span>
              </div>
            );
          })}
        </div>
      );
    });
  }

  return (
    <div class={`merge${wrap ? ' merge--wrap' : ''}`} data-testid="merge-tool" tabIndex={0} onKeyDown={onKeyDown}>
      <div class="diff__head">
        <Icon name="merge" size={13} />
        <span class="diff__name">{view.path}</span>
        <span class="diff__source">{conflictCount} {conflictCount === 1 ? 'conflict' : 'conflicts'}</span>
        <span class="diff__tools">
          <button class="icon-btn" aria-label="Previous conflict" title="Previous conflict (↑)" onClick={() => step(-1)}><Icon name="arrowUp" /></button>
          <span class="merge__position">{conflictCount === 0 ? '0/0' : `${current + 1}/${conflictCount}`}</span>
          <button class="icon-btn" aria-label="Next conflict" title="Next conflict (↓)" onClick={() => step(1)}><Icon name="arrowDown" /></button>
          <button class={`icon-btn${wrap ? ' icon-btn--active' : ''}`} aria-pressed={wrap} title="Word Wrap" aria-label="Word Wrap" onClick={() => setWrap(!wrap)}><Icon name="wrap" /></button>
          <button class="link-btn" onClick={() => send(ctx, 'merge:external', { path: view.path })}><Icon name="external" size={12} /> External merge tool</button>
          <button class="icon-btn" aria-label="Close merge tool" title="Close (Esc)" onClick={() => send(ctx, 'view:close', NONE)}><Icon name="close" /></button>
        </span>
      </div>
      {finding && <FindBar root={panes} onClose={() => setFinding(false)} version={view.content} />}
      {view.content === null ? <p class="diff__empty">Loading file…</p> : (
        <>
          <div class="merge__panes" ref={panes}>
            <div class="merge__pane">
              <div class="merge__pane-head">A: current ({view.current})</div>
              <div class="merge__pane-body">{pane('ours')}</div>
            </div>
            <div class="merge__pane">
              <div class="merge__pane-head">B: incoming ({view.incoming})</div>
              <div class="merge__pane-body">{pane('theirs')}</div>
            </div>
          </div>
          <div class="merge__output">
            <div class="merge__pane-head">
              Output
              {edited && <button class="link-btn" onClick={() => setEdited(false)}>Reset to selections</button>}
              {unresolved && <span class="merge__warning">conflict markers remain</span>}
            </div>
            <textarea
              ref={outputRef}
              class="merge__editor"
              spellcheck={false}
              value={output}
              aria-label="Merge output"
              onInput={event => {
                setEdited(true);
                setOutput((event.target as HTMLTextAreaElement).value);
              }}
            />
          </div>
          <div class="merge__foot">
            <span class="merge__hint">Tick a conflict or click lines on either side; lines enter the output in the order picked. The output is editable.</span>
            <button class="btn" onClick={() => send(ctx, 'view:close', NONE)}>Close</button>
            <button class="btn btn--primary" onClick={save}>Save and mark resolved</button>
          </div>
        </>
      )}
    </div>
  );
}
