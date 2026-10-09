import { useEffect, useRef, useState } from 'preact/hooks';
import type { Ref } from 'preact';
import type { PullMode } from '../../panel/messages';
import { isPending, type Ctx } from '../lib/ui';
import { Icon, type IconName } from '../lib/icons';
import { NONE, createBranchAt, pushFlow, send, sparseDialog } from '../lib/actions';
import { ConflictIndicator } from './ConflictIndicator';
import { Spinner } from './Spinner';
import { isMac } from '../lib/events';

type Props = {
  ctx: Ctx;
  leftCollapsed: boolean;
  onToggleLeft: () => void;
  detailCollapsed: boolean;
  onToggleDetail: () => void;
  search: SearchProps;
  wipLabel: string;
};

export type SearchProps = {
  query: string;
  setQuery: (query: string) => void;
  count: number;
  /** Matches below the loaded rows; stepping to one loads the graph down to it. */
  older: number;
  index: number;
  step: (delta: 1 | -1) => void;
  inputRef: Ref<HTMLInputElement>;
  /** The full-history search is running. */
  searching: boolean;
  /** The full-history search stopped at its match limit. */
  truncated: boolean;
};

const PULL_MODES: { mode: PullMode; label: string }[] = [
  { mode: 'fetch', label: 'Fetch All' },
  { mode: 'ff', label: 'Pull (fast-forward if possible)' },
  { mode: 'ff-only', label: 'Pull (fast-forward only)' },
  { mode: 'rebase', label: 'Pull (rebase)' },
];

const mod = isMac ? '⌘' : 'Ctrl+';

export function Toolbar({ ctx, leftCollapsed, onToggleLeft, detailCollapsed, onToggleDetail, search, wipLabel }: Props) {
  const { state } = ctx;
  const { head, undo, repo, prefs, stashes } = state;
  const [pullOpen, setPullOpen] = useState(false);
  const [lfsOpen, setLfsOpen] = useState(false);
  const labels = prefs.showToolbarLabels;
  const defaultPull = PULL_MODES.find(entry => entry.mode === state.repoPrefs.defaultPull) ?? PULL_MODES[1];
  const dirty = state.workingTreeStatus.staged.length + state.workingTreeStatus.unstaged.length > 0;
  const headRef = head.branch ? `local:${head.branch}` : undefined;
  const pushing = isPending(state, 'remote:push') || (headRef !== undefined && isPending(state, ['branch:pushTo', 'commit:create'], headRef));

  return (
    <header class={`toolbar${labels ? '' : ' toolbar--compact'}`}>
      <button
        class="icon-btn"
        aria-pressed={!leftCollapsed}
        aria-label={leftCollapsed ? 'Show the Left Panel' : 'Hide the Left Panel'}
        title={`${leftCollapsed ? 'Show' : 'Hide'} Left Panel (${mod}J)`}
        onClick={onToggleLeft}
      >
        <Icon name="sidebar" size={16} />
      </button>

      <div class="toolbar__context">
        <span class="context-field">
          <span class="context-field__label">Repository</span>
          <span class="context-field__value" title={state.repoName}>{state.repoName || '…'}</span>
        </span>
        <span class="context-sep"><Icon name="chevron" size={12} /></span>
        <span class="context-field">
          <span class="context-field__label">Branch</span>
          <span class="context-field__value" title={head.branch ?? head.sha ?? ''}>
            {head.branch ?? (head.sha ? `HEAD ${head.sha.slice(0, 7)}` : state.loading.refs ? '…' : 'no commits')}
          </span>
        </span>
      </div>

      <div class="toolbar__actions">
        <div class="toolbar__group">
          <ToolButton icon="undo" label="Undo" labels={labels} busy={isPending(state, 'undo')} disabled={!undo.undo} title={undo.undo ? `Undo ${undo.undo} (${mod}Z)` : 'Nothing to undo'} onClick={() => send(ctx, 'undo', NONE)} />
          <ToolButton icon="redo" label="Redo" labels={labels} busy={isPending(state, 'redo')} disabled={!undo.redo} title={undo.redo ? `Redo ${undo.redo} (${mod}Y)` : 'Nothing to redo'} onClick={() => send(ctx, 'redo', NONE)} />
        </div>

        <div class="toolbar__group">
          <div class="split-btn">
            <ToolButton
              icon="down"
              label="Pull"
              labels={labels}
              busy={isPending(state, ['remote:pull', 'remote:fetch'])}
              badge={head.behind > 0 ? `↓${head.behind}` : undefined}
              title={`${defaultPull.label} (default)`}
              onClick={() => send(ctx, 'remote:pull', { mode: defaultPull.mode })}
            />
            <button class="split-btn__toggle" aria-label="Pull options" aria-expanded={pullOpen} onClick={() => setPullOpen(open => !open)}>
              <Icon name="chevronDown" size={10} />
            </button>
            {pullOpen && (
              <Popover onClose={() => setPullOpen(false)}>
                {PULL_MODES.map(entry => (
                  <div class="pull-menu__row" key={entry.mode}>
                    <button
                      class="pull-menu__label"
                      onClick={() => {
                        setPullOpen(false);
                        send(ctx, 'remote:pull', { mode: entry.mode });
                      }}
                    >
                      <span class="context-menu__check">{entry.mode === defaultPull.mode ? '✓' : ''}</span>
                      {entry.label}
                      {entry.mode === 'fetch' && <span class="context-menu__hint">{mod}L</span>}
                    </button>
                    <button
                      class={`pull-menu__star${entry.mode === defaultPull.mode ? ' pull-menu__star--on' : ''}`}
                      title="Set as default"
                      aria-label={`Set ${entry.label} as the default`}
                      onClick={() => send(ctx, 'remote:setDefaultPull', { mode: entry.mode })}
                    >
                      <Icon name={entry.mode === defaultPull.mode ? 'starFull' : 'star'} size={12} />
                    </button>
                  </div>
                ))}
              </Popover>
            )}
          </div>
          <ToolButton
            icon="up"
            label="Push"
            labels={labels}
            busy={pushing}
            badge={head.ahead > 0 ? `↑${head.ahead}` : head.branch && !head.upstream ? 'new' : undefined}
            title={head.upstream ? `Push ${head.branch} to ${head.upstream}` : 'Push (creates the upstream)'}
            onClick={() => pushFlow(ctx)}
          />
        </div>

        <div class="toolbar__group">
          <ToolButton icon="branch" label="Branch" labels={labels} busy={isPending(state, 'branch:create')} disabled={!head.sha} title={`Create a branch at HEAD (${mod}B)`} onClick={() => head.sha && createBranchAt(ctx, head.sha)} />
        </div>

        <div class="toolbar__group">
          <ToolButton icon="stash" label="Stash" labels={labels} busy={isPending(state, 'stash:save')} disabled={!dirty} title="Stash all uncommitted changes" onClick={() => send(ctx, 'stash:save', { message: wipLabel || undefined })} />
          <ToolButton icon="pop" label="Pop" labels={labels} busy={isPending(state, 'stash:pop')} disabled={stashes.length === 0} title={stashes[0] ? `Pop "${stashes[0].message}"` : 'No stashes'} onClick={() => send(ctx, 'stash:pop', {})} />
        </div>

        {(repo?.lfs || repo?.sparse.enabled) && (
          <div class="toolbar__group">
            {repo?.lfs && (
              <div class="split-btn">
                <ToolButton icon="box" label="LFS" labels={labels} busy={isPending(state, 'lfs:run')} title="Git LFS" onClick={() => setLfsOpen(open => !open)} />
                {lfsOpen && (
                  <Popover onClose={() => setLfsOpen(false)}>
                    {(['pull', 'fetch', 'prune'] as const).map(action => (
                      <button key={action} class="pull-menu__label" onClick={() => { setLfsOpen(false); send(ctx, 'lfs:run', { action }); }}>
                        <span class="context-menu__check" />LFS {action}
                      </button>
                    ))}
                  </Popover>
                )}
              </div>
            )}
            {repo?.sparse.enabled && <ToolButton icon="filter" label="Sparse" labels={labels} busy={isPending(state, 'sparse:set')} title="Sparse checkout settings" onClick={() => sparseDialog(ctx)} />}
          </div>
        )}

        <ConflictIndicator ctx={ctx} />

        <SearchBox search={search} />

        <button
          class="icon-btn"
          aria-pressed={!detailCollapsed}
          aria-label={detailCollapsed ? 'Show the Commit Panel' : 'Hide the Commit Panel'}
          title={`${detailCollapsed ? 'Show' : 'Hide'} Commit Panel (${mod}K)`}
          onClick={onToggleDetail}
        >
          <Icon name="panelRight" size={16} />
        </button>
      </div>
    </header>
  );
}

function SearchBox({ search }: { search: SearchProps }) {
  return (
    <div class="search-box" role="search">
      <Icon name="search" size={13} />
      <input
        ref={search.inputRef}
        class="search-box__input"
        type="text"
        placeholder={`Search commits (${mod}F)`}
        aria-label="Search commits by message, SHA or author"
        value={search.query}
        onInput={event => search.setQuery((event.target as HTMLInputElement).value)}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault();
            search.step(event.shiftKey ? -1 : 1);
          } else if (event.key === 'Escape' && search.query) {
            event.stopPropagation();
            search.setQuery('');
          }
        }}
      />
      {search.query && (
        <>
          {search.searching && <Spinner size={10} label="Searching history" />}
          <span
            class="search-box__count"
            title={search.older > 0 ? `${search.older} in older history, loaded into the graph when reached` : undefined}
          >
            {search.count === 0 ? '0' : `${search.index + 1}/${search.count}${search.truncated ? '+' : ''}`}
          </span>
          <button class="icon-btn icon-btn--small" aria-label="Previous result" onClick={() => search.step(-1)}><Icon name="arrowUp" size={12} /></button>
          <button class="icon-btn icon-btn--small" aria-label="Next result" onClick={() => search.step(1)}><Icon name="arrowDown" size={12} /></button>
        </>
      )}
    </div>
  );
}

type ToolButtonProps = {
  icon: IconName;
  label: string;
  labels: boolean;
  title?: string;
  badge?: string;
  disabled?: boolean;
  /** The button's operation is in flight: the icon shows a spinner. */
  busy?: boolean;
  onClick: () => void;
};

function ToolButton({ icon, label, labels, title, badge, disabled, busy, onClick }: ToolButtonProps) {
  return (
    <button class="tool-btn" title={title ?? label} aria-label={label} aria-busy={busy} disabled={disabled} onClick={onClick}>
      <span class="tool-btn__icon">
        {busy ? <Spinner size={14} label={`${label} in progress`} /> : <Icon name={icon} size={16} />}
        {badge && <span class="tool-btn__badge">{badge}</span>}
      </span>
      {labels && <span class="tool-btn__label">{label}</span>}
    </button>
  );
}

export function Popover({ onClose, children }: { onClose: () => void; children: preact.ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !ref.current?.parentElement?.contains(event.target)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);
  return <div class="popover" ref={ref} role="menu">{children}</div>;
}
