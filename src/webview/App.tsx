import { useEffect, useState } from 'preact/hooks';
import type { ClientState, WebviewToExtensionMessage } from '../panel/messages';
import { getVsCodeApi, onExtensionMessage } from './lib/vscodeApi';
import { BranchesColumn } from './columns/BranchesColumn';
import { GraphColumn } from './columns/GraphColumn';
import { DetailColumn } from './columns/DetailColumn';

const EMPTY_STATE: ClientState = {
  branches: { local: [], remote: [] },
  tags: [],
  commitLog: [],
  selectedRefFilter: [],
  selectedCommit: 'working-tree',
  selectedCommitDetail: null,
  workingTreeStatus: { staged: [], unstaged: [], conflicted: [] },
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

export function App() {
  const [state, dispatch] = useClientState();
  return (
    <div class="git-client-app" data-testid="git-client-app">
      <BranchesColumn branches={state.branches} tags={state.tags} dispatch={dispatch} />
      <GraphColumn commitLog={state.commitLog} selectedCommit={state.selectedCommit} dispatch={dispatch} />
      <DetailColumn
        selectedCommit={state.selectedCommit}
        selectedCommitDetail={state.selectedCommitDetail}
        workingTreeStatus={state.workingTreeStatus}
        dispatch={dispatch}
      />
    </div>
  );
}
