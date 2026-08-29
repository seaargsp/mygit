import { useState } from 'preact/hooks';
import type { ClientState, WebviewToExtensionMessage } from '../../panel/messages';

type Props = {
  selectedCommit: ClientState['selectedCommit'];
  selectedCommitDetail: ClientState['selectedCommitDetail'];
  workingTreeStatus: ClientState['workingTreeStatus'];
  dispatch: (message: WebviewToExtensionMessage) => void;
};

export function DetailColumn({ selectedCommit, selectedCommitDetail, workingTreeStatus, dispatch }: Props) {
  const [message, setMessage] = useState('');
  const [amend, setAmend] = useState(false);

  if (selectedCommit !== 'working-tree') {
    if (!selectedCommitDetail) return <div class="column" data-testid="detail-column">Loading…</div>;
    return (
      <div class="column" data-testid="detail-column">
        <p data-testid="commit-message">{selectedCommitDetail.message}</p>
        <p>{selectedCommitDetail.author} · {selectedCommitDetail.date}</p>
        <ul>
          {selectedCommitDetail.files.map(file => (
            <li key={file.path} data-testid={`detail-file-${file.path}`}>{file.status} {file.path}</li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div class="column" data-testid="detail-column">
      {workingTreeStatus.conflicted.length > 0 && (
        <section>
          <h3>Conflicted</h3>
          <ul>
            {workingTreeStatus.conflicted.map(file => (
              <li key={file.path}>
                <button
                  data-testid={`resolve-${file.path}`}
                  onClick={() => dispatch({ type: 'file:openConflict', payload: { path: file.path } })}
                >
                  {file.path}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h3>Unstaged</h3>
        <ul>
          {workingTreeStatus.unstaged.map(file => (
            <li key={file.path} data-testid={`unstaged-${file.path}`}>
              {file.status} {file.path}
              <button aria-label={`stage-${file.path}`} onClick={() => dispatch({ type: 'stage:file', payload: { path: file.path } })}>
                Stage
              </button>
              <button aria-label={`discard-${file.path}`} onClick={() => dispatch({ type: 'stage:discard', payload: { path: file.path } })}>
                Discard
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3>Staged</h3>
        <ul>
          {workingTreeStatus.staged.map(file => (
            <li key={file.path} data-testid={`staged-${file.path}`}>
              {file.status} {file.path}
              <button aria-label={`unstage-${file.path}`} onClick={() => dispatch({ type: 'stage:unfile', payload: { path: file.path } })}>
                Unstage
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <textarea
          data-testid="commit-message-input"
          value={message}
          onInput={e => setMessage((e.target as HTMLTextAreaElement).value)}
        />
        <label>
          <input type="checkbox" checked={amend} onChange={e => setAmend((e.target as HTMLInputElement).checked)} />
          Amend
        </label>
        <button
          data-testid="commit-button"
          disabled={message.trim().length === 0}
          onClick={() => dispatch({ type: 'commit:create', payload: { message, amend } })}
        >
          Commit
        </button>
      </section>
    </div>
  );
}
