import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ClientState, WebviewToExtensionMessage } from '../panel/messages';
import { getVsCodeApi, onExtensionMessage } from './lib/vscodeApi';
import { useSplit } from './lib/useSplit';
import type { Ui } from './lib/ui';
import { ContextMenu, type MenuItem, type MenuRequest } from './components/ContextMenu';
import { Dialog, type DialogRequest } from './components/Dialog';
import { Toolbar } from './components/Toolbar';
import { BranchesColumn } from './columns/BranchesColumn';
import { GraphColumn } from './columns/GraphColumn';
import { DiffView } from './columns/DiffView';
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
  openFile: null,
  fileDiff: null,
};

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

/**
 * The diff needs the width the branches pane is holding, so opening one collapses
 * the sidebar and closing it gives back whatever the user had.
 */
function useSidebarCollapse(diffOpen: boolean) {
  const [collapsed, setCollapsed] = useState(false);
  const auto = useRef(false);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (diffOpen && !wasOpen.current && !collapsed) {
      setCollapsed(true);
      auto.current = true;
    } else if (!diffOpen && wasOpen.current && auto.current) {
      setCollapsed(false);
      auto.current = false;
    }
    wasOpen.current = diffOpen;
  }, [diffOpen]);

  const toggle = useCallback(() => {
    auto.current = false;
    setCollapsed(value => !value);
  }, []);

  return { collapsed, toggle };
}

export function App() {
  const [state, dispatch] = useClientState();
  const { sizes, splitProps } = useSplit();
  const { collapsed, toggle } = useSidebarCollapse(state.openFile !== null);
  const [menu, setMenu] = useState<MenuRequest | null>(null);
  const [dialog, setDialog] = useState<DialogRequest | null>(null);

  const ui: Ui = useMemo(() => ({
    openMenu(event: MouseEvent, items: MenuItem[]) {
      event.preventDefault();
      event.stopPropagation();
      if (items.length > 0) setMenu({ x: event.clientX, y: event.clientY, items });
    },
    openDialog: setDialog,
  }), []);

  const head = useMemo(() => state.branches.local.find(branch => branch.isHead), [state.branches.local]);
  const remoteNames = useMemo(() => state.branches.remote.map(group => group.remoteName), [state.branches.remote]);

  const style = {
    '--sidebar-w': `${sizes.sidebar}px`,
    '--detail-w': `${sizes.detail}px`,
    '--detail-top-h': `${sizes.detailTop}px`,
    '--commit-box-h': `${sizes.commitBox}px`,
  } as Record<string, string>;

  return (
    <div class="git-client-app" data-testid="git-client-app">
      <Toolbar
        repoName={state.repoName}
        head={head}
        sidebarCollapsed={collapsed}
        onToggleSidebar={toggle}
        ui={ui}
        dispatch={dispatch}
      />

      <div class="panes" data-sidebar={collapsed ? 'collapsed' : 'open'} style={style}>
        {!collapsed && (
          <>
            <BranchesColumn
              branches={state.branches}
              tags={state.tags}
              selectedRefFilter={state.selectedRefFilter}
              headBranch={head?.name}
              ui={ui}
              dispatch={dispatch}
            />
            <div {...splitProps('sidebar')} />
          </>
        )}

        <div class="pane pane--graph">
          {state.openFile
            ? <DiffView openFile={state.openFile} diff={state.fileDiff} dispatch={dispatch} />
            : (
              <GraphColumn
                commitLog={state.commitLog}
                selectedCommit={state.selectedCommit}
                remoteNames={remoteNames}
                workingTreeStatus={state.workingTreeStatus}
                headBranch={head?.name}
                ui={ui}
                dispatch={dispatch}
              />
            )}
        </div>

        <div {...splitProps('detail')} />

        <div class="pane">
          <DetailColumn
            selectedCommit={state.selectedCommit}
            selectedCommitDetail={state.selectedCommitDetail}
            workingTreeStatus={state.workingTreeStatus}
            openFile={state.openFile}
            headBranch={head?.name}
            splitProps={splitProps}
            ui={ui}
            dispatch={dispatch}
          />
        </div>
      </div>

      {menu && <ContextMenu request={menu} onClose={() => setMenu(null)} />}
      {dialog && <Dialog request={dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}
