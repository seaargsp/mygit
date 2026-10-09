import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { CentreView, LogQuery, LogRow } from '../../panel/messages';
import type { Ctx } from '../lib/ui';
import type { MenuItem } from '../components/ContextMenu';
import { Icon } from '../lib/icons';
import { LOG_QUERY_KEY, NONE, commitMenu, createBranchAt, createTagAt, send } from '../lib/actions';
import { fullDate, parseRefs, plural, relativeDate, shortSha } from '../lib/format';
import { isTyping, primary } from '../lib/events';
import { savePersisted } from '../lib/persist';
import { isSafeRev, normalizeRelPath } from '../../git/argGuard';
import { Spinner } from '../components/Spinner';

type View = Extract<CentreView, { kind: 'log' }>;

const DEBOUNCE_MS = 300;
const DATE = /^(\d{4}-\d{2}-\d{2})?$/;

function validQuery(query: LogQuery): boolean {
  return query.refs.every(isSafeRev)
    && DATE.test(query.since) && DATE.test(query.until)
    && (query.path === '' || normalizeRelPath(query.path) !== null)
    && (!query.compare || (isSafeRev(query.compare.left) && isSafeRev(query.compare.right)));
}

function rowMenu(ctx: Ctx, row: LogRow): MenuItem[] {
  const loaded = ctx.state.commitLog.find(commit => commit.sha === row.sha);
  if (loaded) return commitMenu(ctx, loaded);
  const item = (label: string, onSelect: () => void): MenuItem => ({ kind: 'item', label, onSelect });
  return [
    item('Show in graph', () => ctx.ui.showCommit(row.sha)),
    item('Copy commit SHA', () => send(ctx, 'clipboard:write', { text: row.sha })),
    { kind: 'separator' },
    item('Create branch here', () => createBranchAt(ctx, row.sha)),
    item('Create tag here', () => createTagAt(ctx, row.sha)),
    item('Cherry pick commit', () => send(ctx, 'commit:cherryPick', { sha: row.sha })),
    item('Revert commit', () => send(ctx, 'commit:revert', { sha: row.sha })),
  ];
}

export function LogView({ ctx, view }: { ctx: Ctx; view: View }) {
  const { state } = ctx;
  const [draft, setDraft] = useState<LogQuery>(view.query);
  const [refInput, setRefInput] = useState('');
  const lastSent = useRef(JSON.stringify(view.query));
  const scrollRef = useRef<HTMLDivElement>(null);
  const remoteNames = useMemo(() => state.remotes.map(remote => remote.name), [state.remotes]);
  const refOptions = useMemo(() => [
    ...state.branches.local.map(branch => branch.name),
    ...state.branches.remote.flatMap(group => group.branches.map(branch => `${group.remoteName}/${branch.name}`)),
    ...state.tags.map(tag => `refs/tags/${tag.name}`),
  ], [state.branches, state.tags]);
  const selected = new Set(state.selection);

  // A query set from elsewhere (menu entry, merge finder) replaces the draft; an echo of our own does not.
  useEffect(() => {
    const key = JSON.stringify(view.query);
    if (key !== lastSent.current) {
      lastSent.current = key;
      setDraft(view.query);
    }
  }, [view.query]);

  useEffect(() => {
    const key = JSON.stringify(draft);
    if (key === lastSent.current || !validQuery(draft)) return;
    const timer = setTimeout(() => {
      lastSent.current = key;
      savePersisted(LOG_QUERY_KEY, draft);
      send(ctx, 'view:log', { query: draft });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft]);

  const set = (patch: Partial<LogQuery>) => setDraft(prev => ({ ...prev, ...patch }));
  const addRef = () => {
    const ref = refInput.trim();
    if (!ref || !isSafeRev(ref) || draft.refs.includes(ref)) return;
    set({ refs: [...draft.refs, ref] });
    setRefInput('');
  };

  function onScroll(): void {
    const element = scrollRef.current;
    if (!element || !view.hasMore || view.loading) return;
    if (element.scrollTop + element.clientHeight > element.scrollHeight - 400) send(ctx, 'view:logMore', NONE);
  }

  function click(row: LogRow, event: MouseEvent): void {
    if (primary(event) && state.selection.length === 1 && state.selection[0] !== row.sha && state.selection[0] !== 'working-tree') {
      send(ctx, 'graph:select', { shas: [state.selection[0], row.sha] });
      return;
    }
    send(ctx, 'graph:select', { shas: [row.sha] });
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (isTyping(event.target)) return;
    const index = view.rows.findIndex(row => row.sha === state.selection[state.selection.length - 1]);
    const key = event.key.toLowerCase();
    if (key === 'arrowdown' || key === 'j' || key === 'arrowup' || key === 'k') {
      event.preventDefault();
      const next = view.rows[Math.max(0, Math.min(view.rows.length - 1, index + (key === 'arrowdown' || key === 'j' ? 1 : -1)))];
      if (next) send(ctx, 'graph:select', { shas: [next.sha] });
    } else if (key === 'enter' && index !== -1) {
      ctx.ui.showCommit(view.rows[index].sha);
    }
  }

  const left = view.rows.filter(row => row.side === 'left');
  const right = view.rows.filter(row => row.side === 'right');
  const count = view.count ? `${view.count.done ? '' : '≥ '}${plural(view.count.value, 'commit')}` : view.loading ? '' : plural(view.rows.length, 'commit');

  const renderRow = (row: LogRow) => (
    <li
      key={row.sha}
      class="log-row"
      role="option"
      aria-selected={selected.has(row.sha)}
      onClick={event => click(row, event)}
      onDblClick={() => ctx.ui.showCommit(row.sha)}
      onContextMenu={event => ctx.ui.openMenu(event, rowMenu(ctx, row))}
    >
      <span class="log-row__sha">{shortSha(row.sha)}</span>
      <span class="log-row__refs">
        {parseRefs(row.refs, remoteNames).map(ref => <span key={`${ref.kind}:${ref.label}`} class={`ref-pill ref-pill--${ref.kind}`}><span class="ref-pill__text">{ref.label}</span></span>)}
      </span>
      <span class="log-row__message">{row.message}</span>
      <span class="log-row__author">{row.author}</span>
      <span class="log-row__date" title={fullDate(row.date)}>{relativeDate(row.date)}</span>
    </li>
  );

  return (
    <div class="log-view" data-testid="log-view">
      <div class="diff__head log-view__head">
        <Icon name="history" size={13} />
        <span class="diff__name">History</span>
        <span class="diff__tools">
          <button class={`chip${draft.compare ? ' chip--on' : ''}`} aria-pressed={Boolean(draft.compare)} onClick={() => set({ compare: draft.compare ? null : { left: state.head.branch ?? 'HEAD', right: state.targetBranch ?? 'HEAD' } })}>
            <Icon name="compare" size={12} /> Compare
          </button>
          <button class="icon-btn" aria-label="Close" title="Close (Esc)" onClick={() => send(ctx, 'view:close', NONE)}><Icon name="close" /></button>
        </span>
      </div>

      <div class="log-filters">
        <datalist id="log-refs">{refOptions.map(ref => <option key={ref} value={ref} />)}</datalist>
        {draft.compare ? (
          <>
            <label class="log-filter">A <input class="field field--small" list="log-refs" value={draft.compare.left} onInput={event => set({ compare: { ...draft.compare!, left: (event.target as HTMLInputElement).value.trim() } })} /></label>
            <label class="log-filter">B <input class="field field--small" list="log-refs" value={draft.compare.right} onInput={event => set({ compare: { ...draft.compare!, right: (event.target as HTMLInputElement).value.trim() } })} /></label>
          </>
        ) : (
          <span class="log-filter log-filter--refs">
            Refs
            {draft.refs.map(ref => (
              <span key={ref} class="chip chip--on">
                {ref}
                <button class="icon-btn icon-btn--small" aria-label={`Remove ${ref}`} onClick={() => set({ refs: draft.refs.filter(entry => entry !== ref) })}><Icon name="close" size={10} /></button>
              </span>
            ))}
            <input
              class="field field--small"
              list="log-refs"
              placeholder={draft.refs.length === 0 ? 'all refs' : 'add ref'}
              value={refInput}
              onInput={event => setRefInput((event.target as HTMLInputElement).value)}
              onKeyDown={event => event.key === 'Enter' && addRef()}
              onChange={addRef}
            />
          </span>
        )}
        <label class="log-filter">Author <input class="field field--small" value={draft.author} onInput={event => set({ author: (event.target as HTMLInputElement).value })} /></label>
        <label class="log-filter">Message <input class="field field--small" value={draft.message} onInput={event => set({ message: (event.target as HTMLInputElement).value })} /></label>
        <label class="log-filter">From <input class="field field--small" type="date" value={draft.since} onInput={event => set({ since: (event.target as HTMLInputElement).value })} /></label>
        <label class="log-filter">To <input class="field field--small" type="date" value={draft.until} onInput={event => set({ until: (event.target as HTMLInputElement).value })} /></label>
        <label class="log-filter">Path <input class={`field field--small${draft.path && normalizeRelPath(draft.path) === null ? ' field--error' : ''}`} value={draft.path} placeholder="src/" onInput={event => set({ path: (event.target as HTMLInputElement).value.trim() })} /></label>
      </div>

      <div class="log-view__scroll" ref={scrollRef} onScroll={onScroll}>
        {view.error ? <p class="graph__empty">{view.error}</p> : view.rows.length === 0 && !view.loading ? <p class="graph__empty">No commits match.</p> : null}
        {draft.compare && !view.error ? (
          <ul class="log-list" role="listbox" tabIndex={0} onKeyDown={onKeyDown} aria-label="Commits">
            <li class="log-group">Only in {view.query.compare?.left} ({left.length})</li>
            {left.map(renderRow)}
            <li class="log-group">Only in {view.query.compare?.right} ({right.length})</li>
            {right.map(renderRow)}
          </ul>
        ) : (
          <ul class="log-list" role="listbox" tabIndex={0} onKeyDown={onKeyDown} aria-label="Commits">{view.rows.map(renderRow)}</ul>
        )}
        {view.loading && <p class="graph__empty"><Spinner /> Loading…</p>}
      </div>

      <footer class="log-view__foot">
        <span>{count}</span>
        {view.query.compare && (
          <button class="link-btn" onClick={() => send(ctx, 'view:compareRefs', { left: view.query.compare!.left, right: view.query.compare!.right })}>Changed files</button>
        )}
      </footer>
    </div>
  );
}
