import { useMemo, useRef } from 'preact/hooks';
import type { ClientState, WebviewToExtensionMessage } from '../../panel/messages';
import { Icon } from '../lib/icons';
import { fullDate, parseRefs, relativeDate, type ParsedRef } from '../lib/format';
import { GraphRail, LANE_WIDTH, ROW_HEIGHT } from './GraphRail';

type Props = {
  commitLog: ClientState['commitLog'];
  selectedCommit: ClientState['selectedCommit'];
  remoteNames: string[];
  workingTreeStatus: ClientState['workingTreeStatus'];
  dispatch: (message: WebviewToExtensionMessage) => void;
};

const REFS_WIDTH = 172;
const MAX_PILLS = 3;

export function GraphColumn({ commitLog, selectedCommit, remoteNames, workingTreeStatus, dispatch }: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  const headIndex = useMemo(
    () => Math.max(0, commitLog.findIndex(commit => commit.refs.some(ref => ref.startsWith('HEAD')))),
    [commitLog]
  );
  const laneCount = useMemo(
    () => commitLog.reduce((max, commit) => Math.max(max, commit.lane + 1), 1),
    [commitLog]
  );

  const graphWidth = Math.min(laneCount, 12) * LANE_WIDTH + 8;
  const rowCount = commitLog.length + 1;

  function select(sha: string | 'working-tree'): void {
    dispatch({ type: 'graph:selectCommit', payload: { sha } });
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const order: (string | 'working-tree')[] = ['working-tree', ...commitLog.map(commit => commit.sha)];
    const current = order.indexOf(selectedCommit);
    const next = Math.max(0, Math.min(order.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)));
    if (next === current) return;
    select(order[next]);
    const rows = listRef.current?.querySelectorAll<HTMLElement>('.commit-row');
    rows?.[next]?.scrollIntoView({ block: 'nearest' });
  }

  const style = { '--refs-w': `${REFS_WIDTH}px`, '--graph-w': `${graphWidth}px` } as Record<string, string>;
  const changedCount = workingTreeStatus.staged.length + workingTreeStatus.unstaged.length + workingTreeStatus.conflicted.length;

  return (
    <div class="graph" data-testid="graph-column" style={style}>
      <div class="graph__head">
        <div>Branch / Tag</div>
        <div>Graph</div>
        <div>Commit message</div>
        <div>Date</div>
      </div>

      <div class="graph__scroll">
        <div class="graph__rows" ref={listRef} role="listbox" tabIndex={0} aria-label="Commits" onKeyDown={onKeyDown}>
          <GraphRail
            commits={commitLog}
            rowOffset={1}
            headIndex={headIndex}
            width={graphWidth}
            height={rowCount * ROW_HEIGHT}
          />

          <div
            class="commit-row commit-row--wip"
            data-testid="select-working-tree"
            role="option"
            aria-selected={selectedCommit === 'working-tree'}
            onClick={() => select('working-tree')}
          >
            <div class="commit-row__refs" />
            <div />
            <div class="commit-row__message">
              <span class="commit-row__subject">Working tree</span>
              <span class="commit-row__body">
                {changedCount === 0 ? 'no changes' : `${changedCount} changed ${changedCount === 1 ? 'file' : 'files'}`}
              </span>
            </div>
            <div class="commit-row__date" />
          </div>

          {commitLog.map(commit => (
            <div
              key={commit.sha}
              class="commit-row"
              data-testid={`commit-${commit.sha}`}
              role="option"
              aria-selected={selectedCommit === commit.sha}
              onClick={() => select(commit.sha)}
            >
              <div class="commit-row__refs">
                <RefPills refs={commit.refs} remoteNames={remoteNames} />
              </div>
              <div />
              <div class="commit-row__message">
                <span class="commit-row__subject">{commit.message}</span>
                {commit.body && <span class="commit-row__body">{firstLine(commit.body)}</span>}
              </div>
              <div class="commit-row__date" title={fullDate(commit.date)}>{relativeDate(commit.date)}</div>
            </div>
          ))}
        </div>

        {commitLog.length === 0 && <p class="graph__empty">No commits on the selected refs.</p>}

        {commitLog.length > 0 && (
          <div class="graph__footer">
            <button class="btn" data-testid="load-more" onClick={() => dispatch({ type: 'graph:loadMore' })}>
              Load more commits
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function RefPills({ refs, remoteNames }: { refs: string[]; remoteNames: string[] }) {
  const parsed = parseRefs(refs, remoteNames);
  const shown = parsed.slice(0, MAX_PILLS);
  const hidden = parsed.slice(MAX_PILLS);
  return (
    <>
      {shown.map(ref => <RefPill key={`${ref.kind}-${ref.label}`} refItem={ref} />)}
      {hidden.length > 0 && (
        <span class="ref-pill ref-pill--more" title={hidden.map(ref => ref.label).join('\n')}>
          +{hidden.length}
        </span>
      )}
    </>
  );
}

const PILL_ICON = { head: 'check', local: 'branch', remote: 'cloud', tag: 'tag' } as const;

function RefPill({ refItem }: { refItem: ParsedRef }) {
  return (
    <span class={`ref-pill ref-pill--${refItem.kind}`} title={refItem.label}>
      <Icon name={PILL_ICON[refItem.kind]} size={10} />
      <span class="ref-pill__text">{refItem.label}</span>
    </span>
  );
}

function firstLine(body: string): string {
  return body.trim().split('\n')[0];
}
