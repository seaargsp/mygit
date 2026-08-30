import type { BranchRef } from '../../git/refs';
import type { WebviewToExtensionMessage } from '../../panel/messages';
import type { Ui } from '../lib/ui';
import { Icon, type IconName } from '../lib/icons';

type Props = {
  repoName: string;
  head: BranchRef | undefined;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  ui: Ui;
  dispatch: (message: WebviewToExtensionMessage) => void;
};

export function Toolbar({ repoName, head, sidebarCollapsed, onToggleSidebar, ui, dispatch }: Props) {
  function createBranch(): void {
    const from = head?.name ?? 'HEAD';
    ui.openDialog({
      kind: 'prompt',
      title: 'Create branch',
      label: `Branch off ${from}`,
      placeholder: 'feature/short-name',
      confirmLabel: 'Create branch',
      onConfirm: name => dispatch({ type: 'branch:create', payload: { name, from } }),
    });
  }

  return (
    <header class="toolbar">
      <button
        class="icon-btn"
        aria-pressed={!sidebarCollapsed}
        aria-label={sidebarCollapsed ? 'Show the branches pane' : 'Hide the branches pane'}
        title={sidebarCollapsed ? 'Show branches' : 'Hide branches'}
        onClick={onToggleSidebar}
      >
        <Icon name="sidebar" size={16} />
      </button>

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
        <ToolButton icon="plus" label="Branch" onClick={createBranch} />
      </div>
    </header>
  );
}

type ToolButtonProps = { icon: IconName; label: string; note?: string; onClick: () => void };

function ToolButton({ icon, label, note, onClick }: ToolButtonProps) {
  return (
    <button class="tool-btn" title={note ? `${label} (${note})` : label} onClick={onClick}>
      <Icon name={icon} size={16} />
      <span>{label}</span>
      {note && <span class="tool-btn__badge">{note}</span>}
    </button>
  );
}
