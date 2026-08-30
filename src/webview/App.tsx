import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ClientState, WebviewToExtensionMessage } from '../panel/messages';
import { getVsCodeApi, onExtensionMessage } from './lib/vscodeApi';
import { Toolbar } from './components/Toolbar';
import { BranchesColumn } from './columns/BranchesColumn';
import { GraphColumn } from './columns/GraphColumn';
import { DetailColumn } from './columns/DetailColumn';

const EMPTY_STATE: ClientState = {
  repoName: '',
  branches: { local: [], remote: [] },
  tags: [],
  commitLog: [],
  selectedRefFilter: [],
  selectedCommit: 'working-tree',
  selectedCommitDetail: null,
  workingTreeStatus: { staged: [], unstaged: [], conflicted: [] },
};

const LIMITS = { sidebar: [180, 460], detail: [300, 720] } as const;
const DEFAULT_WIDTHS = { sidebar: 260, detail: 420 };

type Edge = keyof typeof DEFAULT_WIDTHS;

export function useClientState(): [ClientState, (message: WebviewToExtensionMessage) => void] {
  const [state, setState] = useState<ClientState>(EMPTY_STATE);

  useEffect(() => onExtensionMessage(message => {
    if (message.type === 'state:update') {
      setState(prev => ({ ...prev, ...message.payload }));
    }
  }), []);

  const dispatch = (message: WebviewToExtensionMessage) => getVsCodeApi().postMessage(message);
  return [state, dispatch];
}

/** Pane widths live in the webview's own persisted state so they survive a panel reload. */
function usePaneWidths() {
  const [widths, setWidths] = useState(() => {
    const stored = getVsCodeApi().getState() as { widths?: typeof DEFAULT_WIDTHS } | undefined;
    return { ...DEFAULT_WIDTHS, ...stored?.widths };
  });
  const drag = useRef<{ edge: Edge; startX: number; startWidth: number } | null>(null);
  const [dragging, setDragging] = useState<Edge | null>(null);

  useEffect(() => {
    getVsCodeApi().setState({ widths });
  }, [widths]);

  function onPointerDown(edge: Edge, event: PointerEvent): void {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag.current = { edge, startX: event.clientX, startWidth: widths[edge] };
    setDragging(edge);
  }

  function onPointerMove(event: PointerEvent): void {
    const active = drag.current;
    if (!active) return;
    const delta = event.clientX - active.startX;
    const [min, max] = LIMITS[active.edge];
    const raw = active.edge === 'sidebar' ? active.startWidth + delta : active.startWidth - delta;
    setWidths(prev => ({ ...prev, [active.edge]: Math.max(min, Math.min(max, raw)) }));
  }

  function onPointerUp(event: PointerEvent): void {
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    drag.current = null;
    setDragging(null);
  }

  function resizeProps(edge: Edge) {
    return {
      class: 'splitter',
      role: 'separator' as const,
      'aria-orientation': 'vertical' as const,
      'aria-label': `Resize ${edge} pane`,
      'data-dragging': dragging === edge,
      onPointerDown: (event: PointerEvent) => onPointerDown(edge, event),
      onPointerMove,
      onPointerUp,
    };
  }

  return { widths, resizeProps };
}

export function App() {
  const [state, dispatch] = useClientState();
  const { widths, resizeProps } = usePaneWidths();

  const head = useMemo(() => state.branches.local.find(branch => branch.isHead), [state.branches.local]);
  const remoteNames = useMemo(() => state.branches.remote.map(group => group.remoteName), [state.branches.remote]);

  const style = {
    '--sidebar-w': `${widths.sidebar}px`,
    '--detail-w': `${widths.detail}px`,
  } as Record<string, string>;

  return (
    <div class="git-client-app" data-testid="git-client-app">
      <Toolbar repoName={state.repoName} head={head} dispatch={dispatch} />

      <div class="panes" style={style}>
        <BranchesColumn
          branches={state.branches}
          tags={state.tags}
          selectedRefFilter={state.selectedRefFilter}
          dispatch={dispatch}
        />
        <div {...resizeProps('sidebar')} />
        <div class="pane pane--graph">
          <GraphColumn
            commitLog={state.commitLog}
            selectedCommit={state.selectedCommit}
            remoteNames={remoteNames}
            workingTreeStatus={state.workingTreeStatus}
            dispatch={dispatch}
          />
        </div>
        <div {...resizeProps('detail')} />
        <div class="pane">
          <DetailColumn
            selectedCommit={state.selectedCommit}
            selectedCommitDetail={state.selectedCommitDetail}
            workingTreeStatus={state.workingTreeStatus}
            headBranch={head?.name}
            dispatch={dispatch}
          />
        </div>
      </div>
    </div>
  );
}
