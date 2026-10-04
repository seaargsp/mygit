import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ClientState, WebviewAction, WebviewToExtensionMessage } from '../panel/messages';
import { DEFAULT_REPO_PREFS } from '../panel/messages';
import { getVsCodeApi, onExtensionMessage } from './lib/vscodeApi';
import { useSplit } from './lib/useSplit';
import type { Ctx, InlineRequest, Ui } from './lib/ui';
import { ContextMenu, type MenuItem, type MenuRequest } from './components/ContextMenu';
import { Dialog, type DialogRequest } from './components/Dialog';
import { Toolbar } from './components/Toolbar';
import { Banners } from './components/Banners';
import { ActivityLogPanel } from './components/ActivityLogPanel';
import { shortcutsDialog } from './components/Shortcuts';
import { LeftPanel } from './columns/LeftPanel';
import { GraphColumn, type SearchState } from './columns/GraphColumn';
import { DiffView } from './columns/DiffView';
import { HistoryView, BlameView } from './columns/HistoryViews';
import { MergeTool } from './columns/MergeTool';
import { RebaseView } from './columns/RebaseView';
import { CommitPanel } from './columns/CommitPanel';
import { Icon } from './lib/icons';
import { setDatePrefs, plural } from './lib/format';
import { emit, isTyping, primary } from './lib/events';
import { usePersisted } from './lib/persist';
import { NONE, createFileDialog, renameDialog, send, sparseDialog, templateDialog } from './lib/actions';

const EMPTY_STATE: ClientState = {
  noRepo: false,
  repoName: '',
  head: { branch: null, sha: null, detached: false, upstream: null, ahead: 0, behind: 0, pushed: false, message: null },
  branches: { local: [], remote: [] },
  remotes: [],
  tags: [],
  stashes: [],
  commitLog: [],
  hasMore: false,
  selection: ['working-tree'],
  selectionView: { kind: 'wip' },
  view: { kind: 'graph' },
  workingTreeStatus: { staged: [], unstaged: [], conflicted: [], branch: { oid: null, head: null, upstream: null, ahead: 0, behind: 0 } },
  repo: null,
  template: null,
  prefs: {
    dateFormat: 'relative', dateLocale: '', authorDisplay: 'initials', graphMetadata: ['branches', 'tags'], highlightOnBranchHover: true,
    showToolbarLabels: true, squashMerge: false, gpgSign: false, lazyLoad: true, showAllCommits: false, applyCommitTemplate: true,
    removeTemplateComments: true, conflictDetection: true,
  },
  repoPrefs: DEFAULT_REPO_PREFS,
  targetBranch: null,
  undo: { undo: null, redo: null },
  log: { app: [], repo: [] },
  conflicts: { checking: false, checkedAt: null, results: [] },
  allFiles: null,
  busy: null,
  avatars: {},
};

export function useClientState(onAction: (action: WebviewAction) => void): [ClientState, (message: WebviewToExtensionMessage) => void] {
  const [state, setState] = useState<ClientState>(EMPTY_STATE);
  const actionRef = useRef(onAction);
  actionRef.current = onAction;

  useEffect(() => {
    const off = onExtensionMessage(message => {
      if (message.type === 'state:update') setState(prev => ({ ...prev, ...message.payload }));
      else if (message.type === 'action') actionRef.current(message.payload.action);
    });
    getVsCodeApi().postMessage({ type: 'ready', payload: {} });
    return off;
  }, []);

  const dispatch = useCallback((message: WebviewToExtensionMessage) => getVsCodeApi().postMessage(message), []);
  return [state, dispatch];
}

/** Centre views other than the graph want the width the Left Panel holds; closing them gives it back. */
function useAutoCollapse(viewOpen: boolean, collapsed: boolean, setCollapsed: (value: boolean) => void) {
  const auto = useRef(false);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (viewOpen && !wasOpen.current && !collapsed) {
      setCollapsed(true);
      auto.current = true;
    } else if (!viewOpen && wasOpen.current && auto.current) {
      setCollapsed(false);
      auto.current = false;
    }
    wasOpen.current = viewOpen;
  }, [viewOpen]);
  return () => {
    auto.current = false;
  };
}

function searchMatches(state: ClientState, query: string): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return state.commitLog
    .filter(commit => !commit.stash && (
      commit.message.toLowerCase().includes(needle)
      || commit.body.toLowerCase().includes(needle)
      || commit.sha.startsWith(needle)
      || commit.author.toLowerCase().includes(needle)
      || commit.authorEmail.toLowerCase().includes(needle)
    ))
    .map(commit => commit.sha);
}

export function App() {
  const actionHandler = useRef<(action: WebviewAction) => void>(() => undefined);
  const [state, dispatch] = useClientState(action => actionHandler.current(action));
  const { sizes, splitProps } = useSplit();
  const [leftCollapsed, setLeftCollapsed] = usePersisted('leftHidden', false);
  const [detailCollapsed, setDetailCollapsed] = usePersisted('detailHidden', false);
  const [logOpen, setLogOpen] = usePersisted('logOpen', false);
  const [menu, setMenu] = useState<MenuRequest | null>(null);
  const [dialog, setDialog] = useState<DialogRequest | null>(null);
  const [inline, setInline] = useState<InlineRequest | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [reveal, setReveal] = useState<{ sha: string; nonce: number } | null>(null);
  const [query, setQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);
  const [wipLabel, setWipLabel] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  setDatePrefs(state.prefs);
  const viewOpen = state.view.kind !== 'graph';
  const cancelAuto = useAutoCollapse(viewOpen, leftCollapsed, setLeftCollapsed);

  const ui: Ui = useMemo(() => ({
    openMenu(event: MouseEvent, items: MenuItem[]) {
      event.preventDefault();
      event.stopPropagation();
      if (items.length > 0) setMenu({ x: event.clientX, y: event.clientY, items });
    },
    openMenuAt(x: number, y: number, items: MenuItem[]) {
      if (items.length > 0) setMenu({ x, y, items });
    },
    openDialog: setDialog,
    startInline(request: InlineRequest) {
      if (stateRef.current.view.kind !== 'graph') dispatch({ type: 'view:close', payload: NONE });
      setInline(request);
    },
    revealCommit(sha: string) {
      if (stateRef.current.view.kind !== 'graph') dispatch({ type: 'view:close', payload: NONE });
      dispatch({ type: 'graph:select', payload: { shas: [sha] } });
      setReveal({ sha, nonce: Date.now() });
    },
    startRename(branch: string) {
      if (leftCollapsedRef.current) {
        renameDialog({ state: stateRef.current, dispatch, ui }, branch);
        return;
      }
      setRenaming(branch);
    },
  }), []);
  const leftCollapsedRef = useRef(leftCollapsed);
  leftCollapsedRef.current = leftCollapsed;

  const ctx: Ctx = { state, dispatch, ui };

  // ------------------------------------------------------------ search

  const matches = useMemo(() => searchMatches(state, query), [state.commitLog, query]);
  const matchSet = useMemo(() => new Set(matches), [matches]);
  useEffect(() => setSearchIndex(0), [query]);
  const search: SearchState = {
    active: query.trim().length > 0,
    matches: matchSet,
    current: matches[Math.min(searchIndex, matches.length - 1)] ?? null,
  };

  function stepSearch(delta: 1 | -1): void {
    if (matches.length === 0) return;
    const next = (searchIndex + delta + matches.length) % matches.length;
    setSearchIndex(next);
    dispatch({ type: 'graph:select', payload: { shas: [matches[next]] } });
  }

  // ------------------------------------------------------------ extension actions and shortcuts

  actionHandler.current = (action: WebviewAction) => {
    const current = stateRef.current;
    const currentCtx: Ctx = { state: current, dispatch, ui };
    switch (action) {
      case 'createBranch':
        if (current.head.sha) ui.startInline({ kind: 'branch', sha: current.head.sha });
        return;
      case 'focusMessage':
        if (current.selectionView.kind !== 'wip') send(currentCtx, 'graph:select', { shas: ['working-tree'] });
        setDetailCollapsed(false);
        window.setTimeout(() => emit({ kind: 'focusMessage' }), 60);
        return;
      case 'find':
        if (current.view.kind !== 'graph') emit({ kind: 'find' });
        else {
          searchRef.current?.focus();
          searchRef.current?.select();
        }
        return;
      case 'focusFilter':
        setLeftCollapsed(false);
        window.setTimeout(() => filterRef.current?.focus(), 30);
        return;
      case 'toggleLeft':
        cancelAuto();
        setLeftCollapsed(value => !value);
        return;
      case 'toggleDetail':
        setDetailCollapsed(value => !value);
        return;
      case 'shortcuts':
        setDialog(shortcutsDialog());
        return;
      case 'activityLog':
        setLogOpen(true);
        return;
      case 'externalDiff':
        emit({ kind: 'externalDiff' });
        return;
      case 'renameBranch':
        if (current.head.branch) renameDialog(currentCtx, current.head.branch);
        return;
      case 'createFile':
        createFileDialog(currentCtx);
        return;
      case 'commitTemplate':
        templateDialog(currentCtx);
        return;
      case 'sparseCheckout':
        sparseDialog(currentCtx);
        return;
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (menu || dialog) return;
      const typing = isTyping(event.target);
      if (event.key === 'Escape') {
        if (inline) setInline(null);
        else if (stateRef.current.view.kind !== 'graph') dispatch({ type: 'view:close', payload: NONE });
        else if (logOpen) setLogOpen(false);
        return;
      }
      if (event.key === 'Enter' && primary(event)) {
        event.preventDefault();
        emit({ kind: 'commit', stageAll: event.shiftKey });
        return;
      }
      if (typing || !primary(event)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        dispatch({ type: 'undo', payload: NONE });
      } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault();
        dispatch({ type: 'redo', payload: NONE });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menu, dialog, inline, logOpen]);

  // ------------------------------------------------------------ layout

  const style = {
    '--sidebar-w': `${sizes.sidebar}px`,
    '--detail-w': `${sizes.detail}px`,
    '--detail-top-h': `${sizes.detailTop}px`,
    '--commit-box-h': `${sizes.commitBox}px`,
    '--log-h': `${sizes.log}px`,
  } as Record<string, string>;

  const columns = [
    leftCollapsed ? null : 'var(--sidebar-w)',
    leftCollapsed ? null : '1px',
    'minmax(0, 1fr)',
    detailCollapsed ? null : '1px',
    detailCollapsed ? null : 'var(--detail-w)',
  ].filter(Boolean).join(' ');

  const view = state.view;
  let centre;
  switch (view.kind) {
    case 'diff':
      centre = <DiffView ctx={ctx} view={view} />;
      break;
    case 'history':
      centre = <HistoryView ctx={ctx} view={view} />;
      break;
    case 'blame':
      centre = <BlameView ctx={ctx} view={view} />;
      break;
    case 'merge':
      centre = <MergeTool ctx={ctx} view={view} />;
      break;
    case 'rebase':
      centre = <RebaseView ctx={ctx} view={view} />;
      break;
    default:
      centre = (
        <GraphColumn
          ctx={ctx}
          search={search}
          inline={inline}
          onInlineDone={() => setInline(null)}
          reveal={reveal}
          wipLabel={wipLabel}
          setWipLabel={setWipLabel}
        />
      );
  }

  const loaded = state.commitLog.filter(commit => !commit.stash).length;

  return (
    <div class={`git-client-app${logOpen ? ' git-client-app--log' : ''}`} style={style} data-testid="git-client-app">
      <Toolbar
        ctx={ctx}
        leftCollapsed={leftCollapsed}
        onToggleLeft={() => {
          cancelAuto();
          setLeftCollapsed(value => !value);
        }}
        detailCollapsed={detailCollapsed}
        onToggleDetail={() => setDetailCollapsed(value => !value)}
        wipLabel={wipLabel}
        search={{ query, setQuery, count: matches.length, index: Math.min(searchIndex, Math.max(0, matches.length - 1)), step: stepSearch, inputRef: searchRef }}
      />

      <div class="panes" style={{ gridTemplateColumns: columns }}>
        {!leftCollapsed && (
          <>
            <LeftPanel ctx={ctx} filterRef={filterRef} renaming={renaming} onRenameDone={() => setRenaming(null)} />
            <div {...splitProps('sidebar')} />
          </>
        )}

        <div class="pane pane--graph">
          <Banners ctx={ctx} />
          {centre}
        </div>

        {!detailCollapsed && (
          <>
            <div {...splitProps('detail')} />
            <div class="pane pane--detail">
              <CommitPanel ctx={ctx} splitProps={splitProps} wipLabel={wipLabel} setWipLabel={setWipLabel} />
            </div>
          </>
        )}
      </div>

      {logOpen && (
        <>
          <div {...splitProps('log')} />
          <ActivityLogPanel ctx={ctx} onClose={() => setLogOpen(false)} />
        </>
      )}

      <footer class="statusbar">
        <span class={`statusbar__busy${state.busy ? ' statusbar__busy--on' : ''}`}>
          {state.busy ? <><span class="spinner" aria-hidden="true" />{state.busy}…</> : 'Ready'}
        </span>
        <span class="statusbar__info">
          {plural(loaded, 'commit')} loaded{state.hasMore ? ' (more available)' : ''}
          {state.repoPrefs.solo.length > 0 && ' · solo active'}
          {state.repoPrefs.hidden.length > 0 && ` · ${state.repoPrefs.hidden.length} hidden`}
          {state.repoPrefs.smartVisibility && ' · smart branch visibility'}
        </span>
        <button class={`statusbar__btn${logOpen ? ' statusbar__btn--on' : ''}`} onClick={() => setLogOpen(open => !open)} title="Activity Log">
          <Icon name="log" size={13} /> Activity Log
        </button>
        <button class="statusbar__btn" onClick={() => setDialog(shortcutsDialog())} title="Keyboard shortcuts">
          <Icon name="keyboard" size={13} />
        </button>
      </footer>

      {menu && <ContextMenu request={menu} onClose={() => setMenu(null)} />}
      {dialog && <Dialog request={dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}
