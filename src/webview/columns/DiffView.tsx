import { Fragment, type ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { DiffLine, FileDiff } from '../../git/diff';
import type { CentreView, OpenFile } from '../../panel/messages';
import type { MenuItem } from '../components/ContextMenu';
import type { Ctx } from '../lib/ui';
import { Icon } from '../lib/icons';
import { FileIcon } from '../components/FileIcon';
import { splitPath } from '../lib/format';
import { NONE, send } from '../lib/actions';
import { listen } from '../lib/events';
import { usePersisted } from '../lib/persist';
import { changeBlocks, hunkWordDiffs, splitRows, type Block, type Segment } from '../lib/wordDiff';
import { FindBar } from '../components/FindBar';
import { confirmDialog } from '../components/Dialog';

export type DiffMode = 'hunk' | 'inline' | 'split';
type Capability = 'unstaged' | 'staged' | 'revert' | null;
type LineAction = 'stage' | 'unstage' | 'discard' | 'revert';

const SOURCE_LABEL: Record<OpenFile['source'], string> = {
  commit: 'in this commit',
  staged: 'staged',
  unstaged: 'unstaged',
  range: 'combined diff',
  stash: 'in stash',
};
const STATUS_LABEL: Record<string, string> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', U: 'conflicted' };

export function DiffView({ ctx, view }: { ctx: Ctx; view: Extract<CentreView, { kind: 'diff' }> }) {
  const { file, diff, fileView } = view;
  const [mode, setMode] = usePersisted<DiffMode>('diffMode', 'hunk');
  const [wrap, setWrap] = usePersisted<boolean>('diffWrap', false);
  const [finding, setFinding] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const { dir, name } = splitPath(file.path);

  // Inline and split show the whole file; hunk view only the changed blocks.
  useEffect(() => {
    const wanted = mode === 'hunk' ? 'hunk' : 'full';
    if (view.context !== wanted) send(ctx, 'view:diffContext', { context: wanted });
  }, [mode, view.context, file.path, file.source, file.sha]);

  useEffect(() => listen(event => {
    if (event.kind === 'find') setFinding(true);
    if (event.kind === 'externalDiff') send(ctx, 'file:externalDiff', { file });
  }), [file]);

  const capability: Capability = file.source === 'unstaged' ? 'unstaged' : file.source === 'staged' ? 'staged' : file.source === 'commit' || file.source === 'range' ? 'revert' : null;
  const blocks = useMemo(() => (diff ? changeBlocks(diff.hunks) : []), [diff]);
  const [blockIndex, setBlockIndex] = useState(-1);

  function goto(delta: 1 | -1): void {
    if (blocks.length === 0) return;
    const next = (blockIndex + delta + blocks.length) % blocks.length;
    setBlockIndex(next);
    bodyRef.current?.querySelector(`[data-block-start="${next}"]`)?.scrollIntoView({ block: 'center' });
  }

  function act(action: LineAction, hunk: number, lines?: number[]): void {
    if (action === 'revert') {
      send(ctx, 'hunk:revert', { file, hunk, lines });
      return;
    }
    const run = () => send(ctx, 'stage:lines', { path: file.path, source: file.source === 'staged' ? 'staged' : 'unstaged', action, hunk, lines, untracked: file.untracked });
    if (action === 'discard') {
      ctx.ui.openDialog(confirmDialog(lines ? 'Discard selected lines' : 'Discard hunk', 'The changes are removed from the working directory.', 'Discard', run, true));
    } else run();
  }

  const workingFile = file.source === 'staged' || file.source === 'unstaged';

  return (
    <div class="diff" data-testid="diff-view">
      <div class="diff__head">
        <FileIcon path={file.path} />
        <span class="diff__path" title={file.path}>
          {dir && <span class="diff__dir"><bdi>{dir}</bdi></span>}
          <span class="diff__name">{name}</span>
        </span>
        {file.status && <span class={`diff__status diff__status--${file.status}`}>{file.untracked ? 'untracked' : STATUS_LABEL[file.status]}</span>}
        <span class="diff__source">{SOURCE_LABEL[file.source]}</span>
        {diff && !diff.binary && (
          <span class="diff__stat">
            <span class="diff__stat-add">+{diff.additions}</span>
            <span class="diff__stat-del">-{diff.deletions}</span>
          </span>
        )}
        <span class="diff__tools">
          <span class="segmented" role="group" aria-label="View mode">
            {(['hunk', 'inline', 'split'] as const).map(entry => (
              <button key={entry} class="segmented__btn" aria-pressed={!fileView && mode === entry} onClick={() => { if (fileView) send(ctx, 'view:fileView', { on: false }); setMode(entry); }}>
                {entry[0].toUpperCase() + entry.slice(1)}
              </button>
            ))}
            <button class="segmented__btn" aria-pressed={Boolean(fileView)} title="File View: the full file at this revision" onClick={() => send(ctx, 'view:fileView', { on: !fileView })}>File</button>
          </span>
          <button class={`icon-btn${wrap ? ' icon-btn--active' : ''}`} aria-pressed={wrap} title="Word Wrap" aria-label="Word Wrap" onClick={() => setWrap(!wrap)}><Icon name="wrap" /></button>
          <button class="icon-btn" title="Previous change" aria-label="Previous change" onClick={() => goto(-1)}><Icon name="arrowUp" /></button>
          <button class="icon-btn" title="Next change" aria-label="Next change" onClick={() => goto(1)}><Icon name="arrowDown" /></button>
          <button class="link-btn" onClick={() => send(ctx, 'view:history', { path: file.path })}><Icon name="history" size={12} /> History</button>
          <button class="link-btn" onClick={() => send(ctx, 'view:blame', { path: file.path, rev: workingFile ? 'working-tree' : file.sha })}><Icon name="blame" size={12} /> Blame</button>
          <button class="link-btn" onClick={() => send(ctx, 'file:open', { path: file.path })}>{workingFile ? 'Edit this file' : 'Edit in working directory'}</button>
          <button class="icon-btn" title="Open in external diff tool" aria-label="Open in external diff tool" onClick={() => send(ctx, 'file:externalDiff', { file })}><Icon name="external" /></button>
          <button class="icon-btn" aria-label="Close diff" title="Close (Esc)" data-testid="close-diff" onClick={() => send(ctx, 'view:close', NONE)}><Icon name="close" /></button>
        </span>
      </div>

      {finding && <FindBar root={bodyRef} onClose={() => setFinding(false)} version={`${diff?.path}-${mode}-${Boolean(fileView)}-${diff?.hunks.length}`} />}

      <div class="diff__frame">
      <div class={`diff__body${wrap ? ' diff__body--wrap' : ''}`} ref={bodyRef}>
        {fileView ? (
          <FileContent text={fileView.text} />
        ) : (
          <>
            {!diff && <p class="diff__empty">Loading diff…</p>}
            {diff?.binary && <p class="diff__empty">Binary file. There is no text diff to show.</p>}
            {diff && !diff.binary && diff.hunks.length === 0 && <p class="diff__empty">No line changes. The file's mode or metadata changed, or it is empty.</p>}
            {diff && !diff.binary && diff.hunks.length > 0 && (
              <DiffBody ctx={ctx} diff={diff} mode={mode} blocks={blocks} capability={capability} onAction={act} />
            )}
          </>
        )}
      </div>
      </div>
    </div>
  );
}

function FileContent({ text }: { text: string }) {
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return (
    <div class="diff__content">
      {lines.map((line, index) => (
        <div key={index} class="diff-row diff-row--file">
          <span class="diff-gutter">{index + 1}</span>
          <span class="diff-code">{line || ' '}</span>
        </div>
      ))}
    </div>
  );
}

type BodyProps = {
  ctx: Ctx;
  diff: FileDiff;
  mode: DiffMode;
  blocks: Block[];
  capability: Capability;
  onAction: (action: LineAction, hunk: number, lines?: number[]) => void;
};

const SIGN = { add: '+', del: '-', context: ' ', meta: ' ' } as const;

/** Diff lines with hunk/line actions; read-only when `capability` is null. */
export function DiffBody({ ctx, diff, mode, blocks, capability, onAction }: BodyProps) {
  const [selection, setSelection] = useState<{ hunk: number; lines: number[] } | null>(null);
  const dragging = useRef(false);
  const anchor = useRef<number | null>(null);
  const words = useMemo(() => diff.hunks.map(hunk => hunkWordDiffs(hunk)), [diff]);
  const full = mode !== 'hunk';
  const blockStart = useMemo(() => {
    const map = new Map<string, number>();
    blocks.forEach((block, index) => map.set(`${block.hunk}:${block.start}`, index));
    return map;
  }, [blocks]);

  useEffect(() => setSelection(null), [diff]);
  useEffect(() => {
    const up = () => {
      dragging.current = false;
    };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);

  const selectable = (line: DiffLine) => capability !== null && (line.kind === 'add' || line.kind === 'del');
  const isSelected = (hunk: number, index: number) => selection?.hunk === hunk && selection.lines.includes(index);

  function gutterDown(event: PointerEvent, hunk: number, index: number): void {
    if (capability === null) return;
    event.preventDefault();
    const line = diff.hunks[hunk].lines[index];
    if (!selectable(line)) return;
    if (event.shiftKey && selection?.hunk === hunk && anchor.current !== null) {
      const [from, to] = [Math.min(anchor.current, index), Math.max(anchor.current, index)];
      const range: number[] = [];
      for (let i = from; i <= to; i += 1) if (selectable(diff.hunks[hunk].lines[i])) range.push(i);
      setSelection({ hunk, lines: range });
      return;
    }
    dragging.current = true;
    anchor.current = index;
    if (selection?.hunk === hunk && selection.lines.includes(index)) {
      setSelection({ hunk, lines: selection.lines.filter(entry => entry !== index) });
    } else {
      setSelection({ hunk, lines: selection?.hunk === hunk ? [...selection.lines, index] : [index] });
    }
  }

  function gutterEnter(hunk: number, index: number): void {
    if (!dragging.current || selection?.hunk !== hunk) return;
    if (!selectable(diff.hunks[hunk].lines[index]) || selection.lines.includes(index)) return;
    setSelection({ hunk, lines: [...selection.lines, index] });
  }

  const verbs: Record<Exclude<Capability, null>, LineAction[]> = {
    unstaged: ['stage', 'discard'],
    staged: ['unstage'],
    revert: ['revert'],
  };
  const label = (action: LineAction) => action[0].toUpperCase() + action.slice(1);

  function menu(event: MouseEvent): void {
    const items: MenuItem[] = [];
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-hunk]');
    const hunk = target ? Number(target.dataset.hunk) : null;
    const line = target?.dataset.line !== undefined ? Number(target.dataset.line) : null;
    if (capability) {
      if (selection && selection.lines.length > 0) {
        for (const action of verbs[capability]) items.push({ kind: 'item', label: `${label(action)} selected lines`, danger: action === 'discard', onSelect: () => onAction(action, selection.hunk, selection.lines) });
      }
      if (hunk !== null) {
        const block = full && line !== null ? blocks.find(entry => entry.hunk === hunk && line >= entry.start && line <= entry.end) : undefined;
        if (!full || block) {
          for (const action of verbs[capability]) {
            items.push({ kind: 'item', label: `${label(action)} ${full ? 'change' : 'hunk'}`, danger: action === 'discard', onSelect: () => onAction(action, hunk, block?.lines) });
          }
        }
      }
      if (items.length > 0) items.push({ kind: 'separator' });
    }
    const text = window.getSelection()?.toString() ?? '';
    items.push({ kind: 'item', label: 'Copy', disabled: !text, onSelect: () => send(ctx, 'clipboard:write', { text }) });
    ctx.ui.openMenu(event, items);
  }

  function actionBar(hunk: number, lines: number[] | undefined, text: ComponentChildren) {
    return (
      <div class="diff-row diff-row--hunk" data-hunk={hunk}>
        <span class="diff-hunk__text">{text}</span>
        {capability && (
          <span class="diff-hunk__actions" data-find-skip>
            {verbs[capability].map(action => (
              <button key={action} class={`link-btn${action === 'discard' ? ' link-btn--danger' : ''}`} onClick={() => onAction(action, hunk, lines)}>
                {label(action)} {full ? 'change' : 'hunk'}
              </button>
            ))}
            {selection?.hunk === hunk && selection.lines.length > 0 && verbs[capability].map(action => (
              <button key={`sel-${action}`} class="link-btn link-btn--accent" onClick={() => onAction(action, hunk, selection.lines)}>
                {label(action)} {selection.lines.length} {selection.lines.length === 1 ? 'line' : 'lines'}
              </button>
            ))}
          </span>
        )}
      </div>
    );
  }

  function codeContent(line: DiffLine, segments: Segment[] | undefined): ComponentChildren {
    if (!segments) return line.text || ' ';
    return segments.map((segment, index) => (segment.changed ? <mark key={index} class={`word word--${line.kind}`}>{segment.text}</mark> : segment.text));
  }

  function unifiedRow(hunk: number, index: number) {
    const line = diff.hunks[hunk].lines[index];
    const block = blockStart.get(`${hunk}:${index}`);
    const blockData = blocks[block ?? -1];
    return (
      <Fragment key={index}>
        {full && block !== undefined && capability && actionBar(hunk, blockData.lines, `${blockData.lines.length} changed ${blockData.lines.length === 1 ? 'line' : 'lines'}`)}
        <div
          class={`diff-row diff-row--${line.kind}${isSelected(hunk, index) ? ' diff-row--selected' : ''}`}
          data-hunk={hunk}
          data-line={index}
          data-block-start={block}
        >
          <span class="diff-gutter" onPointerDown={event => gutterDown(event, hunk, index)} onPointerEnter={() => gutterEnter(hunk, index)}>{line.oldLine ?? ''}</span>
          <span class="diff-gutter" onPointerDown={event => gutterDown(event, hunk, index)} onPointerEnter={() => gutterEnter(hunk, index)}>{line.newLine ?? ''}</span>
          <span class="diff-sign">{SIGN[line.kind]}</span>
          <span class="diff-code">{codeContent(line, words[hunk].get(index))}</span>
        </div>
      </Fragment>
    );
  }

  function splitSide(hunk: number, side: { line: DiffLine; index: number } | null, which: 'left' | 'right') {
    if (!side) return <><span class="diff-gutter diff-gutter--empty" /><span class="diff-code diff-code--empty" /></>;
    const number = which === 'left' ? side.line.oldLine : side.line.newLine;
    const kind = side.line.kind === 'context' ? 'context' : side.line.kind;
    return (
      <>
        <span
          class={`diff-gutter diff-gutter--${kind}${isSelected(hunk, side.index) && kind !== 'context' ? ' diff-gutter--selected' : ''}`}
          onPointerDown={event => kind !== 'context' && gutterDown(event, hunk, side.index)}
          onPointerEnter={() => gutterEnter(hunk, side.index)}
        >
          {number ?? ''}
        </span>
        <span class={`diff-split__code diff-split__code--${kind}`}>{codeContent(side.line, words[hunk].get(side.index))}</span>
      </>
    );
  }

  const totalLines = diff.hunks.reduce((sum, hunk) => sum + hunk.lines.length + 1, 0);
  const markers = useMemo(() => {
    const result: { top: number; kind: string }[] = [];
    let row = 0;
    diff.hunks.forEach(hunk => {
      row += 1;
      hunk.lines.forEach(line => {
        if (line.kind === 'add' || line.kind === 'del') result.push({ top: (row / totalLines) * 100, kind: line.kind });
        row += 1;
      });
    });
    return result;
  }, [diff]);

  return (
    <div class="diff__scroll-wrap">
      <div class={`diff__content${mode === 'split' ? ' diff__content--split' : ''}`} onContextMenu={menu}>
        {diff.hunks.map((hunk, hunkIndex) => (
          <div class="hunk" key={`${hunkIndex}-${hunk.header}`}>
            {!full && actionBar(hunkIndex, undefined, hunk.header)}
            {mode === 'split'
              ? splitRows(hunk).map((row, index) => {
                const startIndex = row.left?.index ?? row.right?.index ?? -1;
                const block = row.left?.line.kind !== 'context' ? blockStart.get(`${hunkIndex}:${startIndex}`) : undefined;
                return (
                  <Fragment key={index}>
                    {full && block !== undefined && capability && actionBar(hunkIndex, blocks[block].lines, `${blocks[block].lines.length} changed lines`)}
                    <div class="diff-split-row" data-hunk={hunkIndex} data-line={startIndex} data-block-start={block}>
                      {splitSide(hunkIndex, row.left, 'left')}
                      {splitSide(hunkIndex, row.right, 'right')}
                    </div>
                  </Fragment>
                );
              })
              : hunk.lines.map((_line, index) => unifiedRow(hunkIndex, index))}
          </div>
        ))}
      </div>
      <div class="minimap" aria-hidden="true" data-find-skip>
        {markers.map((marker, index) => <span key={index} class={`minimap__mark minimap__mark--${marker.kind}`} style={{ top: `${marker.top}%` }} />)}
      </div>
    </div>
  );
}
