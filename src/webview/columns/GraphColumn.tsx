import type { ClientState, WebviewToExtensionMessage } from '../../panel/messages';

type Props = {
  commitLog: ClientState['commitLog'];
  selectedCommit: ClientState['selectedCommit'];
  dispatch: (message: WebviewToExtensionMessage) => void;
};

export function GraphColumn({ commitLog, selectedCommit, dispatch }: Props) {
  return (
    <div class="column" data-testid="graph-column">
      <button
        data-testid="select-working-tree"
        aria-pressed={selectedCommit === 'working-tree'}
        onClick={() => dispatch({ type: 'graph:selectCommit', payload: { sha: 'working-tree' } })}
      >
        Working Tree
      </button>
      <ul>
        {commitLog.map(commit => (
          <li key={commit.sha} data-testid={`commit-${commit.sha}`} style={{ paddingLeft: `${commit.lane * 16}px` }}>
            <button
              aria-pressed={selectedCommit === commit.sha}
              onClick={() => dispatch({ type: 'graph:selectCommit', payload: { sha: commit.sha } })}
            >
              {commit.message}
            </button>
          </li>
        ))}
      </ul>
      <button data-testid="load-more" onClick={() => dispatch({ type: 'graph:loadMore' })}>
        Load more
      </button>
    </div>
  );
}
