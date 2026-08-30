import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { FileChange } from '../../git/status';
import type { ClientState, DiffSource, WebviewToExtensionMessage } from '../../panel/messages';
import type { MenuItem } from '../components/ContextMenu';
import type { SplitProps, SplitKey } from '../lib/useSplit';
import type { Ui } from '../lib/ui';
import { Icon } from '../lib/icons';
import { avatarColor, fullDate, initials, shortSha, splitPath } from '../lib/format';

type Props = {
  selectedCommit: ClientState['selectedCommit'];
  selectedCommitDetail: ClientState['selectedCommitDetail'];
  workingTreeStatus: ClientState['workingTreeStatus'];
  openFile: ClientState['openFile'];
  headBranch: string | undefined;
  splitProps: (key: SplitKey) => SplitProps;
  ui: Ui;
  dispatch: (message: WebviewToExtensionMessage) => void;
};

export function DetailColumn(props: Props) {
  return props.selectedCommit === 'working-tree' ? <StageView {...props} /> : <CommitView {...props} />;
}

/** Rows share one shape across the commit and working-tree views. */
function useFileActions({ openFile, ui, dispatch }: Props) {
  const copy = (text: string) => dispatch({ type: 'clipboard:write', payload: { text } });

  const show = (path: string, source: DiffSource, sha: string) =>
    dispatch({ type: 'file:openDiff', payload: { path, source, sha } });

  const isOpen = (path: string, source: DiffSource) =>
    openFile?.path === path && openFile.source === source;

  function baseMenu(path: string, source: DiffSource, sha: string): MenuItem[] {
    return [
      { kind: 'item', label: 'Show diff', onSelect: () => show(path, source, sha) },
      { kind: 'item', label: 'Open file in editor', onSelect: () => dispatch({ type: 'file:open', payload: { path } }) },
      { kind: 'item', label: 'Copy path', onSelect: () => copy(path) },
    ];
  }

  function workingMenu(file: FileChange, source: DiffSource): MenuItem[] {
    const items = baseMenu(file.path, source, 'working-tree');
    if (source === 'unstaged') {
      items.push(
        { kind: 'separator' },
        { kind: 'item', label: 'Stage file', onSelect: () => dispatch({ type: 'stage:file', payload: { path: file.path } }) },
        {
          kind: 'item',
          label: 'Discard changes',
          danger: true,
          onSelect: () => ui.openDialog({
            kind: 'confirm',
            title: 'Discard changes',
            body: `Every uncommitted change in ${file.path} is thrown away. This cannot be undone.`,
            confirmLabel: 'Discard changes',
            danger: true,
            onConfirm: () => dispatch({ type: 'stage:discard', payload: { path: file.path } }),
          }),
        },
      );
    }
    if (source === 'staged') {
      items.push(
        { kind: 'separator' },
        { kind: 'item', label: 'Unstage file', onSelect: () => dispatch({ type: 'stage:unfile', payload: { path: file.path } }) },
      );
    }
    return items;
  }

  return { show, isOpen, baseMenu, workingMenu, openMenu: ui.openMenu };
}

function CommitView(props: Props) {
  const { selectedCommit, selectedCommitDetail, splitProps, dispatch } = props;
  const files = useFileActions(props);

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

      <div class="detail__top">
        <div class="detail__message">
          <p class="detail__subject" data-testid="commit-message">{subject}</p>
          {body && <pre class="detail__body">{body}</pre>}
        </div>
      </div>

      <div {...splitProps('detailTop')} />

      <div class="detail__scroll">
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
              <li
                key={file.path}
                class="file-row"
                data-active={files.isOpen(file.path, 'commit')}
                data-testid={`detail-file-${file.path}`}
                onContextMenu={event => files.openMenu(event, files.baseMenu(file.path, 'commit', detail.sha))}
              >
                <StatusMark status={file.status} />
                <button class="file-row__open" onClick={() => files.show(file.path, 'commit', detail.sha)}>
                  <FilePath path={file.path} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function StageView(props: Props) {
  const { workingTreeStatus, headBranch, splitProps, dispatch } = props;
  const files = useFileActions(props);
  const [message, setMessage] = useState('');
  const [amend, setAmend] = useState(false);
  const { staged, unstaged, conflicted } = workingTreeStatus;
  const clean = staged.length + unstaged.length + conflicted.length === 0;

  const row = (file: FileChange, source: DiffSource, actions: ComponentChildren) => (
    <li
      key={file.path}
      class="file-row"
      data-active={files.isOpen(file.path, source)}
      data-testid={`${source}-${file.path}`}
      onContextMenu={event => files.openMenu(event, files.workingMenu(file, source))}
    >
      <StatusMark status={file.status} />
      <button class="file-row__open" onClick={() => files.show(file.path, source, 'working-tree')}>
        <FilePath path={file.path} />
      </button>
      <span class="file-row__actions">{actions}</span>
    </li>
  );

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
                <li
                  key={file.path}
                  class="file-row"
                  onContextMenu={event => files.openMenu(event, files.baseMenu(file.path, 'unstaged', 'working-tree'))}
                >
                  <StatusMark status="U" />
                  <button
                    class="file-row__open"
                    data-testid={`resolve-${file.path}`}
                    onClick={() => dispatch({ type: 'file:open', payload: { path: file.path } })}
                  >
                    <FilePath path={file.path} />
                  </button>
                  <span class="file-row__actions">
                    <button class="link-btn" onClick={() => dispatch({ type: 'file:open', payload: { path: file.path } })}>
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
              {unstaged.map(file => row(file, 'unstaged', (
                <>
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
                </>
              )))}
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
              {staged.map(file => row(file, 'staged', (
                <button
                  class="link-btn"
                  aria-label={`unstage-${file.path}`}
                  onClick={() => dispatch({ type: 'stage:unfile', payload: { path: file.path } })}
                >
                  Unstage
                </button>
              )))}
            </ul>
          </section>
        )}
      </div>

      <div {...splitProps('commitBox')} />

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
