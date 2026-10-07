import type { Ctx } from '../lib/ui';
import { Icon } from '../lib/icons';
import { NONE, pushFlow, rebaseConfirm, send } from '../lib/actions';
import { plural } from '../lib/format';
import { Spinner } from './Spinner';

/** Key that suppresses a prediction until either side moves. */
export function conflictKey(target: string, targetSha: string, headSha: string | null): string {
  return `${target}@${targetSha}@${headSha ?? ''}`;
}

export function ConflictIndicator({ ctx }: { ctx: Ctx }) {
  const { state } = ctx;
  const { conflicts, head, prefs, repoPrefs } = state;
  if (!prefs.conflictDetection && conflicts.results.length === 0) return null;
  const active = conflicts.results.filter(result => result.files.length > 0 && !repoPrefs.conflictIgnored.includes(conflictKey(result.target, result.targetSha, head.sha)));
  const fileCount = active.reduce((sum, result) => sum + result.files.length, 0);

  if (conflicts.checking && active.length === 0) {
    return <span class="conflict-indicator conflict-indicator--checking" title="Checking target branches for conflicts"><Spinner size={12} label="Checking target branches for conflicts" /></span>;
  }
  if (conflicts.checkedAt === null) return null;
  if (active.length === 0) {
    return (
      <button class="conflict-indicator conflict-indicator--clean" title="Up to Date with Merge Target" aria-label="Up to Date with Merge Target" onClick={() => send(ctx, 'conflicts:check', NONE)}>
        <Icon name="check" size={13} />
      </button>
    );
  }

  function open(): void {
    const summary = active
      .map(result => `${head.branch ?? 'HEAD'} vs ${result.target}:\n${result.files.map(file => `  ${file.path}${file.ranges.length ? ` (lines ${file.ranges.map(([a, b]) => `${a}-${b}`).join(', ')})` : ''}`).join('\n')}`)
      .join('\n\n');
    const first = active[0];
    ctx.ui.openDialog({
      title: `Conflicts with ${plural(active.length, 'target branch', 'target branches')}`,
      body: `Merging these branches with ${head.branch ?? 'HEAD'} would conflict in ${plural(fileCount, 'file')}.`,
      wide: true,
      fields: [{ kind: 'list', items: active.flatMap(result => result.files.map(file => `${result.target}: ${file.path}${file.ranges.length ? `  lines ${file.ranges.map(([a, b]) => `${a}–${b}`).join(', ')}` : ''}`)) }],
      cancelLabel: 'Close',
      actions: [
        { label: 'Ignore', tone: 'default', onSelect: () => send(ctx, 'conflicts:ignore', { keys: active.map(result => conflictKey(result.target, result.targetSha, head.sha)) }) },
        { label: 'Copy summary', tone: 'default', onSelect: () => send(ctx, 'clipboard:write', { text: summary }) },
        { label: 'Push', tone: 'default', onSelect: () => pushFlow(ctx) },
        { label: `Rebase onto ${first.target}`, tone: 'default', onSelect: () => rebaseConfirm(ctx, head.branch ?? 'HEAD', first.target, () => send(ctx, 'branch:rebase', { onto: first.target })) },
        { label: `Merge ${first.target} now`, onSelect: () => send(ctx, 'branch:merge', { ref: first.target }) },
      ],
    });
  }

  return (
    <button class="conflict-indicator conflict-indicator--warn" title={`Conflicts with ${active.map(result => result.target).join(', ')}`} onClick={open}>
      <Icon name="warning" size={13} />
      <span>{fileCount}</span>
    </button>
  );
}
