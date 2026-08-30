import { useState } from 'preact/hooks';
import type { BranchRef } from '../../git/refs';
import type { WebviewToExtensionMessage } from '../../panel/messages';
import { Icon, type IconName } from '../lib/icons';

type Props = {
  repoName: string;
  head: BranchRef | undefined;
  dispatch: (message: WebviewToExtensionMessage) => void;
};

export function Toolbar({ repoName, head, dispatch }: Props) {
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [branchName, setBranchName] = useState('');

  function createBranch(): void {
    const name = branchName.trim();
    if (!name) return;
    dispatch({ type: 'branch:create', payload: { name, from: head?.name ?? 'HEAD' } });
    setBranchName('');
    setCreatingBranch(false);
  }

  return (
    <header class="toolbar">
      <div class="toolbar__context">
        <span class="context-field">
          <span class="context-field__label">Repository</span>
          <span class="context-field__value" title={repoName}>{repoName || '—'}</span>
        </span>
        <span class="context-sep"><Icon name="chevron" size={12} /></span>
        <span class="context-field">
          <span class="context-field__label">Branch</span>
          <span class="context-field__value" title={head?.name}>{head?.name ?? 'detached HEAD'}</span>
        </span>
      </div>

      <div class="toolbar__actions">
        <ToolButton icon="sync" label="Fetch" onClick={() => dispatch({ type: 'remote:fetch', payload: {} })} />
        <ToolButton icon="down" label="Pull" onClick={() => dispatch({ type: 'remote:pull' })} />
        <ToolButton
          icon="up"
          label="Push"
          note={head && !head.upstream ? 'set upstream' : undefined}
          onClick={() => dispatch({ type: 'remote:push', payload: { setUpstream: !head?.upstream } })}
        />
        <ToolButton icon="plus" label="Branch" expanded={creatingBranch} onClick={() => setCreatingBranch(open => !open)} />
      </div>

      {creatingBranch && (
        <div class="toolbar__branch-form">
          <input
            class="field"
            autofocus
            placeholder={`New branch from ${head?.name ?? 'HEAD'}`}
            aria-label="New branch name"
            value={branchName}
            onInput={event => setBranchName((event.target as HTMLInputElement).value)}
            onKeyDown={event => {
              if (event.key === 'Enter') createBranch();
              if (event.key === 'Escape') setCreatingBranch(false);
            }}
          />
          <button class="btn btn--primary" disabled={branchName.trim().length === 0} onClick={createBranch}>
            Create
          </button>
        </div>
      )}
    </header>
  );
}

type ToolButtonProps = {
  icon: IconName;
  label: string;
  note?: string;
  expanded?: boolean;
  onClick: () => void;
};

function ToolButton({ icon, label, note, expanded, onClick }: ToolButtonProps) {
  return (
    <button class="tool-btn" aria-expanded={expanded} title={note ? `${label} (${note})` : label} onClick={onClick}>
      <Icon name={icon} size={16} />
      <span>{label}</span>
      {note && <span class="tool-btn__badge">{note}</span>}
    </button>
  );
}
