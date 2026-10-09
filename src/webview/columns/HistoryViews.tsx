import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { CentreView } from '../../panel/messages';
import type { Ctx } from '../lib/ui';
import { Icon } from '../lib/icons';
import { avatarColor, fullDate, relativeDate, shortSha, splitPath } from '../lib/format';
import { NONE, send } from '../lib/actions';
import { listen } from '../lib/events';
import { usePersisted } from '../lib/persist';
import { FindBar } from '../components/FindBar';
import { FileIcon } from '../components/FileIcon';
import { DiffBody } from './DiffView';
import { changeBlocks } from '../lib/wordDiff';

function useFind(): [boolean, (on: boolean) => void] {
  const [finding, setFinding] = useState(false);
  useEffect(() => listen(event => event.kind === 'find' && setFinding(true)), []);
  return [finding, setFinding];
}

function WrapToggle() {
  const [wrap, setWrap] = usePersisted<boolean>('diffWrap', false);
  return (
    <button class={`icon-btn${wrap ? ' icon-btn--active' : ''}`} aria-pressed={wrap} title="Word Wrap" aria-label="Word Wrap" onClick={() => setWrap(!wrap)}>
      <Icon name="wrap" />
    </button>
  );
}

function useWrap(): boolean {
  const [wrap] = usePersisted<boolean>('diffWrap', false);
  return wrap;
}

function Header({ ctx, path, children }: { ctx: Ctx; path: string; children?: preact.ComponentChildren }) {
  const { dir, name } = splitPath(path);
  return (
    <div class="diff__head">
      <FileIcon path={path} />
      <span class="diff__path" title={path}>
        {dir && <span class="diff__dir"><bdi>{dir}</bdi></span>}
        <span class="diff__name">{name}</span>
      </span>
      <span class="diff__tools">
        {children}
        <WrapToggle />
        <button class="icon-btn" aria-label="Close" title="Close (Esc)" onClick={() => send(ctx, 'view:close', NONE)}><Icon name="close" /></button>
      </span>
    </div>
  );
}

export function HistoryView({ ctx, view }: { ctx: Ctx; view: Extract<CentreView, { kind: 'history' }> }) {
  const [finding, setFinding] = useFind();
  const body = useRef<HTMLDivElement>(null);
  const blocks = useMemo(() => (view.diff ? changeBlocks(view.diff.hunks) : []), [view.diff]);
  const entries = view.entries;
  const wrap = useWrap();

  function onKeyDown(event: KeyboardEvent): void {
    if (!entries || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
    event.preventDefault();
    const index = entries.findIndex(entry => entry.sha === view.selected);
    const next = entries[Math.max(0, Math.min(entries.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))];
    if (next) send(ctx, 'view:historySelect', { sha: next.sha });
  }

  return (
    <div class="diff" data-testid="history-view">
      <Header ctx={ctx} path={view.path}>
        <span class="diff__source">File History</span>
        <button class="link-btn" onClick={() => send(ctx, 'view:blame', { path: view.path, rev: 'working-tree' })}><Icon name="blame" size={12} /> Blame</button>
      </Header>
      {finding && <FindBar root={body} onClose={() => setFinding(false)} version={view.selected} />}
      <div class="history">
        <ul class="history__list" tabIndex={0} onKeyDown={onKeyDown} aria-label="Commits touching this file">
          {entries === null && <li class="detail__empty">Loading history…</li>}
          {entries?.length === 0 && <li class="detail__empty">No commits touch this file.</li>}
          {entries?.map(entry => (
            <li
              key={entry.sha}
              class="history__entry"
              aria-selected={entry.sha === view.selected}
              onClick={() => send(ctx, 'view:historySelect', { sha: entry.sha })}
              onDblClick={() => ctx.ui.revealCommit(entry.sha)}
              title={`${entry.sha}\n${entry.path}`}
            >
              <span class="history__message">{entry.message}</span>
              <span class="history__meta">
                <span class="sha">{shortSha(entry.sha)}</span> · {entry.author} · <span title={fullDate(entry.date)}>{relativeDate(entry.date)}</span>
                {entry.path !== view.path && <> · <span class="history__renamed">{entry.path}</span></>}
              </span>
            </li>
          ))}
        </ul>
        <div class="history__diff diff__frame"><div class={`diff__body${wrap ? ' diff__body--wrap' : ''}`} ref={body}>
          {view.selected && !view.diff && <p class="diff__empty">Loading diff…</p>}
          {view.diff?.binary && <p class="diff__empty">Binary file.</p>}
          {view.diff && !view.diff.binary && <DiffBody ctx={ctx} diff={view.diff} mode="hunk" blocks={blocks} capability={null} onAction={() => undefined} />}
        </div></div>
      </div>
    </div>
  );
}

export function BlameView({ ctx, view }: { ctx: Ctx; view: Extract<CentreView, { kind: 'blame' }> }) {
  const [finding, setFinding] = useFind();
  const body = useRef<HTMLDivElement>(null);
  const lines = view.lines;
  const wrap = useWrap();

  return (
    <div class="diff" data-testid="blame-view">
      <Header ctx={ctx} path={view.path}>
        <span class="diff__source">Blame {view.rev === 'working-tree' ? 'of the working copy' : `at ${shortSha(view.rev)}`}</span>
        <button class="link-btn" onClick={() => send(ctx, 'view:history', { path: view.path })}><Icon name="history" size={12} /> History</button>
      </Header>
      {finding && <FindBar root={body} onClose={() => setFinding(false)} version={lines?.length} />}
      <div class={`diff__body${wrap ? ' diff__body--wrap' : ''}`} ref={body}>
        {lines === null && <p class="diff__empty">Loading blame…</p>}
        <div class="blame">
          {lines?.map((line, index) => {
            const first = index === 0 || lines[index - 1].sha !== line.sha;
            const uncommitted = /^0+$/.test(line.sha);
            return (
              <div key={index} class={`blame-row${first ? ' blame-row--first' : ''}`}>
                <span class="blame-row__bar" style={{ background: uncommitted ? 'var(--text-faint)' : avatarColor(line.author) }} />
                <span
                  class="blame-row__note"
                  data-find-skip
                  title={uncommitted ? 'Not committed yet' : `${line.summary}\n${line.author}, ${fullDate(line.date)}\n${line.sha}`}
                  onClick={() => !uncommitted && send(ctx, 'graph:select', { shas: [line.sha] })}
                >
                  {first && (uncommitted
                    ? <span class="blame-row__author">Not committed yet</span>
                    : (
                      <>
                        <span class="blame-row__author">{line.author}</span>
                        <span class="blame-row__date">{relativeDate(line.date)}</span>
                        <span class="blame-row__summary">{line.summary}</span>
                      </>
                    ))}
                </span>
                <span class="diff-gutter">{line.line}</span>
                <span class="diff-code">{line.text || ' '}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
