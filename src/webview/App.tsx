import { useEffect, useState } from 'preact/hooks';
import type { ClientState, WebviewToExtensionMessage } from '../panel/messages';
import { getVsCodeApi, onExtensionMessage } from './lib/vscodeApi';

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
  useClientState();
  return (
    <div class="git-client-app" data-testid="git-client-app">
      <div class="column" data-testid="branches-column">Branches</div>
      <div class="column" data-testid="graph-column">Graph</div>
      <div class="column" data-testid="detail-column">Detail</div>
    </div>
  );
}
