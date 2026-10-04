import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { FileChange } from '../../git/status';
import type { CommitDetail } from '../../git/commit';
import type { OpenFile, SelectionView } from '../../panel/messages';
import type { SplitKey, SplitProps } from '../lib/useSplit';
import type { Ctx } from '../lib/ui';
import { FileList, type FileViewMode } from '../components/FileList';
import { Icon } from '../lib/icons';
import { avatarColor, fullDate, initials, plural, shortSha } from '../lib/format';
import {
  NONE, commitFileMenu, createFileDialog, discardAllDialog, discardFilesDialog, revisionFileMenu, send, stashMenu, wipFileMenu, type FileRef,
} from '../lib/actions';
import { listen, primary } from '../lib/events';
import { usePersisted } from '../lib/persist';
import { confirmDialog } from '../components/Dialog';

type Props = {
  ctx: Ctx;
  splitProps: (key: SplitKey) => SplitProps;
  wipLabel: string;
  setWipLabel: (label: string) => void;
};

function activePath(ctx: Ctx, source: OpenFile['source']): string | null {
  const view = ctx.state.view;
  return view.kind === 'diff' && view.file.source === source ? view.file.path : null;
}

export function CommitPanel(props: Props) {
  const view = props.ctx.state.selectionView;
  switch (view.kind) {
    case 'wip':
      return <WipPanel {...props} />;
    case 'loading':
      return (
        <div class="detail">
          <div class="detail__head"><span class="detail__head-label">Loading…</span></div>
        </div>
      );
    case 'commit':
      return <CommitDetails {...props} detail={view.detail} isHead={view.isHead} />;
    case 'stash':
      return <StashDetails {...props} view={view} />;
    case 'range':
      return <RangeDetails {...props} view={view} />;
    case 'unavailable':
      return (
        <div class="detail">
          <div class="detail__head"><span class="detail__head-label">{plural(view.count, 'item')} selected</span></div>
          <p class="detail__empty">{view.reason}</p>
        </div>
      );
  }
}

/** Path / Tree toggle and "View all files" switch shared by the panel headers. */
function ListControls({ mode, setMode, allFiles, setAllFiles }: { mode: FileViewMode; setMode: (mode: FileViewMode) => void; allFiles?: boolean; setAllFiles?: (on: boolean) => void }) {
  return (
    <span class="list-controls">
      {setAllFiles && (
        <button class={`chip${allFiles ? ' chip--on' : ''}`} aria-pressed={allFiles} title="View all files" onClick={() => setAllFiles(!allFiles)}>
          All files
        </button>
      )}
      <button class={`icon-btn icon-btn--small${mode === 'path' ? ' icon-btn--active' : ''}`} aria-label="Path view" title="Path view" onClick={() => setMode('path')}>
        <Icon name="list" size={12} />
      </button>
      <button class={`icon-btn icon-btn--small${mode === 'tree' ? ' icon-btn--active' : ''}`} aria-label="Tree view" title="Tree view" onClick={() => setMode('tree')}>
        <Icon name="tree" size={12} />
      </button>
    </span>
  );
}

/** Every file of the repository (or of a commit's tree) with a live filter. */
function AllFiles({ ctx, rev, mode, changed, onOpen, onMenu }: {
  ctx: Ctx;
  rev: string;
  mode: FileViewMode;
  changed: FileChange[];
  onOpen: (file: FileChange) => void;
  onMenu: (event: MouseEvent, files: FileChange[]) => void;
}) {
  const [filter, setFilter] = useState('');
  useEffect(() => {
    send(ctx, 'files:listAll', { rev });
    return () => send(ctx, 'files:listAll', { rev: null });
  }, [rev]);
  const all = ctx.state.allFiles?.rev === rev ? ctx.state.allFiles.files : null;
  const byPath = useMemo(() => new Map(changed.map(file => [file.path, file])), [changed]);
  const query = filter.trim().toLowerCase();
  const files = useMemo(
    () => (all ?? []).filter(path => !query || path.toLowerCase().includes(query)).map(path => byPath.get(path) ?? { path, status: 'M' as const, unchanged: true }),
    [all, query, byPath]
  );
  return (
    <section class="stage-section">
      <div class="file-filter">
        <input class="field field--small" type="search" placeholder="Filter Files" aria-label="Filter files" value={filter} onInput={event => setFilter((event.target as HTMLInputElement).value)} />
      </div>
      {all === null ? <p class="detail__empty">Loading files…</p> : (
        <div class="all-files">
          <FileList files={files} mode={mode} onOpen={onOpen} onMenu={onMenu} />
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ WIP

function WipPanel({ ctx, splitProps, wipLabel, setWipLabel }: Props) {
  const { state } = ctx;
  const { workingTreeStatus, head, repo } = state;
  const { staged, unstaged, conflicted } = workingTreeStatus;
  const [mode, setMode] = usePersisted<FileViewMode>('fileMode', 'path');
  const [allFiles, setAllFiles] = useState(false);
  const operation = repo?.operation;
  const labels = operation
    ? { current: operation.kind === 'rebase' ? operation.current : operation.current, incoming: operation.incoming }
    : { current: head.branch ?? 'HEAD', incoming: 'incoming' };
  const total = new Set([...staged, ...unstaged, ...conflicted].map(file => file.path)).size;

  const open = (file: FileChange, source: 'staged' | 'unstaged') =>
    send(ctx, 'view:openFile', { file: { path: file.path, source, sha: 'working-tree', untracked: file.untracked, status: file.status } });
  const refs = (files: FileChange[], source: 'staged' | 'unstaged'): FileRef[] => files.map(file => ({ ...file, source }));

  const onKey = (source: 'staged' | 'unstaged') => (key: string, files: FileChange[]) => {
    if (key === 's' && source === 'unstaged') {
      send(ctx, 'stage:paths', { paths: files.map(file => file.path) });
      return true;
    }
    if (key === 'u' && source === 'staged') {
      send(ctx, 'stage:unstagePaths', { paths: files.map(file => file.path) });
      return true;
    }
    return false;
  };

  return (
    <div class="detail" data-testid="detail-column">
      <div class="detail__head">
        <span class="detail__head-label">{total === 0 ? 'No changes' : `${plural(total, 'file')} changed`}</span>
        {head.branch && <span class="detail__head-meta">on <span class="sha">{head.branch}</span></span>}
        <ListControls mode={mode} setMode={setMode} allFiles={allFiles} setAllFiles={setAllFiles} />
      </div>

      <div
        class="detail__scroll"
        onContextMenu={event => {
          if ((event.target as HTMLElement).closest('.file-row')) return;
          ctx.ui.openMenu(event, [{ kind: 'item', label: 'Create File', onSelect: () => createFileDialog(ctx) }]);
        }}
      >
        {allFiles ? (
          <AllFiles
            ctx={ctx}
            rev="working-tree"
            mode={mode}
            changed={[...unstaged, ...staged]}
            onOpen={file => ('unchanged' in file ? send(ctx, 'file:open', { path: file.path }) : open(file, unstaged.some(entry => entry.path === file.path) ? 'unstaged' : 'staged'))}
            onMenu={(event, files) => ctx.ui.openMenu(event, [
              { kind: 'item', label: 'Edit file', onSelect: () => send(ctx, 'file:open', { path: files[0].path }) },
              { kind: 'item', label: 'File History', onSelect: () => send(ctx, 'view:history', { path: files[0].path }) },
              { kind: 'item', label: 'File Blame', onSelect: () => send(ctx, 'view:blame', { path: files[0].path, rev: 'working-tree' }) },
              { kind: 'separator' },
              { kind: 'item', label: files.length > 1 ? `Delete ${files.length} files` : 'Delete file', danger: true, onSelect: () => ctx.ui.openDialog(confirmDialog('Delete files', `${files.map(file => file.path).join(', ')} will be deleted from the working directory.`, 'Delete', () => send(ctx, 'file:delete', { paths: files.map(file => file.path) }), true)) },
              { kind: 'item', label: 'Copy file path', onSelect: () => send(ctx, 'clipboard:write', { text: files[0].path }) },
            ])}
          />
        ) : (
          <>
            {total === 0 && !operation && <p class="detail__empty">Nothing to commit. The working directory matches HEAD.</p>}

            {conflicted.length > 0 && (
              <section class="stage-section stage-section--conflict">
                <div class="file-list__head">
                  <Icon name="warning" size={12} />
                  <span>Conflicted Files</span>
                  <span class="file-list__count">{conflicted.length}</span>
                </div>
                <FileList
                  files={conflicted}
                  mode={mode}
                  testPrefix="resolve"
                  onOpen={file => send(ctx, 'view:merge', { path: file.path })}
                  onMenu={(event, files) => ctx.ui.openMenu(event, wipFileMenu(ctx, refs(files, 'unstaged'), labels))}
                  actions={file => (
                    <>
                      <button class="link-btn" title={`Take current (${labels.current})`} onClick={() => send(ctx, 'file:takeSide', { paths: [file.path], side: 'ours' })}>Current</button>
                      <button class="link-btn" title={`Take incoming (${labels.incoming})`} onClick={() => send(ctx, 'file:takeSide', { paths: [file.path], side: 'theirs' })}>Incoming</button>
                    </>
                  )}
                />
              </section>
            )}

            <section class="stage-section">
              <div class="file-list__head">
                <span>Unstaged Files</span>
                <span class="file-list__count">{unstaged.length}</span>
                <span class="file-list__actions">
                  {unstaged.length > 0 && (
                    <button class="icon-btn icon-btn--small" aria-label="Discard all changes" title="Discard all changes" onClick={() => discardAllDialog(ctx)}>
                      <Icon name="trash" size={12} />
                    </button>
                  )}
                  <button class="btn btn--small" disabled={unstaged.length === 0} onClick={() => send(ctx, 'stage:all', NONE)}>Stage all changes</button>
                </span>
              </div>
              <FileList
                files={unstaged}
                mode={mode}
                testPrefix="unstaged"
                activePath={activePath(ctx, 'unstaged')}
                onOpen={file => open(file, 'unstaged')}
                onMenu={(event, files) => ctx.ui.openMenu(event, wipFileMenu(ctx, refs(files, 'unstaged')))}
                onKey={onKey('unstaged')}
                actions={file => (
                  <>
                    <button class="link-btn link-btn--danger" aria-label={`discard-${file.path}`} title="Discard changes" onClick={() => discardFilesDialog(ctx, [file])}>
                      <Icon name="trash" size={11} />
                    </button>
                    <button class="link-btn" aria-label={`stage-${file.path}`} onClick={() => send(ctx, 'stage:paths', { paths: [file.path] })}>Stage File</button>
                  </>
                )}
              />
            </section>

            <section class="stage-section">
              <div class="file-list__head">
                <span>Staged Files</span>
                <span class="file-list__count">{staged.length}</span>
                <span class="file-list__actions">
                  <button class="btn btn--small" disabled={staged.length === 0} onClick={() => send(ctx, 'stage:unstageAll', NONE)}>Unstage all changes</button>
                </span>
              </div>
              <FileList
                files={staged}
                mode={mode}
                testPrefix="staged"
                activePath={activePath(ctx, 'staged')}
                onOpen={file => open(file, 'staged')}
                onMenu={(event, files) => ctx.ui.openMenu(event, wipFileMenu(ctx, refs(files, 'staged')))}
                onKey={onKey('staged')}
                actions={file => (
                  <button class="link-btn" aria-label={`unstage-${file.path}`} onClick={() => send(ctx, 'stage:unstagePaths', { paths: [file.path] })}>Unstage File</button>
                )}
              />
            </section>
          </>
        )}
      </div>

      <div {...splitProps('commitBox')} />
      <CommitBox ctx={ctx} wipLabel={wipLabel} setWipLabel={setWipLabel} />
    </div>
  );
}

type Draft = { summary: string; description: string };

function splitMessage(message: string | null | undefined): Draft {
  const [summary = '', ...rest] = (message ?? '').split('\n');
  return { summary, description: rest.join('\n').replace(/^\n+/, '') };
}

function CommitBox({ ctx, wipLabel, setWipLabel }: { ctx: Ctx; wipLabel: string; setWipLabel: (label: string) => void }) {
  const { state } = ctx;
  const { workingTreeStatus, head, repo, template, prefs } = state;
  const [draft, setDraft] = usePersisted<Draft>('commitDraft', { summary: '', description: '' });
  const [amend, setAmend] = useState(false);
  const [push, setPush] = useState(false);
  const [skipHooks, setSkipHooks] = useState(false);
  const [stashMode, setStashMode] = useState(false);
  const beforeAmend = useRef<Draft | null>(null);
  const pending = useRef<string | null>(null);
  const prefilled = useRef<string | null>(null);
  const summaryRef = useRef<HTMLInputElement>(null);
  const operation = repo?.operation;
  const staged = workingTreeStatus.staged.length;
  const changes = staged + workingTreeStatus.unstaged.length;

  // Prepared messages fill empty fields once: merge/revert (MERGE_MSG), squash (SQUASH_MSG), the template.
  useEffect(() => {
    const prepared = operation?.message ?? repo?.squashMessage ?? null;
    const key = prepared ? `prepared:${prepared}` : template && prefs.applyCommitTemplate ? `template:${template.summary}\n${template.description}` : null;
    if (!key || prefilled.current === key) return;
    if (draft.summary.trim() || draft.description.trim()) {
      prefilled.current = key;
      return;
    }
    prefilled.current = key;
    if (prepared) setDraft(splitMessage(prepared));
    else if (template) setDraft({ summary: template.summary, description: template.description });
  }, [operation?.message, repo?.squashMessage, template, prefs.applyCommitTemplate]);

  // A commit is done once HEAD moves; the fields clear then (a failed commit keeps them).
  useEffect(() => {
    if (pending.current === null || pending.current === head.sha) return;
    pending.current = null;
    setDraft(template && prefs.applyCommitTemplate ? { summary: template.summary, description: template.description } : { summary: '', description: '' });
    setAmend(false);
    setSkipHooks(false);
    beforeAmend.current = null;
  }, [head.sha]);

  useEffect(() => listen(event => {
    if (event.kind === 'focusMessage') summaryRef.current?.focus();
    if (event.kind === 'commit') submit(event.stageAll);
  }), [draft, amend, push, skipHooks, stashMode, staged, changes]);

  function toggleAmend(next: boolean): void {
    setAmend(next);
    if (next) {
      beforeAmend.current = draft;
      setDraft(splitMessage(head.message));
    } else if (beforeAmend.current) {
      setDraft(beforeAmend.current);
      beforeAmend.current = null;
    }
  }

  const merging = operation?.kind === 'merge';
  const canCommit = stashMode
    ? changes > 0
    : draft.summary.trim().length > 0 && (amend || merging || staged > 0);

  function submit(stageAll: boolean): void {
    if (stashMode) {
      if (changes === 0) return;
      send(ctx, 'stash:save', { message: draft.summary.trim() || wipLabel || undefined });
      setDraft({ summary: '', description: '' });
      setWipLabel('');
      setStashMode(false);
      return;
    }
    if (!draft.summary.trim()) {
      summaryRef.current?.focus();
      return;
    }
    if (!stageAll && !amend && !merging && staged === 0) return;
    if (stageAll && changes === 0 && !amend) return;
    pending.current = head.sha;
    send(ctx, 'commit:create', { summary: draft.summary, description: draft.description, amend, push, skipHooks, stageAll });
  }

  const label = stashMode
    ? 'Stash Changes'
    : merging
      ? 'Commit and Merge'
      : amend
        ? 'Amend Previous Commit'
        : push
          ? `Commit Changes to ${plural(staged, 'File')} and Push`
          : `Commit changes to ${plural(staged, 'file')}`;
  const length = draft.summary.length;

  const keyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && primary(event)) {
      event.preventDefault();
      event.stopPropagation();
      submit(event.shiftKey);
    }
  };

  return (
    <div class="commit-box">
      <div class="commit-box__row">
        <span class="commit-box__title">{stashMode ? 'Stash' : amend ? 'Amend' : 'Commit'}</span>
        <button
          class={`icon-btn icon-btn--small${stashMode ? ' icon-btn--active' : ''}`}
          aria-pressed={stashMode}
          title={stashMode ? 'Back to commit' : 'Stash mode: the message names the stash'}
          onClick={() => setStashMode(on => !on)}
        >
          <Icon name="stash" size={13} />
        </button>
      </div>
      <div class="commit-box__summary">
        <input
          ref={summaryRef}
          class="field commit-box__input"
          data-testid="commit-message-input"
          placeholder={stashMode ? (wipLabel || 'Stash name (optional)') : 'Summary'}
          aria-label={stashMode ? 'Stash name' : 'Commit summary'}
          value={draft.summary}
          onInput={event => setDraft(prev => ({ ...prev, summary: (event.target as HTMLInputElement).value }))}
          onKeyDown={keyDown}
        />
        {!stashMode && <span class={`commit-box__counter${length > 72 ? ' commit-box__counter--over' : ''}`} title="72 characters recommended">{72 - length}</span>}
      </div>
      {!stashMode && (
        <textarea
          class="field field--area commit-box__description"
          placeholder="Description"
          aria-label="Commit description"
          value={draft.description}
          onInput={event => setDraft(prev => ({ ...prev, description: (event.target as HTMLTextAreaElement).value }))}
          onKeyDown={keyDown}
        />
      )}
      {!stashMode && (
        <div class="commit-box__options">
          <label class="check"><input type="checkbox" checked={amend} disabled={!head.sha || merging} onChange={event => toggleAmend((event.target as HTMLInputElement).checked)} />Amend the previous commit</label>
          <label class="check"><input type="checkbox" checked={push} onChange={event => setPush((event.target as HTMLInputElement).checked)} />Push after committing</label>
          <label class="check"><input type="checkbox" checked={skipHooks} onChange={event => setSkipHooks((event.target as HTMLInputElement).checked)} />Skip Git hooks</label>
        </div>
      )}
      {skipHooks && !stashMode && <p class="commit-box__note">Skipping this will bypass all configured Git hooks for the commit action.</p>}
      {amend && head.pushed && <p class="commit-box__note commit-box__note--warn">HEAD is already pushed. Amending rewrites history and requires a force push.</p>}
      <button class="btn btn--primary commit-box__submit" data-testid="commit-button" disabled={!canCommit} onClick={() => submit(false)}>
        {label}
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ commit details

const SIGNATURE: Record<string, string> = {
  G: 'Good signature',
  B: 'Bad signature',
  U: 'Good signature, unknown validity',
  X: 'Good signature, expired',
  Y: 'Good signature, expired key',
  R: 'Good signature, revoked key',
  E: 'Signature cannot be checked',
};

function Avatar({ ctx, name, email, size = 32 }: { ctx: Ctx; name: string; email: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const url = ctx.state.prefs.authorDisplay === 'avatars' ? ctx.state.avatars[email.trim().toLowerCase()] : undefined;
  return (
    <span class="avatar" style={{ background: avatarColor(name), width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.38)}px` }} title={`${name} <${email}>`}>
      {url && !failed ? <img src={url} alt="" width={size} height={size} onError={() => setFailed(true)} /> : initials(name)}
    </span>
  );
}

function CommitDetails({ ctx, splitProps, detail, isHead }: Props & { detail: CommitDetail; isHead: boolean }) {
  const [mode, setMode] = usePersisted<FileViewMode>('fileMode', 'path');
  const [allFiles, setAllFiles] = useState(false);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState(detail.message);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const [subject, ...rest] = detail.message.split('\n');
  const body = rest.join('\n').trim();
  const parent = detail.parents[0] ?? null;

  useEffect(() => {
    setEditing(false);
    setMessage(detail.message);
  }, [detail.sha]);

  useEffect(() => {
    if (editing) editRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    const onEdit = () => isHead && setEditing(true);
    window.addEventListener('mygit:editMessage', onEdit);
    return () => window.removeEventListener('mygit:editMessage', onEdit);
  }, [isHead]);

  const openFile = (file: FileChange) => send(ctx, 'view:openFile', { file: { path: file.path, source: 'commit', sha: detail.sha, status: file.status } });
  const committerDiffers = detail.committer !== detail.author || detail.committerEmail !== detail.authorEmail;

  return (
    <div class="detail" data-testid="detail-column">
      <div class="detail__head">
        <span class="detail__head-label">commit</span>
        <button class="sha sha--link" title="Copy full SHA" onClick={() => send(ctx, 'clipboard:write', { text: detail.sha })}>
          {shortSha(detail.sha)} <Icon name="copy" size={11} />
        </button>
        {isHead && <span class="tag-chip">HEAD</span>}
      </div>

      <div class="detail__top">
        {editing ? (
          <div class="detail__message detail__message--edit">
            <textarea
              ref={editRef}
              class="field field--area"
              rows={6}
              value={message}
              aria-label="Commit message"
              onInput={event => setMessage((event.target as HTMLTextAreaElement).value)}
              onKeyDown={event => {
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  setEditing(false);
                  setMessage(detail.message);
                }
                if (event.key === 'Enter' && primary(event) && message.trim()) {
                  send(ctx, 'commit:editMessage', { message });
                  setEditing(false);
                }
              }}
            />
            {ctx.state.head.pushed && <p class="commit-box__note commit-box__note--warn">This commit is pushed. Rewording it requires a force push.</p>}
            <div class="detail__edit-actions">
              <button class="btn btn--small" onClick={() => { setEditing(false); setMessage(detail.message); }}>Cancel Amend</button>
              <button class="btn btn--small btn--primary" disabled={!message.trim() || message.trim() === detail.message.trim()} onClick={() => { send(ctx, 'commit:editMessage', { message }); setEditing(false); }}>Update Message</button>
            </div>
          </div>
        ) : (
          <div
            class={`detail__message${isHead ? ' detail__message--editable' : ''}`}
            title={isHead ? 'Click to edit the message (amends HEAD)' : undefined}
            onClick={() => isHead && setEditing(true)}
          >
            <p class="detail__subject" data-testid="commit-message">{subject}</p>
            {body && <pre class="detail__body">{body}</pre>}
          </div>
        )}
      </div>

      <div {...splitProps('detailTop')} />

      <div class="detail__scroll">
        <div class="author">
          <Avatar ctx={ctx} name={detail.author} email={detail.authorEmail} />
          <span class="author__who">
            <span class="author__name">{detail.author}</span> <span class="author__email">{detail.authorEmail}</span>
            <br />
            <span class="author__meta">authored {fullDate(detail.date)}</span>
            {committerDiffers && (
              <>
                <br />
                <span class="author__meta">committed by {detail.committer} {fullDate(detail.commitDate)}</span>
              </>
            )}
          </span>
        </div>
        {detail.coAuthors.length > 0 && (
          <div class="coauthors">
            <span class="avatar-stack">
              {detail.coAuthors.map(person => <Avatar key={person.email} ctx={ctx} name={person.name} email={person.email} size={22} />)}
            </span>
            <span class="author__meta">co-authored by {detail.coAuthors.map(person => person.name).join(', ')}</span>
          </div>
        )}
        <div class="detail__meta">
          <span>
            sha <button class="sha sha--link" title="Copy SHA" onClick={() => send(ctx, 'clipboard:write', { text: detail.sha })}>{detail.sha}</button>
          </span>
          {detail.parents.length > 0 && (
            <span>
              {detail.parents.length === 1 ? 'parent' : 'parents'}{' '}
              {detail.parents.map(sha => (
                <button key={sha} class="sha sha--link" title={`Select ${sha}`} onClick={() => ctx.ui.revealCommit(sha)}>{shortSha(sha)}</button>
              ))}
            </span>
          )}
          {detail.signature !== 'N' && (
            <span class={`signature signature--${detail.signature === 'G' ? 'good' : detail.signature === 'B' ? 'bad' : 'warn'}`}>
              <Icon name="lock" size={11} /> {SIGNATURE[detail.signature] ?? detail.signature}{detail.signer ? ` · ${detail.signer}` : ''}
            </span>
          )}
        </div>

        <div class="file-list">
          <div class="file-list__head">
            <span>{allFiles ? 'All files' : 'Changed files'}</span>
            <span class="file-list__count">{detail.files.length}</span>
            <ListControls mode={mode} setMode={setMode} allFiles={allFiles} setAllFiles={setAllFiles} />
          </div>
          {allFiles ? (
            <AllFiles
              ctx={ctx}
              rev={detail.sha}
              mode={mode}
              changed={detail.files}
              onOpen={file => ('unchanged' in file ? send(ctx, 'file:open', { path: file.path, rev: detail.sha }) : openFile(file))}
              onMenu={(event, files) => ctx.ui.openMenu(event, commitFileMenu(ctx, detail.sha, files, parent))}
            />
          ) : (
            <FileList
              files={detail.files}
              mode={mode}
              testPrefix="detail-file"
              activePath={activePath(ctx, 'commit')}
              onOpen={openFile}
              onMenu={(event, files) => ctx.ui.openMenu(event, commitFileMenu(ctx, detail.sha, files, parent))}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ stash and ranges

function StashDetails({ ctx, view }: Props & { view: Extract<SelectionView, { kind: 'stash' }> }) {
  const [mode, setMode] = usePersisted<FileViewMode>('fileMode', 'path');
  const { stash, files } = view;
  return (
    <div class="detail">
      <div class="detail__head">
        <span class="detail__head-label">stash</span>
        <span class="sha">{stash.ref}</span>
        <button class="icon-btn icon-btn--small detail__head-more" aria-label="Stash actions" onClick={event => ctx.ui.openMenu(event as unknown as MouseEvent, stashMenu(ctx, stash, true))}>
          <Icon name="more" size={13} />
        </button>
      </div>
      <div class="detail__scroll">
        <div class="detail__message">
          <p class="detail__subject">{stash.message}</p>
          <p class="author__meta">created {fullDate(stash.date)} on <button class="sha sha--link" onClick={() => ctx.ui.revealCommit(stash.base)}>{shortSha(stash.base)}</button></p>
        </div>
        <div class="detail__actions">
          <button class="btn btn--small btn--primary" onClick={() => send(ctx, 'stash:pop', { ref: stash.ref })}>Pop</button>
          <button class="btn btn--small" onClick={() => send(ctx, 'stash:apply', { ref: stash.ref })}>Apply</button>
          <button class="btn btn--small btn--danger-quiet" onClick={() => ctx.ui.openDialog(confirmDialog('Delete stash', `"${stash.message}" is deleted. This cannot be undone.`, 'Delete', () => send(ctx, 'stash:drop', { ref: stash.ref }), true))}>Delete</button>
        </div>
        <div class="file-list">
          <div class="file-list__head">
            <span>Files</span>
            <span class="file-list__count">{files.length}</span>
            <ListControls mode={mode} setMode={setMode} />
          </div>
          <FileList
            files={files}
            mode={mode}
            activePath={activePath(ctx, 'stash')}
            onOpen={file => send(ctx, 'view:openFile', { file: { path: file.path, source: 'stash', sha: stash.sha, untracked: file.untracked, status: file.status } })}
            onMenu={(event, selected) => ctx.ui.openMenu(event, revisionFileMenu(ctx, selected[0], selected[0].untracked ? `${stash.sha}^3` : stash.sha, `${stash.sha}^1`, stash.sha))}
          />
        </div>
      </div>
    </div>
  );
}

function RangeDetails({ ctx, view }: Props & { view: Extract<SelectionView, { kind: 'range' }> }) {
  const [mode, setMode] = usePersisted<FileViewMode>('fileMode', 'path');
  const to = view.to;
  const title: ComponentChildren = view.mode === 'working'
    ? <>Comparing <span class="sha">{shortSha(view.from)}</span> with the working directory</>
    : view.mode === 'compare'
      ? <>Comparing <span class="sha">{shortSha(view.from)}</span> ↔ <span class="sha">{shortSha(view.newest)}</span></>
      : <>{plural(view.count, 'commit')} combined{to === 'working-tree' ? ' with the working directory' : ''}</>;
  return (
    <div class="detail">
      <div class="detail__head"><span class="detail__head-label">{title}</span></div>
      <div class="detail__scroll">
        {view.mode === 'combined' && to !== 'working-tree' && (
          <div class="detail__actions">
            <button class="btn btn--small" onClick={() => send(ctx, 'patch:commits', { shas: ctx.state.selection.filter(sha => sha !== 'working-tree') })}>Create patch</button>
          </div>
        )}
        <div class="file-list">
          <div class="file-list__head">
            <span>Files</span>
            <span class="file-list__count">{view.files.length}</span>
            <ListControls mode={mode} setMode={setMode} />
          </div>
          {view.files.length === 0 && <p class="detail__empty">No differences.</p>}
          <FileList
            files={view.files}
            mode={mode}
            activePath={activePath(ctx, 'range')}
            onOpen={file => send(ctx, 'view:openFile', { file: { path: file.path, source: 'range', sha: to, base: view.from, status: file.status } })}
            onMenu={(event, selected) => ctx.ui.openMenu(event, revisionFileMenu(ctx, selected[0], to === 'working-tree' ? 'working-tree' : to, view.from, to))}
          />
        </div>
      </div>
    </div>
  );
}
