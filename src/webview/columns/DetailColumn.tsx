import { useState } from 'preact/hooks';
import type { FileChange } from '../../git/status';
import type { ClientState, WebviewToExtensionMessage } from '../../panel/messages';
import { Icon } from '../lib/icons';
import { avatarColor, fullDate, initials, shortSha, splitPath } from '../lib/format';

type Props = {
  selectedCommit: ClientState['selectedCommit'];
  selectedCommitDetail: ClientState['selectedCommitDetail'];
  workingTreeStatus: ClientState['workingTreeStatus'];
  headBranch: string | undefined;
  dispatch: (message: WebviewToExtensionMessage) => void;
};

export function DetailColumn(props: Props) {
  return props.selectedCommit === 'working-tree' ? <StageView {...props} /> : <CommitView {...props} />;
}

function CommitView({ selectedCommit, selectedCommitDetail, dispatch }: Props) {
  if (!selectedCommitDetail) {
    return (
      <div class="detail" data-testid="detail-column">
        <div class="detail__head">
          <span class="detail__head-label">commit</span>
          <span class="sha">{shortSha(String(selectedCommit))}</span>
        </div>
        <p class="detail__empty">Loading commit…</p>
      </div>
    );
  }

  const detail = selectedCommitDetail;
  const [subject, ...rest] = detail.message.split('\n');
  const body = rest.join('\n').trim();

  return (
    <div class="detail" data-testid="detail-column">
      <div class="detail__head">
        <span class="detail__head-label">commit</span>
        <span class="sha">{shortSha(detail.sha)}</span>
      </div>

      <div class="detail__scroll">
        <div class="detail__message">
          <p class="detail__subject" data-testid="commit-message">{subject}</p>
          {body && <pre class="detail__body">{body}</pre>}
        </div>

        <div class="author">
          <span class="avatar" style={{ background: avatarColor(detail.author) }} aria-hidden="true">
            {initials(detail.author)}
          </span>
          <span>
            <span class="author__name">{detail.author}</span>
            <br />
            <span class="author__meta">authored {fullDate(detail.date)}</span>
          </span>
          {detail.parents.length > 0 && (
            <span class="author__parents">
              {detail.parents.length === 1 ? 'parent' : 'parents'}{' '}
              {detail.parents.map(parent => (
                <button
                  key={parent}
                  class="sha sha--link"
                  title={`Show ${parent}`}
                  onClick={() => dispatch({ type: 'graph:selectCommit', payload: { sha: parent } })}
                >
                  {shortSha(parent)}
                </button>
              ))}
            </span>
          )}
        </div>

        <div class="file-list">
          <div class="file-list__head">
            <span>Files</span>
            <span class="file-list__count">{detail.files.length}</span>
          </div>
          <ul>
            {detail.files.map(file => (
              <li key={file.path} class="file-row" data-testid={`detail-file-${file.path}`}>
                <StatusMark status={file.status} />
                <FilePath path={file.path} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function StageView({ workingTreeStatus, headBranch, dispatch }: Props) {
  const [message, setMessage] = useState('');
  const [amend, setAmend] = useState(false);
  const { staged, unstaged, conflicted } = workingTreeStatus;
  const clean = staged.length + unstaged.length + conflicted.length === 0;

  return (
    <div class="detail" data-testid="detail-column">
      <div class="detail__head">
        <span class="detail__head-label">Working tree</span>
        {headBranch && <span class="sha">{headBranch}</span>}
      </div>

      <div class="detail__scroll">
        {clean && <p class="detail__empty">Nothing to commit. The working tree matches HEAD.</p>}

        {conflicted.length > 0 && (
          <section class="stage-section stage-section--conflict">
            <div class="file-list__head">
              <span>Conflicted</span>
              <span class="file-list__count">{conflicted.length}</span>
            </div>
            <ul>
              {conflicted.map(file => (
                <li key={file.path} class="file-row">
                  <StatusMark status="U" />
                  <FilePath path={file.path} />
                  <span class="file-row__actions">
                    <button
                      class="link-btn"
                      data-testid={`resolve-${file.path}`}
                      onClick={() => dispatch({ type: 'file:openConflict', payload: { path: file.path } })}
                    >
                      Resolve
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {unstaged.length > 0 && (
          <section class="stage-section">
            <div class="file-list__head">
              <span>Unstaged</span>
              <span class="file-list__count">{unstaged.length}</span>
            </div>
            <ul>
              {unstaged.map(file => (
                <li key={file.path} class="file-row" data-testid={`unstaged-${file.path}`}>
                  <StatusMark status={file.status} />
                  <FilePath path={file.path} />
                  <span class="file-row__actions">
                    <button
                      class="link-btn link-btn--danger"
                      aria-label={`discard-${file.path}`}
                      onClick={() => dispatch({ type: 'stage:discard', payload: { path: file.path } })}
                    >
                      Discard
                    </button>
                    <button
                      class="link-btn"
                      aria-label={`stage-${file.path}`}
                      onClick={() => dispatch({ type: 'stage:file', payload: { path: file.path } })}
                    >
                      Stage
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {staged.length > 0 && (
          <section class="stage-section">
            <div class="file-list__head">
              <span>Staged</span>
              <span class="file-list__count">{staged.length}</span>
            </div>
            <ul>
              {staged.map(file => (
                <li key={file.path} class="file-row" data-testid={`staged-${file.path}`}>
                  <StatusMark status={file.status} />
                  <FilePath path={file.path} />
                  <span class="file-row__actions">
                    <button
                      class="link-btn"
                      aria-label={`unstage-${file.path}`}
                      onClick={() => dispatch({ type: 'stage:unfile', payload: { path: file.path } })}
                    >
                      Unstage
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <div class="commit-box">
        <textarea
          class="commit-box__input"
          data-testid="commit-message-input"
          placeholder="Commit message"
          aria-label="Commit message"
          value={message}
          onInput={event => setMessage((event.target as HTMLTextAreaElement).value)}
        />
        <div class="commit-box__foot">
          <label class="commit-box__amend">
            <input
              type="checkbox"
              checked={amend}
              onChange={event => setAmend((event.target as HTMLInputElement).checked)}
            />
            Amend last commit
          </label>
          <button
            class="btn btn--primary"
            data-testid="commit-button"
            disabled={message.trim().length === 0}
            onClick={() => {
              dispatch({ type: 'commit:create', payload: { message, amend } });
              setMessage('');
              setAmend(false);
            }}
          >
            <Icon name="check" size={12} />
            {headBranch ? `Commit to ${headBranch}` : 'Commit'}
          </button>
        </div>
      </div>
    </div>
  );
}

const STATUS_TITLE: Record<FileChange['status'], string> = {
  A: 'Added',
  M: 'Modified',
  D: 'Deleted',
  R: 'Renamed',
  U: 'Conflicted',
};

function StatusMark({ status }: { status: FileChange['status'] }) {
  return <span class="status-mark" data-status={status} title={STATUS_TITLE[status] ?? status}>{status}</span>;
}

function FilePath({ path }: { path: string }) {
  const { dir, name } = splitPath(path);
  return (
    <span class="file-row__path" title={path}>
      {dir && <span class="file-row__dir"><bdi>{dir}</bdi></span>}
      <span class="file-row__name">{name}</span>
    </span>
  );
}
